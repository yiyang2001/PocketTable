// 连接 + 全局状态。整个应用只有一个 WebSocket 和一份 store。

import { useEffect, useState } from './vendor/preact-htm.js';
import { t } from './lang/zh.js';

const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 隐私模式 */ } },
};

export const store = {
  connected: false,
  everConnected: false,
  me: null,          // { pid, name, avatar }
  room: null,        // 服务器的 room.info()
  game: null,        // 最近一条 state 消息
  games: [],         // 游戏目录
  toasts: [],
};

const listeners = new Set();
let toastId = 0;

function set(patch) {
  Object.assign(store, patch);
  for (const fn of listeners) fn();
}

export function useStore() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return store;
}

export function toast(text, bad = false) {
  const id = ++toastId;
  set({ toasts: [...store.toasts, { id, text, bad }] });
  setTimeout(() => set({ toasts: store.toasts.filter((x) => x.id !== id) }), 2600);
}

// ---------- WebSocket ----------

let ws = null;
let nextId = 1;
const pending = new Map();
let retry = 0;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    retry = 0;
    ws.send(JSON.stringify({ t: 'hello', id: nextId++, token: LS.get('pt.token'), name: LS.get('pt.name') || undefined }));
  };
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  ws.onclose = () => {
    set({ connected: false });
    for (const done of pending.values()) done({ ok: false, code: 'err.no_hello' });
    pending.clear();
    retry = Math.min(retry + 1, 8);
    setTimeout(connect, Math.min(500 * retry, 4000));
  };
}

function onMessage(msg) {
  switch (msg.t) {
    case 'ack': {
      const done = pending.get(msg.ref);
      pending.delete(msg.ref);
      if (done) done(msg);
      return;
    }
    case 'welcome':
      LS.set('pt.token', msg.token);
      set({ connected: true, everConnected: true, me: { pid: msg.pid, name: msg.name, avatar: msg.avatar } });
      autoJoin();
      return;
    case 'room':
      // 换了房间或者回到等待房间，旧的对局状态就不要了
      if (!store.room || store.room.code !== msg.room.code || msg.room.phase === 'lobby') set({ game: null });
      set({ room: msg.room });
      return;
    case 'state':
      if (!store.game || msg.ver >= store.game.ver) set({ game: msg });
      return;
    case 'kicked':
      set({ room: null, game: null });
      toast('你被房主移出了房间', true);
      return;
    case 'room_closed':
      set({ room: null, game: null });
      toast('房间已关闭');
      return;
    case 'toast':
      toast(t(msg.key), true);
      return;
  }
}

/**
 * 发请求，返回服务器的 ack。失败时默认弹提示。
 * @returns {Promise<{ok: boolean, code?: string, data?: any}>}
 */
export function req(type, body = {}, { quiet = false } = {}) {
  return new Promise((resolve) => {
    if (!ws || ws.readyState !== 1) {
      if (!quiet) toast('还没连上，稍等一下', true);
      return resolve({ ok: false, code: 'err.no_hello' });
    }
    const id = nextId++;
    pending.set(id, (ack) => {
      if (!ack.ok && !quiet) toast(t(ack.code), true);
      resolve(ack);
    });
    ws.send(JSON.stringify({ t: type, id, ...body }));
  });
}

export async function setProfile(name, avatar) {
  const ack = await req('profile', { name, avatar });
  if (ack.ok) {
    LS.set('pt.name', ack.data.name);
    set({ me: { ...store.me, ...ack.data } });
  }
}

export async function leaveRoom() {
  await req('room.leave', {}, { quiet: true });
  set({ room: null, game: null });
}

// 扫码进来的链接带 ?join=CODE
function autoJoin() {
  const params = new URLSearchParams(location.search);
  const code = params.get('join');
  if (!code) return;
  history.replaceState(null, '', location.pathname);
  if (!store.room || store.room.code !== code.toUpperCase()) req('room.join', { code });
}

export async function loadGames() {
  try {
    const res = await fetch('/api/games');
    set({ games: await res.json() });
  } catch {
    setTimeout(loadGames, 2000);
  }
}

export function start() {
  connect();
  loadGames();
}
