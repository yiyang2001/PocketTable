// 大厅：改名字、输房间码加入、选游戏开房。
// 手机上单栏；平板和电脑上左边是名字和加入，右边是游戏卡片网格。

import { html, useState } from '../vendor/preact-htm.js';
import { store, req, setProfile } from '../store.js';
import { Avatar, AVATAR_COUNT, Cover, Icon } from '../ui/kit.js';

export function Home() {
  const me = store.me;
  const [code, setCode] = useState('');
  const [name, setName] = useState(me ? me.name : '');

  const join = async (e) => {
    e.preventDefault();
    if (code.length === 4) await req('room.join', { code });
  };
  const saveName = () => {
    if (me && name.trim() && name.trim() !== me.name) setProfile(name.trim(), me.avatar);
  };

  return html`<main class="screen">
    <header class="row">
      <span class="stk disp logo">口袋桌</span>
      <span class="tagline">一部手机就是一张桌子</span>
      <span class="grow"></span>
      ${me && html`<button class="avatar-btn" aria-label="换个头像"
        onClick=${() => setProfile(me.name, (me.avatar + 1) % AVATAR_COUNT)}>
        <${Avatar} n=${me.avatar} size=${44} />
      </button>`}
    </header>

    <div class="home">
      <div class="home-side">
        <section class="stk panel">
          <label class="small" for="nick" style=${{ fontWeight: 700 }}>你的名字</label>
          <input id="nick" class="input" maxlength="12" value=${name} placeholder="起个名字"
            onInput=${(e) => setName(e.currentTarget.value)} onBlur=${saveName}
            onKeyDown=${(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        </section>

        <form class="stk panel" onSubmit=${join}>
          <label class="disp" for="code" style=${{ fontSize: 24 }}>输入房间码加入</label>
          <div class="row">
            <input id="code" class="input code-input grow" maxlength="4" autocomplete="off" autocapitalize="characters"
              inputmode="text" value=${code} placeholder="A7K2" style=${{ minWidth: 0 }}
              onInput=${(e) => setCode(e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
            <button class="btn btn-go btn-big" type="submit" disabled=${code.length !== 4}>加入</button>
          </div>
          <div class="small">或者用手机相机扫房主屏幕上的二维码。</div>
        </form>
      </div>

      <div class="home-main">
        <div class="row" style=${{ alignItems: 'baseline' }}>
          <h2 class="disp" style=${{ fontSize: 26, margin: 0 }}>开个新房间</h2>
          <span class="small">选一个游戏</span>
        </div>
        <div class="game-list">
          ${store.games.map((g) => html`<button key=${g.id} class="stk game-card" onClick=${() => req('room.create', { game: g.id })}>
            <${Cover} id=${g.id} />
            <span class="game-card-body">
              <span class="disp" style=${{ fontSize: 21 }}>${g.name}</span>
              ${g.blurb && html`<span class="game-blurb">${g.blurb}</span>`}
              <span class="row" style=${{ gap: 5, flexWrap: 'wrap' }}>
                <span class="chip">${g.players.min}–${g.players.max} 人</span>
                ${g.bots && html`<span class="chip">有电脑</span>`}
              </span>
            </span>
            <span class="game-card-arrow"><${Icon} name="next" size=${28} /></span>
          </button>`)}
        </div>
      </div>
    </div>
  </main>`;
}
