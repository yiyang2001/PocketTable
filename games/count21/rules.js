'use strict';
// 抢 21：轮流报数，每次加 1–3，谁报到目标数谁输。
// 规则很小，用来验证引擎、房间、bot、计时和重放整条链路；爆炸猫做好后会从大厅隐藏。

/**
 * @typedef {{ target: number, turnSec: number }} Options
 * @typedef {{
 *   target: number,
 *   total: number,
 *   current: number,
 *   order: number[],
 *   history: { seat: number, n: number, total: number }[],
 *   loser: number | null,
 *   turnEndsAt: number,
 * }} State
 */

/** @param {State} s @param {import('../../server/types').Ctx<Options>} ctx */
function nextTurn(s, ctx) {
  const i = s.order.indexOf(s.current);
  s.current = s.order[(i + 1) % s.order.length];
  s.turnEndsAt = ctx.now + ctx.options.turnSec * 1000;
}

/**
 * @param {State} s
 * @param {number} seat
 * @param {number} n
 * @param {import('../../server/types').Ctx<Options>} ctx
 */
function add(s, seat, n, ctx) {
  const target = s.target;
  if (n < 1 || n > 3) return 'count21.err.range';
  if (s.total + n > target) return 'count21.err.over';
  s.total += n;
  s.history.push({ seat, n, total: s.total });
  ctx.emit({ type: 'added', seat, n, total: s.total });
  if (s.total === target) {
    s.loser = seat;
    ctx.emit({ type: 'lost', seat });
    return;
  }
  nextTurn(s, ctx);
}

/** @type {import('../../server/types').GameDef<State, Options>} */
module.exports = {
  id: 'count21',
  name: '抢 21',
  blurb: '轮流报数，每次 1 到 3，谁报到 21 谁输',
  rulesVersion: 1,
  players: { min: 2, max: 6 },
  options: {
    target: { type: 'enum', values: [21, 31], default: 21, label: '目标数' },
    turnSec: { type: 'enum', values: [10, 20, 30], default: 20, label: '每回合秒数' },
  },

  setup(ctx) {
    const order = ctx.seats.map((s) => s.seat);
    return {
      target: ctx.options.target,
      total: 0,
      current: ctx.rng.pick(order),
      order,
      history: [],
      loser: null,
      turnEndsAt: ctx.now + ctx.options.turnSec * 1000,
    };
  },

  moves: {
    add: {
      args: { n: 'int' },
      apply: (s, seat, { n }, ctx) => add(s, seat, n, ctx),
    },
  },

  actors: (s) => (s.loser === null ? [s.current] : []),
  deadline: (s) => (s.loser === null ? s.turnEndsAt : null),
  // 超时自动报 1
  onTimeout: (s, ctx) => add(s, s.current, 1, ctx),

  view: (s) => ({
    target: s.target,
    total: s.total,
    current: s.current,
    history: s.history.slice(-12),
    loser: s.loser,
    turnEndsAt: s.turnEndsAt,
  }),

  result(s) {
    if (s.loser === null) return null;
    return { winners: s.order.filter((seat) => seat !== s.loser) };
  },

  legalMoves(s, seat) {
    if (s.loser !== null || seat !== s.current) return [];
    return [1, 2, 3].filter((n) => s.total + n <= s.target).map((n) => ({ name: 'add', args: { n } }));
  },

  invariants(s) {
    if (s.total < 0 || s.total > s.target) throw new Error('total 超出范围');
    if (s.history.reduce((a, h) => a + h.n, 0) !== s.total) throw new Error('history 与 total 不一致');
  },
};
