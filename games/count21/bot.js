'use strict';
// 两人局的必胜策略：让报完后的总数和"目标数 - 1"对 4 同余。做不到就随便报。

/** @type {import('../../server/types').BotDef} */
module.exports = {
  decide(view, seat, rng) {
    if (view.current !== seat || view.loser !== null) return null;
    const room = view.target - view.total;
    const best = (view.target - 1 - view.total) % 4;
    if (best >= 1 && best <= 3) return { name: 'add', args: { n: best } };
    const n = 1 + rng.int(Math.min(3, room));
    return { name: 'add', args: { n } };
  },
};
