'use strict';
// 把房间和会话写到磁盘，重启后恢复。先写临时文件再改名，断电也不会留下半个文件。

const fs = require('fs');
const path = require('path');

const VERSION = 1;

/** @param {string} file @param {any} data */
function save(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ v: VERSION, savedAt: Date.now(), ...data }));
  fs.renameSync(tmp, file);
}

/** @param {string} file */
function load(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.v !== VERSION) return null;
    return data;
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'ENOENT') console.warn(`快照读取失败，忽略：${/** @type {Error} */ (e).message}`);
    return null;
  }
}

module.exports = { save, load };
