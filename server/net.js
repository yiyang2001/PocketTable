'use strict';
// WebSocket 会话层：身份（token / pid）、消息分发、限流。
// token 是只有本人知道的凭证（存在浏览器 localStorage），pid 是可以公开给其他人的玩家 id。

const crypto = require('crypto');
const { AVATAR_COUNT } = require('./rooms');

const MAX_PAYLOAD = 256 * 1024;
const RATE_PER_SEC = 60;
const FLOOD_DROPS = 300;
const NAME_MAX = 12;

/**
 * @typedef {{ token: string, pid: string, name: string, avatar: number, roomCode: string | null, ws: import('ws').WebSocket | null }} Session
 */

class Hub {
  constructor() {
    /** @type {Map<string, Session>} */
    this.byToken = new Map();
    /** @type {Map<string, Session>} */
    this.byPid = new Map();
    /** @type {import('./rooms').RoomManager | null} */
    this.manager = null;
    /** @type {() => void} */
    this.onChange = () => {};
    /** 服务器关闭中：不再处理断线，免得给房间挂新的计时器 */
    this.closing = false;
  }

  /** @param {string} pid @param {any} msg */
  send(pid, msg) {
    const s = this.byPid.get(pid);
    if (!s) return;
    if ((msg.t === 'kicked' || msg.t === 'room_closed') && s.roomCode === msg.code) s.roomCode = null;
    if (s.ws && s.ws.readyState === 1) s.ws.send(JSON.stringify(msg));
  }

  /** @param {import('ws').WebSocket} ws */
  attach(ws) {
    /** @type {Session | null} */
    let session = null;
    let windowStart = Date.now();
    let floodStart = windowStart;
    let count = 0;
    let drops = 0;

    ws.on('message', (raw) => {
      const now = Date.now();
      if (now - windowStart >= 1000) { windowStart = now; count = 0; }
      if (now - floodStart >= 10000) { floodStart = now; drops = 0; }
      if (++count > RATE_PER_SEC) {
        if (++drops > FLOOD_DROPS) ws.close(1008, 'flood');
        return;
      }
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;

      /** @param {string | null} code @param {any} [data] */
      const ack = (code, data) => {
        if (msg.id === undefined) return;
        ws.send(JSON.stringify(code ? { t: 'ack', ref: msg.id, ok: false, code } : { t: 'ack', ref: msg.id, ok: true, data }));
      };

      if (msg.t === 'hello') {
        session = this._hello(ws, msg, session);
        return ack(null, { pid: session.pid });
      }
      if (!session) return ack('err.no_hello');
      try {
        this._dispatch(session, msg, ack);
      } catch (e) {
        console.error(`处理 ${msg.t} 时出错`, e);
        ack('err.internal');
      }
    });

    ws.on('close', () => {
      if (this.closing || !session || session.ws !== ws) return;
      session.ws = null;
      const room = this._room(session);
      if (room) room.disconnect(session.pid);
      this.onChange();
    });
  }

  /**
   * @param {import('ws').WebSocket} ws
   * @param {any} msg
   * @param {Session | null} current
   * @returns {Session}
   */
  _hello(ws, msg, current) {
    let s = current || (typeof msg.token === 'string' ? this.byToken.get(msg.token) : undefined) || null;
    if (!s) {
      s = {
        token: crypto.randomBytes(16).toString('hex'),
        pid: crypto.randomBytes(5).toString('hex'),
        name: '',
        avatar: crypto.randomInt(AVATAR_COUNT),
        roomCode: null,
        ws: null,
      };
      this.byToken.set(s.token, s);
      this.byPid.set(s.pid, s);
    }
    // 同一个人在新标签页打开：旧连接让位
    if (s.ws && s.ws !== ws && s.ws.readyState === 1) s.ws.close(4000, 'replaced');
    s.ws = ws;
    s.name = cleanName(msg.name) || s.name || `玩家${s.pid.slice(0, 3).toUpperCase()}`;
    if (Number.isInteger(msg.avatar) && msg.avatar >= 0 && msg.avatar < AVATAR_COUNT) s.avatar = msg.avatar;
    ws.send(JSON.stringify({ t: 'welcome', token: s.token, pid: s.pid, name: s.name, avatar: s.avatar }));

    const room = this._room(s);
    if (room) {
      const err = room.join(who(s));
      if (err) s.roomCode = null;
    } else {
      s.roomCode = null;
    }
    this.onChange();
    return s;
  }

  /** @param {Session} s */
  _room(s) {
    return s.roomCode && this.manager ? this.manager.get(s.roomCode) : null;
  }

  /**
   * @param {Session} s
   * @param {any} msg
   * @param {(code: string | null, data?: any) => void} ack
   */
  _dispatch(s, msg, ack) {
    const manager = /** @type {import('./rooms').RoomManager} */ (this.manager);
    const room = this._room(s);

    switch (msg.t) {
      case 'profile': {
        s.name = cleanName(msg.name) || s.name;
        if (Number.isInteger(msg.avatar) && msg.avatar >= 0 && msg.avatar < AVATAR_COUNT) s.avatar = msg.avatar;
        if (room && room.phase === 'lobby') room.join(who(s));
        this.onChange();
        return ack(null, { name: s.name, avatar: s.avatar });
      }
      case 'room.create': {
        if (room) room.leave(s.pid);
        const made = manager.create(String(msg.game || ''));
        if (made.error || !made.room) return ack(made.error || 'err.internal');
        const err = made.room.join(who(s));
        if (err) return ack(err);
        s.roomCode = made.room.code;
        if (msg.options && typeof msg.options === 'object') {
          for (const [k, v] of Object.entries(msg.options)) made.room.setOption(s.pid, k, v);
        }
        this.onChange();
        return ack(null, { code: made.room.code });
      }
      case 'room.join': {
        const target = manager.get(msg.code);
        if (!target) return ack('err.no_room');
        if (room && room !== target) room.leave(s.pid);
        const err = target.join(who(s));
        if (err) return ack(err);
        s.roomCode = target.code;
        this.onChange();
        return ack(null, { code: target.code });
      }
      case 'room.leave': {
        if (room) room.leave(s.pid);
        s.roomCode = null;
        this.onChange();
        return ack(null);
      }
    }

    if (!room) return ack('err.not_in_room');
    switch (msg.t) {
      case 'room.ready': return ack(room.setReady(s.pid, !!msg.ready));
      case 'room.option': return ack(room.setOption(s.pid, String(msg.key), msg.value));
      case 'room.bot.add': return ack(room.addBot(s.pid));
      case 'room.kick': return ack(room.kick(s.pid, Number(msg.seat)));
      case 'room.start': return ack(room.start(s.pid));
      case 'room.rematch': return ack(room.rematch(s.pid));
      case 'move': return ack(room.move(s.pid, String(msg.name), msg.args));
      case 'report': return room.match ? ack(null, { record: room.match.record }) : ack('err.not_playing');
      default: return ack('err.unknown_type');
    }
  }

  snapshot() {
    return [...this.byToken.values()]
      .filter((s) => s.roomCode)
      .map(({ token, pid, name, avatar, roomCode }) => ({ token, pid, name, avatar, roomCode }));
  }

  /** @param {Omit<Session, 'ws'>[]} list */
  restore(list) {
    for (const s of list || []) {
      const session = { ...s, ws: null };
      this.byToken.set(s.token, session);
      this.byPid.set(s.pid, session);
    }
  }

  connected() {
    let n = 0;
    for (const s of this.byToken.values()) if (s.ws) n++;
    return n;
  }
}

/** @param {any} name */
function cleanName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, NAME_MAX);
}

/** @param {Session} s */
function who(s) {
  return { pid: s.pid, name: s.name, avatar: s.avatar };
}

module.exports = { Hub, MAX_PAYLOAD };
