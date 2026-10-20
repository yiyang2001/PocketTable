'use strict';
// 入口：HTTP + WebSocket 共用一个端口；启动时从快照恢复房间，定期和关机时保存。

const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { loadRegistry } = require('./registry');
const { RoomManager } = require('./rooms');
const { Hub, MAX_PAYLOAD } = require('./net');
const { createHandler, lanAddresses } = require('./http');
const snapshot = require('./snapshot');

const SNAPSHOT_EVERY_MS = 10_000;
const PORT_TRIES = 10;

/**
 * @param {{
 *   port?: number,
 *   host?: string,
 *   dataDir?: string,
 *   botDelay?: () => number,
 *   autoplayMs?: number,
 *   graceMs?: number,
 *   abandonMs?: number,
 *   quiet?: boolean,
 * }} [opts]
 */
async function createServer(opts = {}) {
  const registry = loadRegistry();
  const dataFile = path.join(opts.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'rooms.json');
  let dirty = false;
  const markDirty = () => { dirty = true; };

  const hub = new Hub();
  const manager = new RoomManager(registry, {
    send: (pid, msg) => hub.send(pid, msg),
    now: () => Date.now(),
    botDelay: opts.botDelay || (() => 600 + Math.floor(Math.random() * 900)),
    autoplayMs: opts.autoplayMs ?? 15_000,
    graceMs: opts.graceMs ?? 60_000,
    abandonMs: opts.abandonMs ?? 10 * 60_000,
    onChange: markDirty,
  });
  hub.manager = manager;
  hub.onChange = markDirty;

  const saved = snapshot.load(dataFile);
  if (saved) {
    hub.restore(saved.sessions);
    manager.restore(saved.rooms);
  }

  function save() {
    snapshot.save(dataFile, { sessions: hub.snapshot(), rooms: manager.snapshot() });
    dirty = false;
  }
  const saver = setInterval(() => { if (dirty) save(); }, SNAPSHOT_EVERY_MS).unref();

  let port = opts.port ?? (parseInt(process.env.PORT || '', 10) || 3000);
  const server = http.createServer(createHandler({
    registry,
    stats: () => ({ ...manager.stats(), connected: hub.connected() }),
    port: () => port,
  }));
  // 端口被占用就往后试（手机上常有别的应用占着 3000）
  for (let i = 0; ; i++) {
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, opts.host || '0.0.0.0', () => { server.off('error', reject); resolve(undefined); });
      });
      break;
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EADDRINUSE' || i >= PORT_TRIES || opts.port === 0) throw e;
      port++;
    }
  }
  // 监听成功后再挂 WebSocket：否则 ws 会把端口占用错误再抛一次，绕过上面的换端口逻辑
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_PAYLOAD });
  wss.on('connection', (ws) => hub.attach(ws));

  const addr = server.address();
  if (addr && typeof addr === 'object') port = addr.port;

  if (!opts.quiet) {
    console.log(`口袋桌已启动：http://localhost:${port}`);
    for (const ip of lanAddresses()) console.log(`  同一 WiFi / 热点下打开：http://${ip}:${port}`);
  }

  async function close() {
    clearInterval(saver);
    hub.closing = true;
    save();
    manager.dispose();
    for (const ws of wss.clients) ws.terminate();
    await new Promise((resolve) => wss.close(() => resolve(undefined)));
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }

  return { port, close, manager, hub, registry };
}

if (require.main === module) {
  createServer().then(({ close }) => {
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      close().finally(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { createServer };
