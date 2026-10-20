'use strict';
// 爆炸猫电脑：只看自己的视角（自己的手牌、牌堆张数、剩几只猫、先知看到的牌）。
// 思路：危险高就先看牌 / 跳过 / 攻击；知道下一张是猫就躲开；有对子就偷牌；被针对时用「不要」。

const CATS = ['cat1', 'cat2', 'cat3', 'cat4', 'cat5'];
const GIVE_ORDER = ['cat1', 'cat2', 'cat3', 'cat4', 'cat5', 'shuffle', 'future', 'favor', 'skip', 'attack', 'nope', 'defuse'];

/** @param {any[]} hand @param {string} t */
const find = (hand, t) => hand.find((c) => c.t === t);

/** 其他活着且有牌的人，牌最多的排前面 @param {any} v @param {number} seat */
function targets(v, seat) {
  return v.alive
    .map((a, i) => (a && i !== seat && v.handCounts[i] > 0 ? i : -1))
    .filter((i) => i >= 0)
    .sort((a, b) => v.handCounts[b] - v.handCounts[a]);
}

/** 下家（攻击的受害者） @param {any} v @param {number} from */
function nextAlive(v, from) {
  for (let i = 1; i <= v.n; i++) {
    const seat = (from + i) % v.n;
    if (v.alive[seat]) return seat;
  }
  return from;
}

/** @type {import('../../server/types').BotDef} */
module.exports = {
  decide(v, seat, rng) {
    const hand = v.hand;

    if (v.phase === 'reaction') {
      const p = v.pending;
      const nope = find(hand, 'nope');
      if (!p || !nope) return null;
      const againstMe = p.nopes % 2 === 0
        ? p.by !== seat && (p.target === seat || (p.kind === 'attack' && nextAlive(v, p.by) === seat))
        : p.by === seat; // 我出的牌被「不要」了，反打回去
      if (againstMe && p.lastNoper !== seat && rng.next() < 0.65) return { name: 'nope', args: { id: nope.id } };
      return null;
    }

    if (v.phase === 'favor') {
      if (!v.favor || v.favor.from !== seat) return null;
      for (const t of GIVE_ORDER) {
        const c = find(hand, t);
        if (c) return { name: 'give', args: { id: c.id } };
      }
      return null;
    }

    if (v.phase === 'insert') {
      if (v.inserting !== seat) return null;
      // 一半概率放最上面坑下家，否则随便放
      const pos = rng.next() < 0.5 ? 0 : rng.int(v.deckCount + 1);
      return { name: 'insert', args: { pos } };
    }

    if (v.phase !== 'turn' || v.turn !== seat) return null;

    const hasDefuse = !!find(hand, 'defuse');
    const danger = v.deckCount ? v.kittensLeft / v.deckCount : 0;
    const topIsKitten = v.peek && v.peek.length && v.peek[0].t === 'kitten';
    const topIsSafe = v.peek && v.peek.length && v.peek[0].t !== 'kitten';
    const escape = () => {
      const a = find(hand, 'attack') || find(hand, 'skip');
      return a ? { name: 'play', args: { ids: [a.id] } } : null;
    };

    // 知道下一张是猫：先躲，没法躲就洗牌
    if (topIsKitten) {
      const e = escape();
      if (e) return e;
      const sh = find(hand, 'shuffle');
      if (sh) return { name: 'play', args: { ids: [sh.id] } };
    }
    if (topIsSafe) return { name: 'draw', args: {} };

    // 危险高：先看一眼
    const future = find(hand, 'future');
    if (future && danger > 0.15 && !v.peek) return { name: 'play', args: { ids: [future.id] } };

    // 没拆除时更谨慎
    if (danger > (hasDefuse ? 0.4 : 0.2)) {
      const e = escape();
      if (e && rng.next() < 0.8) return e;
    }

    const ts = targets(v, seat);
    if (ts.length) {
      // 没有拆除时，有三条就点名要拆除
      for (const t of CATS) {
        const same = hand.filter((c) => c.t === t);
        if (same.length >= 3 && !hasDefuse) {
          return { name: 'play', args: { ids: same.slice(0, 3).map((c) => c.id), target: ts[0], named: 'defuse' } };
        }
      }
      for (const t of CATS) {
        const same = hand.filter((c) => c.t === t);
        if (same.length >= 2 && rng.next() < 0.6) {
          return { name: 'play', args: { ids: same.slice(0, 2).map((c) => c.id), target: ts[0] } };
        }
      }
      const favor = find(hand, 'favor');
      if (favor && rng.next() < 0.4) return { name: 'play', args: { ids: [favor.id], target: ts[0] } };
    }

    return { name: 'draw', args: {} };
  },
};
