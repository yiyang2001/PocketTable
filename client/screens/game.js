// 对局外壳：顶栏（离开、计时、报告问题）+ 加载该游戏的视图 + 结算页。
// 游戏视图从 /games/<id>/view.js 动态加载，接口见 docs/DESIGN.md「前端」一节。

import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { store, req, leaveRoom, toast } from '../store.js';
import { Icon, Sheet, Timer } from '../ui/kit.js';

const viewCache = new Map();

function useGameView(id) {
  const [View, setView] = useState(() => viewCache.get(id) || null);
  useEffect(() => {
    if (viewCache.has(id)) { setView(() => viewCache.get(id)); return; }
    import(`/games/${id}/view.js`).then((mod) => {
      viewCache.set(id, mod.default);
      setView(() => mod.default);
    }).catch(() => toast('游戏界面加载失败，刷新试试', true));
  }, [id]);
  // 每款游戏自己的配色
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `/games/${id}/theme.css`;
    document.head.appendChild(link);
    return () => link.remove();
  }, [id]);
  return View;
}

async function report() {
  const ack = await req('report');
  if (!ack.ok) return;
  const blob = new Blob([JSON.stringify(ack.data.record, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pockettable-${ack.data.record.game}-${ack.data.record.seed}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('对局记录已下载，发给开发者就能复现问题');
}

function Result({ room, game, isHost }) {
  const seats = room.matchSeats || [];
  const won = game.result.winners.includes(game.seat);
  const names = game.result.winners.map((s) => (seats[s] ? seats[s].name : `座位${s + 1}`));
  return html`<${Sheet}>
    <div class="disp center" style=${{ fontSize: 40 }}>${won ? '赢啦！' : '再接再厉'}</div>
    <div class="center">获胜：<b>${names.join('、') || '无'}</b></div>
    <div class="row" style=${{ gap: 12 }}>
      <button class="btn btn-big grow" onClick=${leaveRoom}>回大厅</button>
      ${isHost
        ? html`<button class="btn btn-primary btn-big grow" onClick=${() => req('room.rematch')}>再来一局</button>`
        : html`<span class="grow center small">等房主开下一局</span>`}
    </div>
  <//>`;
}

export function GameScreen() {
  const { room, game, me } = store;
  const View = useGameView(room.game);
  const meta = store.games.find((g) => g.id === room.game);
  const isHost = me && room.hostPid === me.pid;
  const send = (name, args = {}) => req('move', { name, args });

  return html`<main class="screen">
    <header class="row">
      <button class="btn btn-icon" aria-label="离开对局" onClick=${leaveRoom}><${Icon} name="back" /></button>
      <span class="disp" style=${{ fontSize: 22 }}>${meta ? meta.name : room.game}</span>
      <span class="grow"></span>
      ${game && !game.result && html`<${Timer} deadline=${game.deadline} />`}
      <button class="btn btn-icon" aria-label="报告问题（下载对局记录）" title="报告问题" onClick=${report}><${Icon} name="flag" size=${20} /></button>
    </header>
    <div class="game-body">
      ${game && View
        ? html`<${View} key=${room.game} view=${game.view} seat=${game.seat} actors=${game.actors}
            deadline=${game.deadline} events=${game.events} ver=${game.ver}
            seats=${room.matchSeats || []} send=${send} />`
        : html`<div class="center" style=${{ marginTop: 80 }}>加载中…</div>`}
    </div>
    ${game && game.result && room.phase === 'ended' && html`<${Result} room=${room} game=${game} isHost=${isHost} />`}
  </main>`;
}
