'use strict';
// 带种子的随机数：cyrb128 把字符串种子散列成 4 个 32 位整数，再用 sfc32 生成。
// 同一个种子在任何平台上都得到同一串数，这是对局能重放的前提。

const crypto = require('crypto');

/** @param {string} str */
function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * @param {string} seed
 * @returns {import('./types').Rng}
 */
function createRng(seed) {
  let [a, b, c, d] = cyrb128(String(seed));

  function u32() {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  }
  for (let i = 0; i < 12; i++) u32();

  /** @type {import('./types').Rng} */
  const rng = {
    next: () => u32() / 4294967296,
    int: (n) => Math.floor(rng.next() * n),
    pick: (arr) => arr[rng.int(arr.length)],
    shuffle: (arr) => {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    save: () => [a, b, c, d],
    restore: (s) => { [a, b, c, d] = s; },
  };
  return rng;
}

function randomSeed() {
  return crypto.randomBytes(8).toString('hex');
}

module.exports = { createRng, randomSeed };
