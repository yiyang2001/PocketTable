'use strict';
// 房间层：座位、准备、房主、bot、断线，以及对局进行中的统一调度（截止时间、tick、bot 出招）。
// 规则判定全部交给 Match；这里只负责"什么时候调用它"和"把结果发给谁"。

const { Match } = require('./match');
const { randomSeed, createRng } = require('./rng');
const { resolveOptions, optionValid } = require('./args');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉了 0/O、1/I
const EPHEMERAL_FLUSH_MS = 50;
const BOT_NAMES = ['喵喵', '汪汪', '团子', '布丁', '豆豆', '阿呆', '饭团', '小黑'];
const AVATAR_COUNT = 8;

// 房间计时器都不阻止进程退出：只要 HTTP 服务器在监听，进程本来就会活着
/** @param {() => void} fn @param {number} ms */
const later = (fn, ms) => setTimeout(fn, ms).unref();
/** @param {() => void} fn @param {number} ms */
const every = (fn, ms) => setInterval(fn, ms).unref();

/**
 * @typedef {{ pid: string, name: string, avatar: number, bot: null | { level: string }, ready: boolean, connected: boolean }} Player
 * @typedef {{ pid: string, name: string, avatar: number }} Who
 * @typedef {{
 *   send: (pid: string, msg: any) => void,
 *   now: () => number,
 *   botDelay: () => number,
 *   autoplayMs: number,
 *   graceMs: number,
 *   abandonMs: number,
 *   onChange: () => void,
 *   onEmpty: (room: Room) => void,
 * }} RoomDeps
 */

class Room {
  /**
   * @param {string} code
   * @param {import('./registry').GameEntry} entry
   * @param {RoomDeps} deps
   */
  constructor(code, entry, deps) {
    this.code = code;
    this.entry = entry;
    this.game = entry.game;
    this.deps = deps;
    /** @type {Player[]} */
    this.players = [];
    /** @type {string | null} */
    this.hostPid = null;
    /** @type {'lobby' | 'playing' | 'ended'} */
    this.phase = 'lobby';
    this.options = resolveOptions(this.game.options);
    /** @type {Match | null} */
    this.match = null;
    /** @type {import('./types').QueuedEvent[]} */
    this.pendingEvents = [];
    this.botRng = createRng(randomSeed());
    this.timers = {
      /** @type {NodeJS.Timeout | null} */ deadline: null,
      /** @type {NodeJS.Timeout | null} */ tick: null,
      /** @type {NodeJS.Timeout | null} */ flush: null,
      /** @type {NodeJS.Timeout | null} */ abandon: null,
      /** @type {Map<number, NodeJS.Timeout>} */ bots: new Map(),
      /** @type {Map<string, NodeJS.Timeout>} */ grace: new Map(),
    };
  }

  // ---------- 查询 ----------

  /** @param {string} pid */
  seatOf(pid) {
    return this.players.findIndex((p) => p.pid === pid);
  }

  humans() {
    return this.players.filter((p) => !p.bot);
  }

  info() {
    return {
      code: this.code,
      game: this.game.id,
      phase: this.phase,
      hostPid: this.hostPid,
      options: this.options,
      capacity: this.game.players.max,
      min: this.game.players.min,
      seats: this.players.map((p, i) => ({
        seat: i,
        pid: p.pid,
        name: p.name,
        avatar: p.avatar,
        bot: !!p.bot,
        ready: p.bot ? true : p.ready,
        connected: p.bot ? true : p.connected,
      })),
      // 对局中和结束后，结果页用开局时的座位表
      matchSeats: this.match ? this.match.record.seats : null,
    };
  }

  /** @param {number} seat @param {import('./types').QueuedEvent[]} events */
  stateMsg(seat, events) {
    const m = /** @type {Match} */ (this.match);
    return {
      t: 'state',
      ver: m.ver,
      seat,
      view: m.view(seat),
      events: m.eventsFor(events, seat),
      deadline: m.deadline(),
      actors: m.actors(),
      result: m.result(),
    };
  }

  // ---------- 广播 ----------

  broadcastRoom() {
    const msg = { t: 'room', room: this.info() };
    for (const p of this.players) if (!p.bot && p.connected) this.deps.send(p.pid, msg);
  }

  /** @param {import('./types').QueuedEvent[]} events */
  broadcastState(events) {
    if (!this.match) return;
    this.players.forEach((p, seat) => {
      if (!p.bot && p.connected) this.deps.send(p.pid, this.stateMsg(seat, events));
    });
  }

  /** 给刚进来或重连的人补一份完整信息 @param {string} pid */
  sendSnapshotTo(pid) {
    this.deps.send(pid, { t: 'room', room: this.info() });
    const seat = this.seatOf(pid);
    if (this.match && seat >= 0) this.deps.send(pid, this.stateMsg(seat, []));
  }

  // ---------- 进出 ----------

  /** @param {Who} who @returns {string | null} */
  join(who) {
    const seat = this.seatOf(who.pid);
    if (seat >= 0) {
      const p = this.players[seat];
      p.connected = true;
      p.name = who.name;
      p.avatar = who.avatar;
      this._clearGrace(who.pid);
      this._checkAbandon();
      this.broadcastRoom();
      this.sendSnapshotTo(who.pid);
      this.deps.onChange();
      return null;
    }
    if (this.phase !== 'lobby') return 'err.room_playing';
    if (this.players.length >= this.game.players.max) return 'err.room_full';
    this.players.push({ pid: who.pid, name: who.name, avatar: who.avatar, bot: null, ready: false, connected: true });
    if (!this.hostPid) this.hostPid = who.pid;
    this._checkAbandon();
    this.broadcastRoom();
    this.sendSnapshotTo(who.pid);
    this.deps.onChange();
    return null;
  }

  /** 主动离开 @param {string} pid */
  leave(pid) {
    const seat = this.seatOf(pid);
    if (seat < 0) return;
    this._clearGrace(pid);
    if (this.phase === 'playing') {
      // 对局中座位保留（座位号是对局的一部分），只标记为离线
      this.players[seat].connected = false;
      this.players[seat].ready = false;
    } else {
      this.players.splice(seat, 1);
    }
    this._fixHost();
    this._checkAbandon();
    this.broadcastRoom();
    this.deps.onChange();
  }

  /** 连接断开（可能马上重连） @param {string} pid */
  disconnect(pid) {
    const seat = this.seatOf(pid);
    if (seat < 0) return;
    this.players[seat].connected = false;
    if (this.phase !== 'playing') {
      this._clearGrace(pid);
      this.timers.grace.set(pid, later(() => this.leave(pid), this.deps.graceMs));
    } else {
      this._schedule(); // 轮到他时由电脑代打
    }
    this._checkAbandon();
    this.broadcastRoom();
    this.deps.onChange();
  }

  // ---------- 房主操作 ----------

  /** @param {string} pid */
  _isHost(pid) {
    return pid === this.hostPid;
  }

  /** @param {string} pid @param {boolean} ready */
  setReady(pid, ready) {
    const seat = this.seatOf(pid);
    if (seat < 0) return 'err.not_in_room';
    if (this.phase !== 'lobby') return 'err.not_lobby';
    this.players[seat].ready = !!ready;
    this.broadcastRoom();
    return null;
  }

  /** @param {string} pid @param {string} key @param {any} value */
  setOption(pid, key, value) {
    if (!this._isHost(pid)) return 'err.host_only';
    if (this.phase !== 'lobby') return 'err.not_lobby';
    const def = this.game.options && this.game.options[key];
    if (!def || !optionValid(def, value)) return 'err.bad_option';
    this.options = { ...this.options, [key]: value };
    // 规则变了，大家重新确认
    for (const p of this.players) if (!p.bot && p.pid !== this.hostPid) p.ready = false;
    this.broadcastRoom();
    this.deps.onChange();
    return null;
  }

  /** @param {string} pid */
  addBot(pid) {
    if (!this._isHost(pid)) return 'err.host_only';
    if (this.phase !== 'lobby') return 'err.not_lobby';
    if (!this.entry.bot && !this.game.legalMoves) return 'err.no_bots';
    if (this.players.length >= this.game.players.max) return 'err.room_full';
    const used = new Set(this.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || `电脑${this.players.length + 1}`;
    this.players.push({
      pid: `bot-${this.botRng.int(1e9).toString(36)}`,
      name,
      avatar: this.botRng.int(AVATAR_COUNT),
      bot: { level: 'normal' },
      ready: true,
      connected: true,
    });
    this.broadcastRoom();
    this.deps.onChange();
    return null;
  }

  /** 移除 bot 或踢人 @param {string} pid @param {number} seat */
  kick(pid, seat) {
    if (!this._isHost(pid)) return 'err.host_only';
    if (this.phase !== 'lobby') return 'err.not_lobby';
    const target = this.players[seat];
    if (!target || target.pid === pid) return 'err.bad_seat';
    this.players.splice(seat, 1);
    if (!target.bot) {
      this._clearGrace(target.pid);
      this.deps.send(target.pid, { t: 'kicked', code: this.code });
    }
    this.broadcastRoom();
    this.deps.onChange();
    return null;
  }

  /** @param {string} pid */
  start(pid) {
    if (!this._isHost(pid)) return 'err.host_only';
    if (this.phase !== 'lobby') return 'err.not_lobby';
    if (this.players.length < this.game.players.min) return 'err.not_enough_players';
    if (this.players.some((p) => !p.bot && p.pid !== this.hostPid && !p.ready)) return 'err.not_all_ready';

    const seats = this.players.map((p, seat) => ({ seat, name: p.name, bot: !!p.bot, avatar: p.avatar }));
    this.match = new Match(this.game, { seats, options: this.options, seed: randomSeed(), startedAt: this.deps.now() });
    this.phase = 'playing';
    this.pendingEvents = [...this.match.lastEvents];
    this.broadcastRoom();
    this._flush();
    this._startTick();
    this._schedule();
    this.deps.onChange();
    return null;
  }

  /** 结算后回到等待房间 @param {string} pid */
  rematch(pid) {
    if (!this._isHost(pid)) return 'err.host_only';
    if (this.phase !== 'ended') return 'err.not_ended';
    this._stopMatchTimers();
    this.match = null;
    this.phase = 'lobby';
    // 对局中离开的人这时才真正移出座位
    this.players = this.players.filter((p) => p.bot || p.connected);
    for (const p of this.players) if (!p.bot) p.ready = false;
    this._fixHost();
    this.broadcastRoom();
    this.deps.onChange();
    return null;
  }

  // ---------- 对局 ----------

  /** @param {string} pid @param {string} name @param {any} args */
  move(pid, name, args) {
    if (this.phase !== 'playing' || !this.match) return 'err.not_playing';
    const seat = this.seatOf(pid);
    if (seat < 0) return 'err.not_in_room';
    let r;
    try {
      r = this.match.move(seat, name, args, this.deps.now());
    } catch (e) {
      console.error(`[room ${this.code}] ${this.game.id}.${name} 抛出异常`, e);
      return 'err.internal';
    }
    if (!r.ok) return r.error || 'err.illegal';
    this._commit(r);
    return null;
  }

  /** @param {import('./types').ApplyResult} r */
  _commit(r) {
    const m = /** @type {Match} */ (this.match);
    this.pendingEvents.push(...(r.events || []));
    if (r.ephemeral) {
      if (!this.timers.flush) {
        this.timers.flush = later(() => { this.timers.flush = null; this._flush(); }, EPHEMERAL_FLUSH_MS);
      }
    } else {
      this._flush();
    }
    if (m.result()) this._end();
    else this._schedule();
    this.deps.onChange();
  }

  _flush() {
    if (this.timers.flush) { clearTimeout(this.timers.flush); this.timers.flush = null; }
    const events = this.pendingEvents;
    this.pendingEvents = [];
    this.broadcastState(events);
  }

  _end() {
    this._flush();
    this._stopMatchTimers();
    this.phase = 'ended';
    this.broadcastRoom();
  }

  /** 每次提交后重新安排：截止时间一个计时器，轮到的 bot 各一个 */
  _schedule() {
    const m = this.match;
    if (!m || this.phase !== 'playing') return;
    if (this.timers.deadline) { clearTimeout(this.timers.deadline); this.timers.deadline = null; }
    const due = m.deadline();
    if (due !== null) {
      this.timers.deadline = later(() => {
        this.timers.deadline = null;
        this._safe(() => {
          const r = m.timeout(this.deps.now());
          if (r.ok) this._commit(r);
          else if (r.error === 'err.not_due') this._schedule();
        });
      }, Math.max(0, due - this.deps.now()));
    }
    for (const seat of m.actors()) {
      const p = this.players[seat];
      if (!p || this.timers.bots.has(seat)) continue;
      // 电脑按正常节奏出；断线的真人等一会儿再由电脑代打，免得重连途中被抢着出牌
      if (!p.bot && p.connected) continue;
      const delay = p.bot ? this.deps.botDelay() : this.deps.autoplayMs;
      this.timers.bots.set(seat, later(() => {
        this.timers.bots.delete(seat);
        this._safe(() => this._botMove(seat));
      }, delay));
    }
  }

  /** @param {number} seat */
  _botMove(seat) {
    const m = this.match;
    if (!m || this.phase !== 'playing' || !m.actors().includes(seat)) return;
    const p = this.players[seat];
    if (!p || (!p.bot && p.connected)) return; // 代打途中本人回来了
    const now = this.deps.now();
    const { bot, game } = this.entry;
    let r = null;
    if (bot) {
      const choice = bot.decide(m.view(seat), seat, this.botRng);
      if (!choice) return; // 电脑决定这次不出
      r = m.move(seat, choice.name, choice.args, now);
    }
    if ((!r || !r.ok) && game.legalMoves) {
      // bot 出了非法招时退回到随机合法招，保证对局不会卡住
      const legal = game.legalMoves(m.state, seat);
      if (legal.length) {
        const pick = this.botRng.pick(legal);
        r = m.move(seat, pick.name, pick.args, now);
      }
    }
    if (r && r.ok) this._commit(r);
    else console.warn(`[room ${this.code}] bot 座位 ${seat} 没有可走的招：${r ? r.error : '无'}`);
  }

  _startTick() {
    const g = this.game;
    if (!g.tickHz || !g.tick || this.timers.tick) return;
    this.timers.tick = every(() => this._safe(() => {
      if (!this.match || this.phase !== 'playing') return;
      const r = this.match.tick(this.deps.now());
      if (r.ok) this._commit(r);
    }), Math.round(1000 / g.tickHz));
  }

  _stopMatchTimers() {
    if (this.timers.deadline) clearTimeout(this.timers.deadline);
    if (this.timers.tick) clearInterval(this.timers.tick);
    if (this.timers.flush) clearTimeout(this.timers.flush);
    for (const t of this.timers.bots.values()) clearTimeout(t);
    this.timers.deadline = this.timers.tick = this.timers.flush = null;
    this.timers.bots.clear();
  }

  /** @param {() => void} fn */
  _safe(fn) {
    try {
      fn();
    } catch (e) {
      console.error(`[room ${this.code}] ${this.game.id} 调度出错`, e);
      for (const p of this.players) if (!p.bot && p.connected) this.deps.send(p.pid, { t: 'toast', key: 'err.internal' });
    }
  }

  // ---------- 维护 ----------

  _fixHost() {
    if (this.hostPid && this.players.some((p) => p.pid === this.hostPid)) return;
    const next = this.players.find((p) => !p.bot && p.connected) || this.players.find((p) => !p.bot);
    this.hostPid = next ? next.pid : null;
  }

  /** @param {string} pid */
  _clearGrace(pid) {
    const t = this.timers.grace.get(pid);
    if (t) { clearTimeout(t); this.timers.grace.delete(pid); }
  }

  /** 没有任何真人在线一段时间后关闭房间 */
  _checkAbandon() {
    const anyone = this.players.some((p) => !p.bot && p.connected);
    if (anyone) {
      if (this.timers.abandon) { clearTimeout(this.timers.abandon); this.timers.abandon = null; }
      return;
    }
    if (!this.humans().length) { this.deps.onEmpty(this); return; }
    if (!this.timers.abandon) this.timers.abandon = later(() => this.deps.onEmpty(this), this.deps.abandonMs);
  }

  dispose() {
    this._stopMatchTimers();
    if (this.timers.abandon) clearTimeout(this.timers.abandon);
    for (const t of this.timers.grace.values()) clearTimeout(t);
    this.timers.grace.clear();
  }

  // ---------- 快照 ----------

  snapshot() {
    return {
      code: this.code,
      game: this.game.id,
      hostPid: this.hostPid,
      phase: this.phase,
      options: this.options,
      players: this.players.map((p) => ({ ...p })),
      record: this.match ? this.match.record : null,
    };
  }

  /**
   * 重启后恢复：重放对局记录得到完全相同的状态。规则版本变了就退回等待房间。
   * @param {ReturnType<Room['snapshot']>} snap
   * @param {import('./registry').GameEntry} entry
   * @param {RoomDeps} deps
   */
  static restore(snap, entry, deps) {
    const room = new Room(snap.code, entry, deps);
    room.hostPid = snap.hostPid;
    room.options = resolveOptions(entry.game.options, snap.options);
    room.players = snap.players.map((p) => ({ ...p, connected: !!p.bot }));
    room.phase = snap.phase;
    if (snap.record && snap.phase !== 'lobby') {
      try {
        if (snap.record.rulesVersion !== entry.game.rulesVersion) throw new Error('规则版本已变');
        room.match = Match.replay(entry.game, snap.record);
      } catch (e) {
        console.warn(`[room ${snap.code}] 对局无法恢复，回到等待房间：${/** @type {Error} */ (e).message}`);
        room.match = null;
        room.phase = 'lobby';
      }
    } else {
      room.phase = 'lobby';
    }
    if (room.phase === 'playing') {
      room._startTick();
      room._schedule();
    }
    room._checkAbandon();
    return room;
  }
}

class RoomManager {
  /**
   * @param {Map<string, import('./registry').GameEntry>} registry
   * @param {Omit<RoomDeps, 'onEmpty'>} deps
   */
  constructor(registry, deps) {
    this.registry = registry;
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    /** @type {RoomDeps} */
    this.deps = { ...deps, onEmpty: (room) => this.remove(room) };
  }

  /** @param {string} gameId */
  create(gameId) {
    const entry = this.registry.get(gameId);
    if (!entry) return { error: 'err.unknown_game' };
    const room = new Room(this._newCode(), entry, this.deps);
    this.rooms.set(room.code, room);
    return { room };
  }

  /** @param {string} code */
  get(code) {
    return this.rooms.get(String(code || '').toUpperCase()) || null;
  }

  /** @param {Room} room */
  remove(room) {
    room.dispose();
    for (const p of room.players) if (!p.bot && p.connected) this.deps.send(p.pid, { t: 'room_closed', code: room.code });
    this.rooms.delete(room.code);
    this.deps.onChange();
  }

  _newCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  snapshot() {
    return [...this.rooms.values()].map((r) => r.snapshot());
  }

  /** @param {ReturnType<Room['snapshot']>[]} list */
  restore(list) {
    for (const snap of list || []) {
      const entry = this.registry.get(snap.game);
      if (!entry || !snap.players.some((p) => !p.bot)) continue;
      this.rooms.set(snap.code, Room.restore(snap, entry, this.deps));
    }
  }

  stats() {
    let players = 0;
    for (const r of this.rooms.values()) players += r.players.filter((p) => !p.bot && p.connected).length;
    return { rooms: this.rooms.size, players };
  }

  dispose() {
    for (const r of this.rooms.values()) r.dispose();
  }
}

module.exports = { Room, RoomManager, AVATAR_COUNT };
