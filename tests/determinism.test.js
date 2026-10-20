'use strict';
// 规则代码里禁止出现不确定的东西，否则对局无法重放。
// 随机数用 ctx.rng，时间用 ctx.now。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { GAMES_DIR } = require('../server/registry');

/** @type {[RegExp, string][]} */
const FORBIDDEN = [
  [/\bMath\.random\s*\(/, 'Math.random()，请用 ctx.rng'],
  [/\bDate\.now\s*\(/, 'Date.now()，请用 ctx.now'],
  [/\bnew Date\s*\(/, 'new Date()，请用 ctx.now'],
  [/\bperformance\.now\s*\(/, 'performance.now()，请用 ctx.now'],
  [/\bset(Timeout|Interval)\s*\(/, '计时器，请用 deadline / onTimeout / tick'],
];

for (const id of fs.readdirSync(GAMES_DIR)) {
  const file = path.join(GAMES_DIR, id, 'rules.js');
  if (!fs.existsSync(file)) continue;
  test(`确定性：games/${id}/rules.js`, () => {
    const src = fs.readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');
    for (const [re, why] of FORBIDDEN) assert.ok(!re.test(src), `games/${id}/rules.js 用了 ${why}`);
  });
}
