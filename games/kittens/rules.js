'use strict';
// 爆炸猫：轮流出牌，最后摸一张；摸到爆炸猫又没有拆除就出局，最后剩下的人赢。
//
// 阶段：
//   turn      当前玩家出牌或摸牌
//   reaction  有人出了功能牌，所有人都可以打「不要！」；窗口到时才结算（每次「不要」都会重新计时）
//   favor     被索要的人挑一张牌交出去
//   insert    拆除成功的人选位置把爆炸猫放回牌堆
//   over      结束

/** @typedef {'kitten'|'defuse'|'attack'|'skip'|'future'|'shuffle'|'favor'|'nope'|'cat1'|'cat2'|'cat3'|'cat4'|'cat5'} CardType */
/** @typedef {{ id: string, t: CardType }} Card */
/**
 * @typedef {{
 *   kind: 'attack'|'skip'|'future'|'shuffle'|'favor'|'pair'|'triple',
 *   by: number, target: number | null, named: CardType | null,
 *   cards: Card[], nopes: number, lastNoper: number | null, endsAt: number,
 * }} Pending
 * @typedef {{
 *   n: number,
 *   alive: boolean[],
 *   hands: Card[][],
 *   deck: Card[],
 *   discard: Card[],
 *   turn: number,
 *   turnsLeft: number,
 *   underAttack: boolean,
 *   phase: 'turn'|'reaction'|'favor'|'insert'|'over',
 *   pending: Pending | null,
 *   favor: { from: number, to: number } | null,
 *   insert: { seat: number, card: Card } | null,
 *   peeks: ({ ids: string[], deckVer: number } | null)[],
 *   deckVer: number,
 *   turnEndsAt: number | null,
 *   turnSec: number,
 *   reactSec: number,
 *   log: any[],
 *   winner: number | null,
 *   total: number,
 * }} State
 * @typedef {{ turnSec: number, reactSec: number }} Options
 * @typedef {import('../../server/types').Ctx<Options>} Ctx
 */

const CATS = ['cat1', 'cat2', 'cat3', 'cat4', 'cat5'];
const ACTIONS = ['attack', 'skip', 'future', 'shuffle', 'favor'];
const NAMEABLE = ['defuse', 'attack', 'skip', 'future', 'shuffle', 'favor', 'nope', ...CATS];
const COUNTS = { attack: 4, skip: 4, future: 5, shuffle: 4, favor: 4, nope: 5, cat1: 4, cat2: 4, cat3: 4, cat4: 4, cat5: 4 };
const HAND_SIZE = 7;
const LOG_MAX = 30;

const isCat = (/** @type {string} */ t) => CATS.includes(t);

/** @param {State} s */
function nextAlive(s, from) {
  for (let i = 1; i <= s.n; i++) {
    const seat = (from + i) % s.n;
    if (s.alive[seat]) return seat;
  }
  return from;
}

/** @param {State} s @param {any} entry */
function log(s, entry) {
  s.log.push(entry);
  if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
}

/** @param {State} s @param {Ctx} ctx */
function resetTurnTimer(s, ctx) {
  s.turnEndsAt = s.turnSec > 0 ? ctx.now + s.turnSec * 1000 : null;
}

/** 当前这一回合结束（摸了牌或者跳过） @param {State} s @param {Ctx} ctx */
function endTurn(s, ctx) {
  s.turnsLeft -= 1;
  if (s.turnsLeft <= 0) {
    s.turn = nextAlive(s, s.turn);
    s.turnsLeft = 1;
    s.underAttack = false;
  }
  s.phase = 'turn';
  resetTurnTimer(s, ctx);
}

/** @param {State} s @param {number} seat @param {string} id */
function takeFromHand(s, seat, id) {
  const hand = s.hands[seat];
  const i = hand.findIndex((c) => c.id === id);
  return i < 0 ? null : hand.splice(i, 1)[0];
}

/** @param {State} s @param {Ctx} ctx */
function checkWinner(s, ctx) {
  const left = s.alive.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
  if (left.length !== 1) return false;
  s.winner = left[0];
  s.phase = 'over';
  s.turnEndsAt = null;
  s.pending = null;
  ctx.emit({ type: 'win', seat: s.winner });
  return true;
}

/** 反应窗口结束：偶数次「不要」= 生效 @param {State} s @param {Ctx} ctx */
function resolve(s, ctx) {
  const p = /** @type {Pending} */ (s.pending);
  s.pending = null;
  s.phase = 'turn';
  if (p.nopes % 2 === 1) {
    log(s, { k: 'cancelled', kind: p.kind, by: p.by });
    ctx.emit({ type: 'cancelled', kind: p.kind, by: p.by });
    resetTurnTimer(s, ctx);
    return;
  }
  ctx.emit({ type: 'resolved', kind: p.kind, by: p.by });
  switch (p.kind) {
    case 'attack': {
      const next = nextAlive(s, s.turn);
      const turns = s.underAttack ? s.turnsLeft + 2 : 2;
      s.turn = next;
      s.turnsLeft = turns;
      s.underAttack = true;
      log(s, { k: 'attacked', by: p.by, to: next, turns });
      resetTurnTimer(s, ctx);
      return;
    }
    case 'skip':
      log(s, { k: 'skipped', by: p.by });
      endTurn(s, ctx);
      return;
    case 'shuffle':
      s.deck = ctx.rng.shuffle(s.deck);
      s.deckVer++;
      log(s, { k: 'shuffled', by: p.by });
      break;
    case 'future': {
      const top = s.deck.slice(0, 3);
      s.peeks[p.by] = { ids: top.map((c) => c.id), deckVer: s.deckVer };
      ctx.emit({ type: 'future', cards: top }, { to: p.by });
      log(s, { k: 'peeked', by: p.by });
      break;
    }
    case 'favor': {
      const target = /** @type {number} */ (p.target);
      if (s.hands[target].length === 0) {
        log(s, { k: 'favor_empty', by: p.by, target });
        break;
      }
      s.phase = 'favor';
      s.favor = { from: target, to: p.by };
      resetTurnTimer(s, ctx);
      return;
    }
    case 'pair': {
      const target = /** @type {number} */ (p.target);
      const hand = s.hands[target];
      if (!hand.length) { log(s, { k: 'steal_empty', by: p.by, target }); break; }
      const card = hand.splice(ctx.rng.int(hand.length), 1)[0];
      s.hands[p.by].push(card);
      log(s, { k: 'stole', by: p.by, target });
      ctx.emit({ type: 'got', card, from: target }, { to: p.by });
      ctx.emit({ type: 'lost', card, to: p.by }, { to: target });
      break;
    }
    case 'triple': {
      const target = /** @type {number} */ (p.target);
      const i = s.hands[target].findIndex((c) => c.t === p.named);
      if (i < 0) {
        log(s, { k: 'named_miss', by: p.by, target, named: p.named });
        break;
      }
      const card = s.hands[target].splice(i, 1)[0];
      s.hands[p.by].push(card);
      log(s, { k: 'named_hit', by: p.by, target, named: p.named });
      ctx.emit({ type: 'got', card, from: target }, { to: p.by });
      ctx.emit({ type: 'lost', card, to: p.by }, { to: target });
      break;
    }
  }
  resetTurnTimer(s, ctx);
}

/** @param {State} s @param {number} seat @param {Ctx} ctx */
function draw(s, seat, ctx) {
  const card = /** @type {Card} */ (s.deck.shift());
  s.deckVer++;
  if (card.t !== 'kitten') {
    s.hands[seat].push(card);
    log(s, { k: 'drew', seat });
    ctx.emit({ type: 'drew', seat });
    ctx.emit({ type: 'got', card }, { to: seat });
    endTurn(s, ctx);
    return;
  }
  const defuseAt = s.hands[seat].findIndex((c) => c.t === 'defuse');
  if (defuseAt >= 0) {
    s.discard.push(s.hands[seat].splice(defuseAt, 1)[0]);
    s.phase = 'insert';
    s.insert = { seat, card };
    log(s, { k: 'defused', seat });
    ctx.emit({ type: 'defused', seat });
    resetTurnTimer(s, ctx);
    return;
  }
  // 炸了：手牌和这只猫都进弃牌堆
  s.alive[seat] = false;
  s.discard.push(card, ...s.hands[seat]);
  s.hands[seat] = [];
  log(s, { k: 'exploded', seat });
  ctx.emit({ type: 'exploded', seat });
  if (checkWinner(s, ctx)) return;
  s.turn = nextAlive(s, seat);
  s.turnsLeft = 1;
  s.underAttack = false;
  s.phase = 'turn';
  resetTurnTimer(s, ctx);
}

/** @param {State} s @param {number} pos @param {Ctx} ctx */
function insertKitten(s, pos, ctx) {
  const ins = /** @type {{ seat: number, card: Card }} */ (s.insert);
  s.deck.splice(pos, 0, ins.card);
  s.deckVer++;
  s.insert = null;
  log(s, { k: 'inserted', seat: ins.seat });
  ctx.emit({ type: 'inserted', seat: ins.seat });
  endTurn(s, ctx);
}

/** @param {State} s @param {string} id @param {Ctx} ctx */
function give(s, id, ctx) {
  const f = /** @type {{ from: number, to: number }} */ (s.favor);
  const card = takeFromHand(s, f.from, id);
  if (!card) return 'kittens.err.no_card';
  s.hands[f.to].push(card);
  s.favor = null;
  s.phase = 'turn';
  log(s, { k: 'gave', from: f.from, to: f.to });
  ctx.emit({ type: 'got', card, from: f.from }, { to: f.to });
  resetTurnTimer(s, ctx);
}

/**
 * 判断一组牌能怎么出。
 * @param {Card[]} cards
 * @returns {Pending['kind'] | null}
 */
function comboKind(cards) {
  if (cards.length === 1 && ACTIONS.includes(cards[0].t)) return /** @type {any} */ (cards[0].t);
  if (cards.length >= 2 && cards.length <= 3 && isCat(cards[0].t) && cards.every((c) => c.t === cards[0].t)) {
    return cards.length === 2 ? 'pair' : 'triple';
  }
  return null;
}

/** @param {State} s @param {number} seat @param {{ ids: string[], target?: number, named?: string }} args @param {Ctx} ctx */
function play(s, seat, args, ctx) {
  if (s.phase !== 'turn' || seat !== s.turn) return 'err.not_your_turn';
  const ids = [...new Set(args.ids)];
  if (ids.length !== args.ids.length) return 'kittens.err.bad_combo';
  const hand = s.hands[seat];
  const cards = ids.map((id) => hand.find((c) => c.id === id));
  if (cards.some((c) => !c)) return 'kittens.err.no_card';
  const kind = comboKind(/** @type {Card[]} */ (cards));
  if (!kind) return 'kittens.err.bad_combo';

  let target = null;
  if (kind === 'favor' || kind === 'pair' || kind === 'triple') {
    target = args.target;
    if (target === undefined || target === seat || target >= s.n || !s.alive[target]) return 'kittens.err.bad_target';
    if (s.hands[target].length === 0) return 'kittens.err.target_empty';
  }
  let named = null;
  if (kind === 'triple') {
    if (!args.named || !NAMEABLE.includes(args.named)) return 'kittens.err.bad_named';
    named = /** @type {CardType} */ (args.named);
  }

  for (const id of ids) s.discard.push(/** @type {Card} */ (takeFromHand(s, seat, id)));
  s.pending = {
    kind, by: seat, target, named,
    cards: /** @type {Card[]} */ (cards), nopes: 0, lastNoper: null,
    endsAt: ctx.now + s.reactSec * 1000,
  };
  s.phase = 'reaction';
  log(s, { k: 'played', by: seat, kind, target, named, cards: s.pending.cards.map((c) => c.t) });
  ctx.emit({ type: 'played', by: seat, kind, target, named });
}

/** @param {State} s @param {number} seat @param {{ id: string }} args @param {Ctx} ctx */
function nope(s, seat, args, ctx) {
  if (s.phase !== 'reaction' || !s.pending) return 'kittens.err.nothing_to_nope';
  if (!s.alive[seat]) return 'kittens.err.out';
  const card = s.hands[seat].find((c) => c.id === args.id);
  if (!card || card.t !== 'nope') return 'kittens.err.no_card';
  s.discard.push(/** @type {Card} */ (takeFromHand(s, seat, args.id)));
  s.pending.nopes += 1;
  s.pending.lastNoper = seat;
  s.pending.endsAt = ctx.now + s.reactSec * 1000;
  log(s, { k: 'noped', seat, nopes: s.pending.nopes });
  ctx.emit({ type: 'noped', seat, nopes: s.pending.nopes });
}

/** @param {State} s @param {number} seat */
function peekFor(s, seat) {
  const p = s.peeks[seat];
  if (!p || p.deckVer !== s.deckVer) return null;
  return s.deck.slice(0, p.ids.length);
}

/** @type {import('../../server/types').GameDef<State, Options>} */
module.exports = {
  id: 'kittens',
  name: '爆炸猫',
  blurb: '轮流摸牌，摸到爆炸猫就出局，最后活着的人赢',
  rulesVersion: 1,
  players: { min: 2, max: 5 },
  options: {
    turnSec: { type: 'enum', values: [30, 60, 0], labels: ['30 秒', '60 秒', '不限'], default: 30, label: '每回合时间' },
    reactSec: { type: 'enum', values: [3, 5], labels: ['3 秒', '5 秒'], default: 3, label: '「不要」反应时间' },
  },

  setup(ctx) {
    const n = ctx.seats.length;
    let next = 0;
    /** @param {CardType} t @returns {Card} */
    const make = (t) => ({ id: `k${next++}`, t });

    /** @type {Card[]} */
    let pile = [];
    for (const [t, count] of Object.entries(COUNTS)) {
      for (let i = 0; i < count; i++) pile.push(make(/** @type {CardType} */ (t)));
    }
    pile = ctx.rng.shuffle(pile);
    const hands = Array.from({ length: n }, () => [make('defuse'), ...pile.splice(0, HAND_SIZE)]);
    const extraDefuse = Math.min(2, 6 - n);
    for (let i = 0; i < extraDefuse; i++) pile.push(make('defuse'));
    for (let i = 0; i < n - 1; i++) pile.push(make('kitten'));
    const deck = ctx.rng.shuffle(pile);

    return {
      n,
      alive: Array(n).fill(true),
      hands,
      deck,
      discard: [],
      turn: ctx.rng.int(n),
      turnsLeft: 1,
      underAttack: false,
      phase: 'turn',
      pending: null,
      favor: null,
      insert: null,
      peeks: Array(n).fill(null),
      deckVer: 0,
      turnEndsAt: ctx.options.turnSec > 0 ? ctx.now + ctx.options.turnSec * 1000 : null,
      turnSec: ctx.options.turnSec,
      reactSec: ctx.options.reactSec,
      log: [],
      winner: null,
      total: next,
    };
  },

  moves: {
    play: { args: { ids: 'string[]', target: 'seat?', named: 'string?' }, apply: play },
    nope: { args: { id: 'string' }, anytime: true, apply: nope },
    draw: {
      args: {},
      apply(s, seat, _args, ctx) {
        if (s.phase !== 'turn' || seat !== s.turn) return 'err.not_your_turn';
        draw(s, seat, ctx);
      },
    },
    insert: {
      args: { pos: 'int' },
      apply(s, seat, { pos }, ctx) {
        if (s.phase !== 'insert' || !s.insert || s.insert.seat !== seat) return 'err.not_your_turn';
        if (pos < 0 || pos > s.deck.length) return 'kittens.err.bad_pos';
        insertKitten(s, pos, ctx);
      },
    },
    give: {
      args: { id: 'string' },
      apply(s, seat, { id }, ctx) {
        if (s.phase !== 'favor' || !s.favor || s.favor.from !== seat) return 'err.not_your_turn';
        return give(s, id, ctx);
      },
    },
  },

  actors(s) {
    switch (s.phase) {
      case 'turn': return [s.turn];
      // 反应窗口里所有活着的人都"可以行动"：只列出有「不要」的人会泄露谁手里有这张牌
      case 'reaction': return s.alive.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
      case 'favor': return s.favor ? [s.favor.from] : [];
      case 'insert': return s.insert ? [s.insert.seat] : [];
      default: return [];
    }
  },

  deadline(s) {
    if (s.phase === 'over') return null;
    if (s.phase === 'reaction') return s.pending ? s.pending.endsAt : null;
    return s.turnEndsAt;
  },

  onTimeout(s, ctx) {
    switch (s.phase) {
      case 'reaction': resolve(s, ctx); return;
      case 'turn': draw(s, s.turn, ctx); return; // 超时自动摸牌
      case 'favor': {
        const f = /** @type {{ from: number, to: number }} */ (s.favor);
        const hand = s.hands[f.from];
        return give(s, hand[ctx.rng.int(hand.length)].id, ctx);
      }
      case 'insert': insertKitten(s, ctx.rng.int(s.deck.length + 1), ctx); return;
    }
    return 'err.not_due';
  },

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < s.n ? seat : null;
    return {
      n: s.n,
      phase: s.phase,
      turn: s.turn,
      turnsLeft: s.turnsLeft,
      alive: s.alive,
      handCounts: s.hands.map((h) => h.length),
      hand: me === null ? [] : s.hands[me],
      deckCount: s.deck.length,
      kittensLeft: s.deck.filter((c) => c.t === 'kitten').length,
      discardTop: s.discard.length ? s.discard[s.discard.length - 1] : null,
      discardCount: s.discard.length,
      pending: s.pending && {
        kind: s.pending.kind, by: s.pending.by, target: s.pending.target, named: s.pending.named,
        cards: s.pending.cards.map((c) => c.t), nopes: s.pending.nopes, lastNoper: s.pending.lastNoper, endsAt: s.pending.endsAt,
      },
      favor: s.favor,
      inserting: s.insert ? s.insert.seat : null,
      peek: me === null ? null : peekFor(s, me),
      turnEndsAt: s.turnEndsAt,
      reactSec: s.reactSec,
      log: s.log.slice(-12),
      winner: s.winner,
    };
  },

  result(s) {
    return s.winner === null ? null : { winners: [s.winner] };
  },

  legalMoves(s, seat) {
    /** @type {import('../../server/types').LegalMove[]} */
    const out = [];
    if (!s.alive[seat]) return out;
    const hand = s.hands[seat];
    if (s.phase === 'reaction') {
      const n = hand.find((c) => c.t === 'nope');
      if (n) out.push({ name: 'nope', args: { id: n.id } });
      return out;
    }
    if (s.phase === 'favor' && s.favor && s.favor.from === seat) {
      return hand.map((c) => ({ name: 'give', args: { id: c.id } }));
    }
    if (s.phase === 'insert' && s.insert && s.insert.seat === seat) {
      for (let pos = 0; pos <= s.deck.length; pos++) out.push({ name: 'insert', args: { pos } });
      return out;
    }
    if (s.phase !== 'turn' || seat !== s.turn) return out;

    out.push({ name: 'draw', args: {} });
    const targets = s.alive.map((a, i) => (a && i !== seat && s.hands[i].length ? i : -1)).filter((i) => i >= 0);
    const seen = new Set();
    for (const c of hand) {
      if (seen.has(c.t)) continue;
      seen.add(c.t);
      if (c.t === 'favor') for (const target of targets) out.push({ name: 'play', args: { ids: [c.id], target } });
      else if (ACTIONS.includes(c.t)) out.push({ name: 'play', args: { ids: [c.id] } });
      else if (isCat(c.t)) {
        const same = hand.filter((x) => x.t === c.t);
        for (const target of targets) {
          if (same.length >= 2) out.push({ name: 'play', args: { ids: same.slice(0, 2).map((x) => x.id), target } });
          if (same.length >= 3) out.push({ name: 'play', args: { ids: same.slice(0, 3).map((x) => x.id), target, named: 'defuse' } });
        }
      }
    }
    return out;
  },

  invariants(s) {
    const all = [...s.deck, ...s.discard, ...s.hands.flat(), ...(s.insert ? [s.insert.card] : [])];
    if (all.length !== s.total) throw new Error(`牌数不守恒：${all.length} ≠ ${s.total}`);
    if (new Set(all.map((c) => c.id)).size !== all.length) throw new Error('有重复的牌');
    const kittens = s.deck.filter((c) => c.t === 'kitten').length + (s.insert ? 1 : 0);
    const alive = s.alive.filter(Boolean).length;
    if (s.phase !== 'over' && kittens !== alive - 1) throw new Error(`爆炸猫数量 ${kittens} 应该是 ${alive - 1}`);
    if (s.phase !== 'over' && !s.alive[s.turn]) throw new Error('轮到了出局的人');
  },

  secrets(s, seat) {
    const visible = new Set((peekFor(s, seat) || []).map((c) => c.id));
    const hidden = [
      ...s.hands.flatMap((h, i) => (i === seat ? [] : h)),
      ...s.deck.filter((c) => !visible.has(c.id)),
      ...(s.insert ? [s.insert.card] : []),
    ];
    return hidden.map((c) => JSON.stringify(c.id));
  },
};
