'use strict';
// HTTP：静态文件 + 几个小接口。没有框架，局域网里够用了。

const fs = require('fs');
const os = require('os');
const path = require('path');
const QRCode = require('qrcode');
const { catalog, GAMES_DIR } = require('./registry');

const CLIENT_DIR = path.join(__dirname, '..', 'client');

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

// games/<id>/ 下只公开这些，规则和 bot 不给客户端
const GAME_PUBLIC = /^[a-z0-9-]+\/(view\.js|theme\.css|assets\/[\w.-]+)$/;

function lanAddresses() {
  /** @type {string[]} */
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  // 手机热点常见网段排前面
  return out.sort((a, b) => score(b) - score(a));
}
/** @param {string} ip */
function score(ip) {
  if (ip.startsWith('192.168.43.') || ip.startsWith('172.20.10.')) return 3;
  if (ip.startsWith('192.168.')) return 2;
  if (ip.startsWith('10.')) return 1;
  return 0;
}

/**
 * @param {{ registry: Map<string, import('./registry').GameEntry>, stats: () => any, port: () => number }} ctx
 */
function createHandler({ registry, stats, port }) {
  const games = catalog(registry);

  /** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
  return async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://x');
    const p = decodeURIComponent(url.pathname);

    if (p === '/api/health') return json(res, { ok: true, ...stats() });
    if (p === '/api/games') return json(res, games);
    if (p === '/api/info') return json(res, { port: port(), addresses: lanAddresses() });
    if (p === '/api/qr') {
      const text = String(url.searchParams.get('text') || '').slice(0, 300);
      if (!text) return notFound(res);
      const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#1F1A2E', light: '#FFFFFF' } });
      res.writeHead(200, { 'Content-Type': TYPES['.svg'], 'Cache-Control': 'no-cache' });
      return res.end(svg);
    }

    if (p.startsWith('/games/')) {
      const rel = p.slice('/games/'.length);
      if (!GAME_PUBLIC.test(rel)) return notFound(res);
      return serveFile(req, res, GAMES_DIR, rel);
    }
    return serveFile(req, res, CLIENT_DIR, p === '/' ? 'index.html' : p.slice(1));
  };
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} base
 * @param {string} rel
 */
function serveFile(req, res, base, rel) {
  const file = path.resolve(base, rel);
  if (!file.startsWith(base + path.sep)) return notFound(res);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // 单页应用：没有扩展名的路径都回到 index.html
      if (base === CLIENT_DIR && !path.extname(rel)) return serveFile(req, res, CLIENT_DIR, 'index.html');
      return notFound(res);
    }
    const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304);
      return res.end();
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      ETag: etag,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/** @param {import('http').ServerResponse} res @param {any} data */
function json(res, data) {
  res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

/** @param {import('http').ServerResponse} res */
function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
}

module.exports = { createHandler, lanAddresses };
