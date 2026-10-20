'use strict';
// 一局对局的确定性核心：不碰网络、不开计时器、不读真实时钟。
// 所有输入（出招、超时、tick）都带时间戳写进记录，所以同一份记录重放一定得到同一个结果。

const { createRng } = require('./rng');
const { checkArgs } = require('./args');

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

class Match {
  /**
   * @param {import('./types').GameDef} game
   * @param {{ seats: import('./types').SeatInfo[], options: any, seed: string, startedAt: number }} init
   */
  constructor(game, { seats, options, seed, startedAt }) {
    this.game = game;
    /** @type {import('./types').MatchRecord} */
    this.record = { game: game.id, rulesVersion: game.rulesVersion, seed, options, seats, startedAt, log: [] };
    this.rng = createRng(seed);
    this.ver = 0;
    /** 打开后每次提交都跑 invariants（测试里用） */
    this.checkInvariants = false;
    /** @type {import('./types').QueuedEvent[]} */
    const events = [];
    this.state = game.setup(this._ctx(startedAt, events));
    this.lastEvents = events;
  }

  /**
   * 按记录重放出一局。记录里每一条都必须仍然合法，否则说明规则或随机数不确定，直接报错。
   * @param {import('./types').GameDef} game
   * @param {import('./types').MatchRecord} record
   */
  static replay(game, record) {
    if (record.game !== game.id) throw new Error(`记录属于 ${record.game}，不是 ${game.id}`);
    const m = new Match(game, record);
    for (const entry of record.log) {
      const r = m._apply({ ...entry });
      if (!r.ok) throw new Error(`重放在 t=${entry.t} 处分叉：${r.error}`);
    }
    return m;
  }

  /**
   * @param {number} now
   * @param {import('./types').QueuedEvent[]} events
   * @returns {import('./types').Ctx}
   */
  _ctx(now, events) {
    return {
      rng: this.rng,
      now,
      seats: this.record.seats,
      options: this.record.options,
      emit: (evt, opts) => { events.push({ evt, to: opts && opts.to != null ? opts.to : null }); },
    };
  }

  /** @param {number} seat @param {string} name @param {any} args @param {number} now */
  move(seat, name, args, now) {
    return this._apply({ t: now, seat, move: name, args: args == null ? {} : args });
  }

  /** 截止时间到了才会生效 @param {number} now */
  timeout(now) {
    const due = this.deadline();
    if (due === null || now < due) return { ok: false, error: 'err.not_due' };
    return this._apply({ t: now, timeout: true });
  }

  /** @param {number} now */
  tick(now) {
    return this._apply({ t: now, tick: true });
  }

  /**
   * @param {import('./types').RecordEntry} entry
   * @returns {import('./types').ApplyResult}
   */
  _apply(entry) {
    const g = this.game;
    if (this.result()) return { ok: false, error: 'err.game_over' };

    /** @type {(draft: any, ctx: import('./types').Ctx) => string | void} */
    let run;
    let ephemeral = false;
    if (entry.move !== undefined) {
      const def = has(g.moves, entry.move) ? g.moves[entry.move] : null;
      if (!def) return { ok: false, error: 'err.unknown_move' };
      const bad = checkArgs(def.args || {}, entry.args);
      if (bad) return { ok: false, error: bad };
      if (!def.anytime && !g.actors(this.state).includes(/** @type {number} */ (entry.seat))) {
        return { ok: false, error: 'err.not_your_turn' };
      }
      ephemeral = !!(g.ephemeral && g.ephemeral.includes(entry.move));
      run = (d, ctx) => def.apply(d, /** @type {number} */ (entry.seat), entry.args || {}, ctx);
    } else if (entry.timeout) {
      if (!g.onTimeout) return { ok: false, error: 'err.no_timeout' };
      const onTimeout = g.onTimeout;
      run = (d, ctx) => onTimeout(d, ctx);
    } else if (entry.tick) {
      if (!g.tick) return { ok: false, error: 'err.no_tick' };
      const tick = g.tick;
      run = (d, ctx) => tick(d, ctx);
    } else {
      return { ok: false, error: 'err.bad_entry' };
    }

    // 先在草稿上改：非法就整份丢弃，随机数也退回去，状态永远不会停在一半。
    const savedRng = this.rng.save();
    /** @type {import('./types').QueuedEvent[]} */
    const events = [];
    const draft = structuredClone(this.state);
    let err;
    try {
      err = run(draft, this._ctx(entry.t, events));
    } catch (e) {
      this.rng.restore(savedRng);
      throw e;
    }
    if (typeof err === 'string') {
      this.rng.restore(savedRng);
      return { ok: false, error: err };
    }
    if (this.checkInvariants && g.invariants) g.invariants(draft);

    this.state = draft;
    this.ver++;
    this.record.log.push(entry);
    this.lastEvents = events;
    return { ok: true, events, ephemeral };
  }

  /** @param {number | null} seat */
  view(seat) {
    return this.game.view(this.state, seat);
  }

  /**
   * @param {import('./types').QueuedEvent[]} events
   * @param {number | null} seat
   */
  eventsFor(events, seat) {
    return events.filter((e) => e.to === null || e.to === seat).map((e) => e.evt);
  }

  actors() {
    return this.result() ? [] : this.game.actors(this.state);
  }

  /** @returns {number | null} */
  deadline() {
    if (this.result() || !this.game.deadline) return null;
    return this.game.deadline(this.state);
  }

  result() {
    return this.game.result(this.state);
  }
}

module.exports = { Match };
