// 等待房间：二维码、座位、选项、准备 / 开始。
// 手机上从上到下排；平板和电脑上左栏是二维码、选项、按钮，右栏是座位（见 theme.css 的 .room）。

import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { store, req, leaveRoom } from '../store.js';
import { Avatar, Icon } from '../ui/kit.js';

/** 生成别人扫码能打开的地址。通过局域网 IP 或域名访问时直接用当前地址。 */
function useJoinUrl(code) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const local = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
    if (!local) { setUrl(`${location.origin}/?join=${code}`); return; }
    fetch('/api/info').then((r) => r.json()).then((info) => {
      const ip = info.addresses[0];
      setUrl(ip ? `http://${ip}:${info.port}/?join=${code}` : `${location.origin}/?join=${code}`);
    }).catch(() => setUrl(`${location.origin}/?join=${code}`));
  }, [code]);
  return url;
}

function seatSub(s, room) {
  if (!s.connected) return '离线';
  if (s.bot) return '普通难度';
  if (s.pid === room.hostPid) return '等大家准备';
  return s.ready ? '准备好了' : '还没准备';
}

export function RoomScreen() {
  const room = store.room;
  const me = store.me;
  const meta = store.games.find((g) => g.id === room.game);
  const isHost = me && room.hostPid === me.pid;
  const mine = room.seats.find((s) => s.pid === (me && me.pid));
  const url = useJoinUrl(room.code);

  const others = room.seats.filter((s) => !s.bot && s.pid !== room.hostPid);
  const notReady = others.filter((s) => !s.ready).length;
  const enough = room.seats.length >= room.min;
  const status = !enough
    ? `至少要 ${room.min} 人，可以加电脑`
    : notReady ? `还有 ${notReady} 人没准备` : '人齐了，可以开始';
  const empties = Math.max(0, room.capacity - room.seats.length);
  const canBot = isHost && meta && meta.bots;

  return html`<div class="bleed-paper"><main class="screen"><div class="room">
    <header class="row room-head">
      <button class="btn btn-icon" aria-label="离开房间" onClick=${leaveRoom}><${Icon} name="back" /></button>
      <div style=${{ display: 'flex', flexDirection: 'column' }}>
        <span class="disp" style=${{ fontSize: 24, lineHeight: 1.1 }}>${meta ? meta.name : room.game}</span>
        <span class="small">房间码 <b class="num" style=${{ fontSize: 16, letterSpacing: '.1em' }}>${room.code}</b></span>
      </div>
      <span class="grow"></span>
      <span class="stk" style=${{ background: 'var(--orange)', padding: '4px 10px', fontSize: 13, fontWeight: 900, borderRadius: 12, boxShadow: 'var(--shadow-sm)', transform: 'rotate(3deg)' }}>
        ${room.seats.length} / ${room.capacity} 人
      </span>
    </header>

    <section class="stk qr-card">
      <div class="qr">${url && html`<img src=${`/api/qr?text=${encodeURIComponent(url)}`} alt="扫码加入这个房间" />`}</div>
      <div class="qr-text">
        <span class="disp" style=${{ fontSize: 22 }}>扫码加入</span>
        <span class="small">连同一个 WiFi 或热点，也可以打开</span>
        <span class="num addr">${url.replace(/^https?:\/\//, '').replace(/\/\?join=.*/, '')}</span>
      </div>
    </section>

    <section class="seats" aria-label="座位">
      ${room.seats.map((s) => html`<div key=${s.pid} class=${`stk seat${s.connected ? '' : ' seat-offline'}`}>
        <${Avatar} n=${s.avatar} />
        ${s.pid === room.hostPid && html`<span class="tag" style=${{ background: 'var(--tomato)', transform: 'rotate(6deg)' }}>房主</span>`}
        ${s.bot && html`<span class="tag" style=${{ background: '#BFE9F5', transform: 'rotate(-4deg)' }}>电脑</span>`}
        ${!s.bot && s.pid !== room.hostPid && s.ready && html`<span class="tag" style=${{ transform: 'rotate(-5deg)' }}>已准备</span>`}
        ${isHost && s.pid !== me.pid && html`<button class="seat-kick" aria-label=${`移出 ${s.name}`} onClick=${() => req('room.kick', { seat: s.seat })}>
          <${Icon} name="close" size=${14} />
        </button>`}
        <span class="seat-name">${s.pid === (me && me.pid) ? `${s.name}（你）` : s.name}</span>
        <span class="seat-sub">${seatSub(s, room)}</span>
      </div>`)}
      ${Array.from({ length: empties }, (_, i) => html`<button key=${`e${i}`} class="seat seat-empty"
        disabled=${!canBot} onClick=${() => req('room.bot.add')}>
        <span class="avatar" style=${{ width: 52, height: 52, borderStyle: 'dashed', boxShadow: 'none' }}><${Icon} name="plus" size=${20} /></span>
        <span class="seat-name">${canBot ? '加电脑' : '空位'}</span>
        <span class="seat-sub">${isHost ? '或等朋友' : '等人加入'}</span>
      </button>`)}
    </section>

    ${meta && Object.keys(meta.options).length > 0 && html`<section class="stk panel room-opts" aria-label="游戏选项">
      ${Object.entries(meta.options).map(([key, def]) => html`<div key=${key} class="row" style=${{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span style=${{ fontWeight: 700, fontSize: 15 }}>${def.label || key}</span>
        <span class="row" style=${{ gap: 6 }}>
          ${def.values.map((v) => html`<button key=${v} class=${`chip${room.options[key] === v ? ' on' : ''}`}
            disabled=${!isHost} aria-pressed=${room.options[key] === v}
            onClick=${() => req('room.option', { key, value: v })}>${v}</button>`)}
        </span>
      </div>`)}
    </section>`}

    <footer class="room-acts">
      <div class="center small" style=${{ fontWeight: 700 }}>${status}</div>
      <div class="row" style=${{ gap: 12 }}>
        ${!isHost && mine && html`<button class=${`btn btn-big grow ${mine.ready ? '' : 'btn-go'}`}
          onClick=${() => req('room.ready', { ready: !mine.ready })}>${mine.ready ? '取消准备' : '准备'}</button>`}
        ${isHost && html`<button class="btn btn-primary btn-big grow" disabled=${!enough || notReady > 0}
          onClick=${() => req('room.start')}>开始游戏</button>`}
      </div>
    </footer>
  </div></main></div>`;
}
