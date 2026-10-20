// 抢 21 的界面。props 见 client/screens/game.js：view seat actors deadline events seats send

import { html } from '/vendor/preact-htm.js';
import { Avatar } from '/ui/kit.js';

export default function Count21({ view, seat, actors, seats, send }) {
  const myTurn = actors.includes(seat);
  const current = seats[view.current];
  const left = view.target - view.total;

  return html`<div class="c21">
    <div class="c21-play">
      <div class="stk c21-total">
        <span class="num">${view.total}</span>
        <span class="small">目标 ${view.target} · 还差 ${left}</span>
      </div>

      <div class="stk disp c21-turn" aria-live="polite">
        ${view.loser !== null
          ? `${seats[view.loser].name} 报到了 ${view.target}！`
          : myTurn ? '轮到你了！' : `${current ? current.name : ''} 在想…`}
      </div>

      <div class="c21-btns">
        ${[1, 2, 3].map((n) => html`<button key=${n} class="btn btn-primary btn-big num"
          disabled=${!myTurn || n > left} onClick=${() => send('add', { n })}>+${n}</button>`)}
      </div>
    </div>

    <div class="c21-side">
      <div class="c21-seats">
        ${seats.map((s) => html`<div key=${s.seat} class=${`c21-seat${s.seat === view.current && view.loser === null ? ' on' : ''}`}>
          <${Avatar} n=${s.seat} size=${44} dead=${view.loser === s.seat} />
          <span class="small" style=${{ fontWeight: 900 }}>${s.seat === seat ? '你' : s.name}</span>
        </div>`)}
      </div>

      <ol class="stk c21-log" aria-label="报数记录">
        ${view.history.slice().reverse().map((h, i) => html`<li key=${i}>
          <b>${h.seat === seat ? '你' : seats[h.seat].name}</b> +${h.n} → <span class="num">${h.total}</span>
        </li>`)}
        ${view.history.length === 0 && html`<li>每次加 1 到 3，谁报到 ${view.target} 谁输。</li>`}
      </ol>
    </div>
  </div>`;
}
