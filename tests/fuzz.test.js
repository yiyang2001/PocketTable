'use strict';
// 通用随机对局测试：对每款游戏、每种人数随机打很多局，检查
//   不崩溃 · 一定能结束 · 不变量始终成立 · 不泄露别人的秘密 · 重放结果一致。
// 新游戏只要实现 legalMoves（建议再加 invariants / secrets），就自动纳入。

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRegistry } = require('../server/registry');
const { Match } = require('../server/match');
const { createRng } = require('../server/rng');
const { resolveOptions } = require('../server/args');

const GAMES_PER_SIZE = Number(process.env.FUZZ_GAMES || 60);
const MAX_STEPS = 5000;

/**
 * @param {import('../server/types').GameDef} game
 * @param {number} players
 * @param {string} seed
 */
function playRandom(game, players, seed) {
  const pick = createRng(`pick-${seed}`);
  const seats = Array.from({ length: players }, (_, seat) => ({ seat, name: `P${seat}`, bot: false }));
  // 选项也随机，覆盖不同规则组合
  /** @type {Record<string, any>} */
  const options = {};
  for (const [k, def] of Object.entries(game.options || {})) {
    options[k] = def.type === 'enum' ? pick.pick(def.values) : def.min + pick.int(def.max - def.min + 1);
  }
  let now = 1_000_000;
  const m = new Match(game, { seats, options: resolveOptions(game.options, options), seed, startedAt: now });
  m.checkInvariants = true;
  if (game.invariants) game.invariants(m.state);

  for (let step = 0; step < MAX_STEPS && !m.result(); step++) {
    now += 1 + pick.int(400);
    checkSecrets(game, m, players);
    const moves = [];
    for (const seat of m.actors()) {
      for (const mv of /** @type {NonNullable<typeof game.legalMoves>} */ (game.legalMoves)(m.state, seat)) moves.push({ seat, ...mv });
    }
    const due = m.deadline();
    if (moves.length && (due === null || pick.next() < 0.9)) {
      const mv = pick.pick(moves);
      const r = m.move(mv.seat, mv.name, mv.args, now);
      assert.ok(r.ok, `${game.id}：legalMoves 给出的招被拒绝：${JSON.stringify(mv)} → ${r.error}`);
    } else if (due !== null) {
      now = Math.max(now, due);
      const r = m.timeout(now);
      assert.ok(r.ok, `${game.id}：超时处理失败：${r.error}`);
    } else if (game.tick) {
      m.tick(now);
    } else {
      assert.fail(`${game.id}：没人能行动、也没有截止时间，对局卡死（第 ${step} 步）`);
    }
  }
  assert.ok(m.result(), `${game.id}：${MAX_STEPS} 步内没有结束（${players} 人，种子 ${seed}）`);

  const replayed = Match.replay(game, structuredClone(m.record));
  assert.deepEqual(replayed.state, m.state, `${game.id}：重放结果不一致（种子 ${seed}）`);
}

/**
 * @param {import('../server/types').GameDef} game
 * @param {Match} m
 * @param {number} players
 */
function checkSecrets(game, m, players) {
  if (!game.secrets) return;
  for (let seat = 0; seat < players; seat++) {
    const view = JSON.stringify(game.view(m.state, seat));
    for (const secret of game.secrets(m.state, seat)) {
      assert.ok(!view.includes(secret), `${game.id}：座位 ${seat} 的视角里出现了不该看到的 "${secret}"`);
    }
  }
}

for (const { game } of loadRegistry().values()) {
  if (!game.legalMoves) {
    test(`fuzz ${game.id}：没有 legalMoves，跳过`, { skip: true }, () => {});
    continue;
  }
  for (let n = game.players.min; n <= game.players.max; n++) {
    test(`fuzz ${game.id}：${n} 人随机打 ${GAMES_PER_SIZE} 局`, () => {
      for (let i = 0; i < GAMES_PER_SIZE; i++) playRandom(game, n, `${game.id}-${n}-${i}`);
    });
  }
}
