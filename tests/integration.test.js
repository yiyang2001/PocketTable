'use strict';
// 起真服务器，用多个 WebSocket 客户端走完整流程：开房 → 加入 → 加 bot → 准备 → 对局 → 结算，
// 以及"对局中服务器重启，重连后接着打"。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { createServer } = require('../server');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pockettable-'));
const serverOpts = (dataDir) => ({ port: 0, host: '127.0.0.1', dataDir, botDelay: () => 5, quiet: true });

class Client {
  /** @param {number} port */
  constructor(port) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.nextId = 1;
    /** @type {Map<number, (msg: any) => void>} */
    this.pending = new Map();
    /** @type {any[]} */
    this.inbox = [];
    /** @type {((msg: any) => void)[]} */
    this.waiters = [];
    this.room = null;
    this.state = null;
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.t === 'ack') {
        const done = this.pending.get(msg.ref);
        this.pending.delete(msg.ref);
        if (done) done(msg);
        return;
      }
      if (msg.t === 'room') this.room = msg.room;
      if (msg.t === 'state') this.state = msg;
      this.inbox.push(msg);
      for (const w of this.waiters.splice(0)) w(msg);
    });
    this.open = new Promise((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', reject); });
  }

  /** @param {string} t @param {any} [body] */
  async req(t, body = {}) {
    await this.open;
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ t, id, ...body }));
    });
  }

  /** 等到某条消息满足条件 @param {(msg: any) => boolean} pred */
  async until(pred, ms = 5000) {
    const seen = this.inbox.find(pred);
    if (seen) return seen;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待超时')), ms);
      const check = (/** @type {any} */ msg) => {
        if (pred(msg)) { clearTimeout(timer); resolve(msg); } else this.waiters.push(check);
      };
      this.waiters.push(check);
    });
  }

  close() {
    this.ws.close();
  }
}

test('两个真人 + 一个 bot 打完一局抢 21', async () => {
  const srv = await createServer(serverOpts(tmpDir()));
  const a = new Client(srv.port), b = new Client(srv.port);
  try {
    const helloA = await a.req('hello', { name: '小明' });
    assert.ok(helloA.ok);
    await b.req('hello', { name: '阿杰' });

    const created = await a.req('room.create', { game: 'count21', options: { turnSec: 10 } });
    assert.ok(created.ok, created.code);
    const code = created.data.code;
    assert.match(code, /^[A-Z2-9]{4}$/);

    assert.equal((await b.req('room.start')).code, 'err.not_in_room');
    assert.ok((await b.req('room.join', { code: code.toLowerCase() })).ok);
    assert.equal((await b.req('room.start')).code, 'err.host_only');
    assert.ok((await a.req('room.bot.add')).ok);
    assert.equal((await a.req('room.start')).code, 'err.not_all_ready');
    assert.ok((await b.req('room.ready', { ready: true })).ok);
    assert.ok((await a.req('room.start')).ok);

    // 两个真人都按"能报几就报 1"的方式打，bot 自己打
    const players = [a, b];
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const ended = players.find((c) => c.state && c.state.result);
      if (ended) break;
      for (const c of players) {
        const s = c.state;
        if (s && !s.result && s.actors.includes(s.seat)) await c.req('move', { name: 'add', args: { n: 1 } });
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    const final = await a.until((m) => m.t === 'room' && m.room.phase === 'ended');
    assert.equal(final.room.matchSeats.length, 3);
    assert.ok(a.state.result.winners.length === 2);
    assert.equal(a.state.view.total, 21);

    // 只有房主能再来一局；回到等待房间后需要重新准备
    assert.equal((await b.req('room.rematch')).code, 'err.host_only');
    assert.ok((await a.req('room.rematch')).ok);
    const lobby = await b.until((m) => m.t === 'room' && m.room.phase === 'lobby');
    assert.equal(lobby.room.hostPid, helloA.data.pid);
    assert.ok(lobby.room.seats.filter((s) => !s.bot).every((s) => !s.ready));
  } finally {
    a.close(); b.close();
    await srv.close();
  }
});

test('对局中服务器重启：重连后回到同一个座位，状态完全一致', async () => {
  const dir = tmpDir();
  let srv = await createServer(serverOpts(dir));
  const a = new Client(srv.port);
  const hello = await a.req('hello', { name: '小明' });
  const token = a.inbox.find((m) => m.t === 'welcome').token;
  const { data } = await a.req('room.create', { game: 'count21', options: { turnSec: 30 } });
  await a.req('room.bot.add');
  await a.req('room.start');
  // 走几步，确保记录里有东西
  for (let i = 0; i < 3; i++) {
    const s = await a.until((m) => m.t === 'state' && !m.result && m.actors.includes(m.seat));
    a.inbox.length = 0;
    await a.req('move', { name: 'add', args: { n: 1 } });
    void s;
  }
  const before = await a.until((m) => m.t === 'state');
  a.close();
  await srv.close();

  srv = await createServer(serverOpts(dir));
  const again = new Client(srv.port);
  try {
    const re = await again.req('hello', { token, name: '小明' });
    assert.equal(re.data.pid, hello.data.pid);
    const room = await again.until((m) => m.t === 'room');
    assert.equal(room.room.code, data.code);
    assert.equal(room.room.phase, 'playing');
    const state = await again.until((m) => m.t === 'state');
    assert.ok(state.ver >= before.ver);
    assert.ok(state.view.total >= before.view.total);
  } finally {
    again.close();
    await srv.close();
  }
});

test('静态文件与接口：首页、游戏目录、二维码；规则文件不对外', async () => {
  const srv = await createServer(serverOpts(tmpDir()));
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /<div id="app">/);
    const games = await (await fetch(`${base}/api/games`)).json();
    assert.ok(games.some((g) => g.id === 'kittens'));
    assert.ok(!games.some((g) => g.id === 'count21'), '开发用的游戏不在大厅里显示');
    const qr = await fetch(`${base}/api/qr?text=hello`);
    assert.match(await qr.text(), /<svg/);
    assert.equal((await fetch(`${base}/games/count21/view.js`)).status, 200);
    assert.equal((await fetch(`${base}/games/count21/rules.js`)).status, 404);
    assert.equal((await fetch(`${base}/games/count21/bot.js`)).status, 404);
    assert.equal((await fetch(`${base}/..%2Fpackage.json`)).status, 404);
  } finally {
    await srv.close();
  }
});

test('端口被占用时自动换下一个端口', async () => {
  const first = await createServer({ ...serverOpts(tmpDir()), port: 0 });
  const second = await createServer({ ...serverOpts(tmpDir()), port: first.port });
  try {
    assert.ok(second.port > first.port);
    assert.equal((await fetch(`http://127.0.0.1:${second.port}/api/health`)).status, 200);
  } finally {
    await second.close();
    await first.close();
  }
});

test('对局中断线：轮到断线的人时由电脑代打，回来后自己接着打', async () => {
  const srv = await createServer({ ...serverOpts(tmpDir()), autoplayMs: 50 });
  const a = new Client(srv.port), b = new Client(srv.port);
  try {
    await a.req('hello', { name: '小明' });
    await b.req('hello', { name: '阿杰' });
    const tokenB = b.inbox.find((m) => m.t === 'welcome').token;
    const { data } = await a.req('room.create', { game: 'count21', options: { turnSec: 30 } });
    await b.req('room.join', { code: data.code });
    await b.req('room.ready', { ready: true });
    await a.req('room.start');
    b.close();
    // 只有 a 在出牌；b 的回合由电脑代打，所以对局能自己走到结束
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !(a.state && a.state.result)) {
      const s = a.state;
      if (s && s.actors.includes(s.seat)) await a.req('move', { name: 'add', args: { n: 1 } });
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(a.state.result, '断线的人没有被代打，对局卡住了');
    const tookTurns = a.state.view.history.filter((h) => h.seat !== a.state.seat).length;
    assert.ok(tookTurns > 0);

    const back = new Client(srv.port);
    await back.req('hello', { token: tokenB });
    const room = await back.until((m) => m.t === 'room');
    assert.equal(room.room.code, data.code);
    back.close();
  } finally {
    a.close();
    await srv.close();
  }
});
