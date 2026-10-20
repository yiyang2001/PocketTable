'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRng } = require('../server/rng');
const { checkArgs, resolveOptions } = require('../server/args');
const { Match } = require('../server/match');
const count21 = require('../games/count21/rules');

const seats = [{ seat: 0, name: 'A', bot: false }, { seat: 1, name: 'B', bot: false }];
const newMatch = (seed = 'seed-1') =>
  new Match(count21, { seats, options: resolveOptions(count21.options), seed, startedAt: 1000 });

test('rng：同一个种子得到同一串数，不同种子不同', () => {
  const a = createRng('abc'), b = createRng('abc'), c = createRng('abd');
  const seqA = Array.from({ length: 20 }, () => a.next());
  assert.deepEqual(seqA, Array.from({ length: 20 }, () => b.next()));
  assert.notDeepEqual(seqA, Array.from({ length: 20 }, () => c.next()));
  assert.ok(seqA.every((x) => x >= 0 && x < 1));
});

test('rng：save / restore 能回到同一位置；shuffle 是排列且不改原数组', () => {
  const r = createRng('x');
  const saved = r.save();
  const first = r.int(1000);
  r.restore(saved);
  assert.equal(r.int(1000), first);
  const arr = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = r.shuffle(arr);
  assert.deepEqual(arr, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...out].sort(), arr);
});

test('args：按声明校验类型、可选项和多余字段', () => {
  const spec = { n: 'int', ids: 'string[]', to: 'seat?' };
  assert.equal(checkArgs(spec, { n: 1, ids: ['a'] }), null);
  assert.equal(checkArgs(spec, { n: 1, ids: ['a'], to: 2 }), null);
  assert.equal(checkArgs(spec, { n: 1.5, ids: [] }), 'err.bad_args');
  assert.equal(checkArgs(spec, { n: 1 }), 'err.bad_args');
  assert.equal(checkArgs(spec, { n: 1, ids: [], hack: true }), 'err.bad_args');
  assert.equal(checkArgs(spec, [1]), 'err.bad_args');
  assert.equal(checkArgs({}, undefined), null);
});

test('options：非法值退回默认值', () => {
  assert.deepEqual(resolveOptions(count21.options, { target: 99, turnSec: 10 }), { target: 21, turnSec: 10 });
});

test('match：非法出招不改状态、不推进版本、不消耗随机数', () => {
  const m = newMatch();
  const before = structuredClone(m.state);
  const rngBefore = m.rng.save();
  const other = 1 - m.state.current;
  assert.equal(m.move(other, 'add', { n: 1 }, 2000).error, 'err.not_your_turn');
  assert.equal(m.move(m.state.current, 'add', { n: 4 }, 2000).error, 'count21.err.range');
  assert.equal(m.move(m.state.current, 'nope', {}, 2000).error, 'err.unknown_move');
  assert.equal(m.move(m.state.current, 'add', { n: '1' }, 2000).error, 'err.bad_args');
  assert.deepEqual(m.state, before);
  assert.deepEqual(m.rng.save(), rngBefore);
  assert.equal(m.ver, 0);
  assert.equal(m.record.log.length, 0);
});

test('match：超时只在截止时间之后生效', () => {
  const m = newMatch();
  const due = /** @type {number} */ (m.deadline());
  assert.equal(m.timeout(due - 1).error, 'err.not_due');
  const r = m.timeout(due);
  assert.ok(r.ok);
  assert.equal(m.state.total, 1);
});

test('match：事件可以只发给某个座位', () => {
  const m = newMatch();
  const events = [{ evt: { type: 'a' }, to: null }, { evt: { type: 'b' }, to: 1 }];
  assert.deepEqual(m.eventsFor(events, 0).map((e) => e.type), ['a']);
  assert.deepEqual(m.eventsFor(events, 1).map((e) => e.type), ['a', 'b']);
});

test('match：按记录重放得到完全相同的状态', () => {
  const m = newMatch('replay-seed');
  let t = 1000;
  while (!m.result()) {
    t += 500;
    const seat = m.actors()[0];
    const legal = /** @type {any} */ (count21).legalMoves(m.state, seat);
    if (t % 3000 === 0) m.timeout(/** @type {number} */ (m.deadline()));
    else m.move(seat, 'add', legal[legal.length - 1].args, t);
  }
  const copy = Match.replay(count21, structuredClone(m.record));
  assert.deepEqual(copy.state, m.state);
  assert.equal(copy.ver, m.ver);
  assert.deepEqual(copy.result(), m.result());
});

test('match：记录被篡改时重放报错，而不是悄悄得到另一个结果', () => {
  const m = newMatch();
  m.move(m.state.current, 'add', { n: 2 }, 1500);
  const rec = structuredClone(m.record);
  rec.log[0].seat = 1 - /** @type {number} */ (rec.log[0].seat);
  assert.throws(() => Match.replay(count21, rec), /分叉/);
});
