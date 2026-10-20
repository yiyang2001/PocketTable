'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Match } = require('../server/match');
const { resolveOptions } = require('../server/args');
const { createRng } = require('../server/rng');
const game = require('../games/kittens/rules');
const bot = require('../games/kittens/bot');

const T0 = 1_000_000;

/** @param {number} n @param {any} [opts] */
function newMatch(n = 3, opts = {}, seed = 'kittens-test') {
  const seats = Array.from({ length: n }, (_, seat) => ({ seat, name: `P${seat}`, bot: false }));
  const m = new Match(game, { seats, options: resolveOptions(game.options, opts), seed, startedAt: T0 });
  m.checkInvariants = true;
  return m;
}

let uid = 1000;
/** @param {string} t */
const card = (t) => ({ id: `x${uid++}`, t });

/**
 * 把局面摆成想要的样子（保持牌数守恒：多出来的牌放进弃牌堆抵消）。
 * @param {Match} m
 * @param {{ hands?: string[][], deck?: string[], turn?: number }} spec
 */
function arrange(m, spec) {
  const s = m.state;
  const all = [...s.deck, ...s.discard, ...s.hands.flat()];
  if (spec.hands) s.hands = spec.hands.map((h) => h.map(card));
  if (spec.deck) s.deck = spec.deck.map(card);
  if (spec.turn !== undefined) s.turn = spec.turn;
  const used = s.deck.length + s.hands.flat().length;
  s.discard = all.slice(0, Math.max(0, s.total - used)).map((c) => ({ ...c, t: 'cat5' }));
  s.total = s.deck.length + s.discard.length + s.hands.flat().length;
}

const ids = (m, seat, t) => m.state.hands[seat].filter((c) => c.t === t).map((c) => c.id);
const at = (ms) => T0 + ms;

test('开局：每人 8 张（含 1 张拆除），牌堆里有 人数-1 只猫', () => {
  for (const n of [2, 3, 4, 5]) {
    const m = newMatch(n);
    const s = m.state;
    for (const h of s.hands) {
      assert.equal(h.length, 8);
      assert.ok(h.some((c) => c.t === 'defuse'));
      assert.ok(!h.some((c) => c.t === 'kitten'));
    }
    assert.equal(s.deck.filter((c) => c.t === 'kitten').length, n - 1);
    assert.equal(s.deck.filter((c) => c.t === 'defuse').length, Math.min(2, 6 - n));
  }
});

test('摸到普通牌：进手牌，轮到下家', () => {
  const m = newMatch(3);
  arrange(m, { hands: [['cat1'], ['cat2'], ['cat3']], deck: ['skip', 'kitten', 'kitten'], turn: 0 });
  assert.ok(m.move(0, 'draw', {}, at(1)).ok);
  assert.deepEqual(m.state.hands[0].map((c) => c.t), ['cat1', 'skip']);
  assert.equal(m.state.turn, 1);
});

test('摸到爆炸猫有拆除：用掉拆除，自己选位置放回去', () => {
  const m = newMatch(3);
  arrange(m, { hands: [['defuse', 'cat1'], ['cat2'], ['cat3']], deck: ['kitten', 'skip', 'kitten'], turn: 0 });
  assert.ok(m.move(0, 'draw', {}, at(1)).ok);
  assert.equal(m.state.phase, 'insert');
  assert.deepEqual(m.actors(), [0]);
  assert.equal(m.move(0, 'insert', { pos: 99 }, at(2)).error, 'kittens.err.bad_pos');
  assert.ok(m.move(0, 'insert', { pos: 0 }, at(2)).ok);
  assert.equal(m.state.deck[0].t, 'kitten');
  assert.deepEqual(m.state.hands[0].map((c) => c.t), ['cat1']);
  assert.equal(m.state.turn, 1);
});

test('摸到爆炸猫没有拆除：出局；剩一个人就赢', () => {
  const m = newMatch(2);
  arrange(m, { hands: [['cat1'], ['cat2']], deck: ['kitten', 'skip'], turn: 0 });
  assert.ok(m.move(0, 'draw', {}, at(1)).ok);
  assert.equal(m.state.alive[0], false);
  assert.deepEqual(m.result(), { winners: [1] });
});

test('攻击：下家连摸两回合；被攻击的人再攻击，下家要摸 剩余回合+2', () => {
  const m = newMatch(3);
  arrange(m, { hands: [['attack'], ['attack', 'cat1'], ['cat2']], deck: ['cat3', 'cat4', 'cat5', 'skip', 'kitten', 'kitten'], turn: 0 });
  assert.ok(m.move(0, 'play', { ids: ids(m, 0, 'attack') }, at(1)).ok);
  assert.equal(m.state.phase, 'reaction');
  assert.ok(m.timeout(m.deadline()).ok);
  assert.equal(m.state.turn, 1);
  assert.equal(m.state.turnsLeft, 2);
  assert.ok(m.move(1, 'play', { ids: ids(m, 1, 'attack') }, at(5000)).ok);
  assert.ok(m.timeout(m.deadline()).ok);
  assert.equal(m.state.turn, 2);
  assert.equal(m.state.turnsLeft, 4);
});

test('跳过：被攻击时只跳过一个回合', () => {
  const m = newMatch(3);
  arrange(m, { hands: [['attack'], ['skip', 'cat1'], ['cat2']], deck: ['cat3', 'cat4', 'kitten', 'kitten'], turn: 0 });
  m.move(0, 'play', { ids: ids(m, 0, 'attack') }, at(1));
  m.timeout(m.deadline());
  m.move(1, 'play', { ids: ids(m, 1, 'skip') }, at(5000));
  m.timeout(m.deadline());
  assert.equal(m.state.turn, 1);
  assert.equal(m.state.turnsLeft, 1);
  m.move(1, 'draw', {}, at(9000));
  assert.equal(m.state.turn, 2);
});

test('「不要」：一次取消，两次生效；每次都重新计时；结算前不能抢着出牌', () => {
  const m = newMatch(3, { reactSec: 3 });
  arrange(m, { hands: [['skip', 'nope'], ['nope', 'cat1'], ['nope', 'cat2']], deck: ['cat3', 'kitten', 'kitten'], turn: 0 });
  m.move(0, 'play', { ids: ids(m, 0, 'skip') }, at(1000));
  assert.deepEqual(m.actors(), [0, 1, 2]); // 反应窗口里所有人都能行动，不暴露谁有「不要」
  assert.equal(m.move(0, 'draw', {}, at(1500)).error, 'err.not_your_turn');
  assert.equal(m.timeout(at(3999)).error, 'err.not_due');
  assert.ok(m.move(1, 'nope', { id: ids(m, 1, 'nope')[0] }, at(3500)).ok);
  assert.equal(m.timeout(at(4001)).error, 'err.not_due'); // 重新计时到 6500
  assert.ok(m.move(0, 'nope', { id: ids(m, 0, 'nope')[0] }, at(4000)).ok);
  assert.ok(m.timeout(at(7000)).ok);
  assert.equal(m.state.turn, 1, '两次「不要」互相抵消，跳过生效');

  const m2 = newMatch(3);
  arrange(m2, { hands: [['skip'], ['nope'], ['cat2']], deck: ['cat3', 'kitten', 'kitten'], turn: 0 });
  m2.move(0, 'play', { ids: ids(m2, 0, 'skip') }, at(1));
  m2.move(1, 'nope', { id: ids(m2, 1, 'nope')[0] }, at(2));
  m2.timeout(m2.deadline());
  assert.equal(m2.state.turn, 0, '被「不要」了，还是自己的回合');
  assert.equal(m2.state.phase, 'turn');
});

test('索要：对方自己挑一张给你；超时随机给', () => {
  const m = newMatch(3);
  arrange(m, { hands: [['favor'], ['defuse', 'cat1'], ['cat2']], deck: ['cat3', 'kitten', 'kitten'], turn: 0 });
  assert.equal(m.move(0, 'play', { ids: ids(m, 0, 'favor') }, at(1)).error, 'kittens.err.bad_target');
  assert.equal(m.move(0, 'play', { ids: ids(m, 0, 'favor'), target: 0 }, at(1)).error, 'kittens.err.bad_target');
  assert.ok(m.move(0, 'play', { ids: ids(m, 0, 'favor'), target: 1 }, at(1)).ok);
  m.timeout(m.deadline());
  assert.equal(m.state.phase, 'favor');
  assert.deepEqual(m.actors(), [1]);
  assert.ok(m.move(1, 'give', { id: ids(m, 1, 'cat1')[0] }, at(5000)).ok);
  assert.deepEqual(m.state.hands[0].map((c) => c.t), ['cat1']);
  assert.equal(m.state.phase, 'turn');
  assert.equal(m.state.turn, 0);

  const m2 = newMatch(3, { turnSec: 30 });
  arrange(m2, { hands: [['favor'], ['cat1'], ['cat2']], deck: ['cat3', 'kitten', 'kitten'], turn: 0 });
  m2.move(0, 'play', { ids: ids(m2, 0, 'favor'), target: 1 }, at(1));
  m2.timeout(m2.deadline());
  assert.ok(m2.timeout(m2.deadline()).ok);
  assert.deepEqual(m2.state.hands[0].map((c) => c.t), ['cat1']);
});

test('对子随机偷一张；三条点名，有就拿、没有就落空', () => {
  const m = newMatch(3);
  arrange(m, { hands: [['cat1', 'cat1', 'cat2', 'cat2', 'cat2'], ['defuse'], ['skip']], deck: ['cat3', 'kitten', 'kitten'], turn: 0 });
  assert.equal(m.move(0, 'play', { ids: [ids(m, 0, 'cat1')[0], ids(m, 0, 'cat2')[0]], target: 1 }, at(1)).error, 'kittens.err.bad_combo');
  assert.ok(m.move(0, 'play', { ids: ids(m, 0, 'cat1'), target: 1 }, at(1)).ok);
  m.timeout(m.deadline());
  assert.ok(m.state.hands[0].some((c) => c.t === 'defuse'));
  assert.equal(m.state.hands[1].length, 0);
  assert.equal(m.move(0, 'play', { ids: ids(m, 0, 'cat2'), target: 1, named: 'skip' }, at(5000)).error, 'kittens.err.target_empty');
  assert.equal(m.move(0, 'play', { ids: ids(m, 0, 'cat2'), target: 2, named: 'kitten' }, at(5000)).error, 'kittens.err.bad_named');
  assert.ok(m.move(0, 'play', { ids: ids(m, 0, 'cat2'), target: 2, named: 'skip' }, at(5000)).ok);
  m.timeout(m.deadline());
  assert.ok(m.state.hands[0].some((c) => c.t === 'skip'));
});

test('先知：只有自己看得到牌堆顶 3 张；牌堆一变就失效', () => {
  const m = newMatch(3);
  arrange(m, { hands: [['future', 'shuffle'], ['cat1'], ['cat2']], deck: ['cat3', 'skip', 'kitten', 'kitten', 'cat4'], turn: 0 });
  m.move(0, 'play', { ids: ids(m, 0, 'future') }, at(1));
  m.timeout(m.deadline());
  assert.deepEqual(m.view(0).peek.map((c) => c.t), ['cat3', 'skip', 'kitten']);
  assert.equal(m.view(1).peek, null);
  assert.ok(!JSON.stringify(m.view(1)).includes(m.state.deck[0].id));
  m.move(0, 'play', { ids: ids(m, 0, 'shuffle') }, at(5000));
  m.timeout(m.deadline());
  assert.equal(m.view(0).peek, null);
});

test('不能单独出「不要」「拆除」；回合超时自动摸牌', () => {
  const m = newMatch(3, { turnSec: 30 });
  arrange(m, { hands: [['nope', 'defuse'], ['cat1'], ['cat2']], deck: ['cat3', 'kitten', 'kitten'], turn: 0 });
  assert.equal(m.move(0, 'play', { ids: ids(m, 0, 'nope') }, at(1)).error, 'kittens.err.bad_combo');
  assert.equal(m.move(0, 'play', { ids: ids(m, 0, 'defuse') }, at(1)).error, 'kittens.err.bad_combo');
  assert.equal(m.move(0, 'nope', { id: ids(m, 0, 'nope')[0] }, at(1)).error, 'kittens.err.nothing_to_nope');
  assert.ok(m.timeout(at(30_000)).ok);
  assert.equal(m.state.hands[0].length, 3);
  assert.equal(m.state.turn, 1);
});

test('全是电脑：各种人数都能正常打完，电脑出的招都合法', () => {
  for (const n of [2, 3, 4, 5]) {
    for (let g = 0; g < 40; g++) {
      const m = newMatch(n, {}, `bots-${n}-${g}`);
      const rng = createRng(`bot-${n}-${g}`);
      let now = T0;
      let illegal = 0;
      for (let step = 0; step < 3000 && !m.result(); step++) {
        now += 300;
        let moved = false;
        for (const seat of m.actors()) {
          const choice = bot.decide(m.view(seat), seat, rng);
          if (!choice) continue;
          const r = m.move(seat, choice.name, choice.args, now);
          if (!r.ok) illegal++;
          moved = true;
          break;
        }
        if (!moved) {
          const due = m.deadline();
          assert.ok(due !== null, '没人出牌也没有截止时间');
          now = Math.max(now, due);
          m.timeout(now);
        }
      }
      assert.ok(m.result(), `${n} 人第 ${g} 局没打完`);
      assert.equal(illegal, 0, `${n} 人第 ${g} 局电脑出了非法招`);
    }
  }
});
