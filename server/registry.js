'use strict';
// 读取 games/<id>/rules.js 和 bot.js。目录名就是游戏 id。

const fs = require('fs');
const path = require('path');

const GAMES_DIR = path.join(__dirname, '..', 'games');

/**
 * @typedef {{ game: import('./types').GameDef, bot: import('./types').BotDef | null }} GameEntry
 * @returns {Map<string, GameEntry>}
 */
function loadRegistry(dir = GAMES_DIR) {
  /** @type {Map<string, GameEntry>} */
  const out = new Map();
  for (const id of fs.readdirSync(dir).sort()) {
    const rulesPath = path.join(dir, id, 'rules.js');
    if (!fs.existsSync(rulesPath)) continue;
    /** @type {import('./types').GameDef} */
    const game = require(rulesPath);
    if (game.id !== id) throw new Error(`games/${id}/rules.js 的 id 是 "${game.id}"，必须和目录名一致`);
    const botPath = path.join(dir, id, 'bot.js');
    out.set(id, { game, bot: fs.existsSync(botPath) ? require(botPath) : null });
  }
  return out;
}

/** 给客户端的游戏目录 @param {Map<string, GameEntry>} registry */
function catalog(registry) {
  return [...registry.values()].map(({ game, bot }) => ({
    id: game.id,
    name: game.name,
    players: game.players,
    options: game.options || {},
    bots: !!bot,
    realtime: !!game.tickHz,
  }));
}

module.exports = { loadRegistry, catalog, GAMES_DIR };
