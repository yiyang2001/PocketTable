import { html, render } from './vendor/preact-htm.js';
import { useStore, start } from './store.js';
import { Toasts } from './ui/kit.js';
import { Home } from './screens/home.js';
import { RoomScreen } from './screens/room.js';
import { GameScreen } from './screens/game.js';

function App() {
  const s = useStore();
  let screen;
  if (!s.everConnected) screen = html`<main class="screen"><div class="center disp" style=${{ marginTop: 120, fontSize: 28 }}>连接中…</div></main>`;
  else if (!s.room) screen = html`<${Home} />`;
  else if (s.room.phase === 'lobby') screen = html`<${RoomScreen} />`;
  else screen = html`<${GameScreen} />`;
  return html`
    ${screen}
    <${Toasts} items=${s.toasts} />
    ${s.everConnected && !s.connected && html`<div class="offline-bar" role="status">连接断开，正在重连…</div>`}
  `;
}

start();
render(html`<${App} />`, document.getElementById('app'));
