// 爆炸猫界面。props 见 client/screens/game.js：view seat actors deadline events ver seats send

import { html, useEffect, useState } from '/vendor/preact-htm.js';
import { Avatar, Sheet, useNow } from '/ui/kit.js';

// ---------- 牌面 ----------

const CARDS = {
  kitten: { name: '爆炸猫', color: '#1F1A2E', light: true, desc: '摸到就爆炸出局。手里有「拆除」可以保命。' },
  defuse: { name: '拆除', color: '#3DD68C', desc: '摸到爆炸猫时自动用掉，然后把猫偷偷放回牌堆任意位置。' },
  attack: { name: '攻击', color: '#FF5A3C', desc: '结束回合、不用摸牌，下家要连续摸两个回合。被攻击的人再出攻击，会叠加给下家。' },
  skip: { name: '跳过', color: '#4D8DFF', desc: '结束一个回合，不用摸牌。' },
  future: { name: '先知', color: '#9B6BFF', desc: '偷看牌堆最上面 3 张，只有你看得到。' },
  shuffle: { name: '洗牌', color: '#FFD84D', desc: '把牌堆洗乱。知道下一张是猫时很好用。' },
  favor: { name: '索要', color: '#F7A8C8', desc: '指定一个人，对方要自己挑一张牌给你。' },
  nope: { name: '不要！', color: '#FF8A2A', desc: '随时都能出：取消别人刚出的牌（拆除除外）。「不要」也能被「不要」。' },
  cat1: { name: '西瓜猫', color: '#7ED9A0', cat: true },
  cat2: { name: '土豆猫', color: '#E8C590', cat: true },
  cat3: { name: '胡子猫', color: '#B8B2C4', cat: true },
  cat4: { name: '彩虹猫', color: '#C9B6FF', cat: true },
  cat5: { name: '长条猫', color: '#BFE9F5', cat: true },
};
const ORDER = ['defuse', 'nope', 'attack', 'skip', 'future', 'shuffle', 'favor', 'cat1', 'cat2', 'cat3', 'cat4', 'cat5', 'kitten'];
const CAT_DESC = '猫咪牌本身没有效果。两张一样的：随机抽走别人一张牌；三张一样的：点名要一种牌，对方有就得给。';
const NAMEABLE = ['defuse', 'nope', 'attack', 'skip', 'future', 'shuffle', 'favor', 'cat1', 'cat2', 'cat3', 'cat4', 'cat5'];

const ICONS = {
  kitten: html`<circle cx="13" cy="16" r="8" fill="currentColor" /><path d="M19 10l3-3" /><path d="M22 7c1.5-1 3 0 3 1.5" />`,
  defuse: html`<circle cx="8" cy="20" r="3" /><circle cx="20" cy="20" r="3" /><path d="M10 18L20 5M18 18L8 5" />`,
  attack: html`<path d="M5 14h14M14 8l6 6-6 6" /><path d="M5 9v10" />`,
  skip: html`<path d="M6 8l6 6-6 6M14 8l6 6-6 6" />`,
  future: html`<path d="M3 14s4-7 11-7 11 7 11 7-4 7-11 7S3 14 3 14z" /><circle cx="14" cy="14" r="3" fill="currentColor" />`,
  shuffle: html`<path d="M4 9h5l10 10h5M4 19h5l10-10h5" />`,
  favor: html`<path d="M14 23s-9-5.5-9-11.5A4.5 4.5 0 0 1 14 9a4.5 4.5 0 0 1 9 2.5C23 17.5 14 23 14 23z" />`,
  nope: html`<circle cx="14" cy="14" r="9" /><path d="M8 20L20 8" />`,
  cat: html`<path d="M6 12l2-6 4 4h4l4-4 2 6" /><path d="M6 12c0 6 3.5 9 8 9s8-3 8-9" /><circle cx="11" cy="14" r="1.4" fill="currentColor" /><circle cx="17" cy="14" r="1.4" fill="currentColor" /><path d="M13 17.5l1 1 1-1" />`,
};

const cardName = (t) => (CARDS[t] ? CARDS[t].name : t);
const cardDesc = (t) => (CARDS[t] && CARDS[t].cat ? CAT_DESC : CARDS[t].desc);

function CardIcon({ t, size = 26 }) {
  const meta = CARDS[t];
  return html`<svg width=${size} height=${size} viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="2.6"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${meta.cat ? ICONS.cat : ICONS[t]}</svg>`;
}

function Card({ t, selected, onClick, small, disabled, label, count = 1, picked = 0 }) {
  const meta = CARDS[t];
  const cls = `ek-card${small ? ' small' : ''}${selected ? ' sel' : ''}${meta.light ? ' dark' : ''}${count > 1 ? ' stack' : ''}`;
  const inner = html`
    <span class="ek-band" style=${{ background: meta.color }}><${CardIcon} t=${t} size=${small ? 20 : 26} /></span>
    <span class="ek-name disp">${meta.name}</span>
    ${count > 1 && html`<span class="ek-badge num">${picked ? `${picked}/${count}` : `×${count}`}</span>`}`;
  if (!onClick) return html`<span class=${cls} title=${cardDesc(t)}>${inner}</span>`;
  return html`<button class=${cls} onClick=${onClick} disabled=${disabled} aria-pressed=${!!selected}
    aria-label=${label || meta.name} title=${cardDesc(t)}>${inner}</button>`;
}

// ---------- 文字 ----------

function kindName(kind, cards) {
  if (kind === 'pair') return `一对${cardName(cards[0])}`;
  if (kind === 'triple') return `三张${cardName(cards[0])}`;
  return `「${cardName(kind)}」`;
}

function logText(e, who) {
  switch (e.k) {
    case 'played': return `${who(e.by)} 打出${kindName(e.kind, e.cards)}${e.target !== null ? ` → ${who(e.target)}` : ''}${e.named ? `，点名要「${cardName(e.named)}」` : ''}`;
    case 'noped': return `${who(e.seat)}：不要！`;
    case 'cancelled': return `${who(e.by)} 的牌被「不要」了`;
    case 'attacked': return `${who(e.to)} 要连摸 ${e.turns} 个回合`;
    case 'skipped': return `${who(e.by)} 跳过了`;
    case 'shuffled': return '牌堆被洗乱了';
    case 'peeked': return `${who(e.by)} 偷看了牌堆顶`;
    case 'favor_empty':
    case 'steal_empty': return `${who(e.target)} 手里没牌了`;
    case 'stole': return `${who(e.by)} 从 ${who(e.target)} 那里抽走一张牌`;
    case 'named_hit': return `${who(e.target)} 交出了「${cardName(e.named)}」`;
    case 'named_miss': return `${who(e.target)} 没有「${cardName(e.named)}」`;
    case 'gave': return `${who(e.from)} 给了 ${who(e.to)} 一张牌`;
    case 'drew': return `${who(e.seat)} 摸了一张`;
    case 'defused': return `${who(e.seat)} 摸到爆炸猫，拆除了！`;
    case 'inserted': return `${who(e.seat)} 把爆炸猫放回了牌堆`;
    case 'exploded': return `${who(e.seat)} 炸飞了！`;
    default: return '';
  }
}

// ---------- 小部件 ----------

function Opponent({ s, v, me }) {
  const out = !v.alive[s.seat];
  const acting = !out && actingSeat(v) === s.seat;
  return html`<div class=${`ek-opp${acting ? ' on' : ''}${out ? ' out' : ''}`}>
    ${acting && html`<span class="ek-now">出牌中</span>`}
    <${Avatar} n=${s.avatar ?? s.seat} size=${48} dead=${out} />
    <span class="ek-opp-name">${s.seat === me ? '你' : s.name}</span>
    <span class="ek-count num">${out ? '炸飞了' : `${v.handCounts[s.seat]} 张`}</span>
    ${acting && v.phase === 'turn' && v.turnsLeft > 1 && html`<span class="ek-x num">×${v.turnsLeft}</span>`}
  </div>`;
}

function ReactBar({ endsAt, total }) {
  const now = useNow(100);
  const left = Math.max(0, endsAt - now);
  return html`<span class="ek-react-bar" aria-hidden="true"><span style=${{ width: `${Math.min(100, (left / total) * 100)}%` }}></span></span>`;
}

/** 现在该谁动（摸牌 / 给牌 / 放猫），反应窗口里不算 */
function actingSeat(v) {
  if (v.phase === 'turn') return v.turn;
  if (v.phase === 'favor' && v.favor) return v.favor.from;
  if (v.phase === 'insert') return v.inserting;
  return -1;
}

function Flash({ flash }) {
  if (!flash) return null;
  return html`<div class=${`ek-flash ${flash.tone}`} role="status"><span class="stk disp">${flash.text}</span></div>`;
}

/** 同类的牌叠成一摞，手机上不用左右滑 */
function groupHand(hand) {
  const groups = new Map();
  for (const c of hand) {
    if (!groups.has(c.t)) groups.set(c.t, []);
    groups.get(c.t).push(c);
  }
  return ORDER.filter((t) => groups.has(t)).map((t) => ({ t, cards: groups.get(t) }));
}

// ---------- 主界面 ----------

export default function Kittens({ view: v, seat, seats, send, events, ver }) {
  const [pick, setPick] = useState(null); // 选中的那一摞 { t, k }：k 张
  const [picking, setPicking] = useState(null); // { ids, kind, target? }
  const [help, setHelp] = useState(false);
  const [flash, setFlash] = useState(null);

  const who = (i) => (i === seat ? '你' : seats[i] ? seats[i].name : `座位${i + 1}`);
  const alive = v.alive[seat];
  const groups = groupHand(v.hand);
  const myTurn = alive && v.phase === 'turn' && v.turn === seat;
  const nopeCard = v.hand.find((c) => c.t === 'nope');

  // 手牌变了就把选不了的去掉；不是我的回合就清空
  useEffect(() => {
    setPick((cur) => {
      if (!cur || !myTurn) return null;
      const have = v.hand.filter((c) => c.t === cur.t).length;
      return have ? { t: cur.t, k: Math.min(cur.k, have) } : null;
    });
    if (!myTurn) setPicking(null);
  }, [ver]);

  // 轮到我时手机震一下
  useEffect(() => {
    if (myTurn && navigator.vibrate) navigator.vibrate(120);
  }, [myTurn]);

  // 大字提示只留和输赢有关、和我有关的事，其他的看提示条
  useEffect(() => {
    let next = null;
    for (const e of events || []) {
      if (e.type === 'exploded') next = { text: e.seat === seat ? '你炸飞了！' : `${who(e.seat)} 炸飞了！`, tone: 'boom' };
      else if (e.type === 'defused') next = { text: e.seat === seat ? '拆除成功！' : `${who(e.seat)} 拆除了爆炸猫`, tone: 'safe' };
      else if (e.type === 'got' && e.from !== undefined && !next) next = { text: `拿到「${cardName(e.card.t)}」`, tone: 'safe' };
      else if (e.type === 'lost' && !next) next = { text: `被拿走了「${cardName(e.card.t)}」`, tone: 'nope' };
    }
    if (next) setFlash({ ...next, at: ver });
  }, [ver]);
  // 计时挂在提示本身上：电脑连着出牌也不会让提示卡在屏幕上
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 1400);
    return () => clearTimeout(id);
  }, [flash]);

  const sel = pick ? v.hand.filter((c) => c.t === pick.t).slice(0, pick.k).map((c) => c.id) : [];
  const selCards = sel.map((id) => v.hand.find((c) => c.id === id));
  const combo = comboOf(selCards);
  // 点一摞：功能牌选 1 张 / 取消；猫咪牌每点一次多选一张（最多 3 张），再点就取消
  const tap = (t, count) => setPick((cur) => {
    if (!cur || cur.t !== t) return { t, k: 1 };
    if (CARDS[t].cat && cur.k < Math.min(count, 3)) return { t, k: cur.k + 1 };
    return null;
  });
  const clearPick = () => setPick(null);

  const targets = v.alive.map((a, i) => (a && i !== seat && v.handCounts[i] > 0 ? i : -1)).filter((i) => i >= 0);

  const playSel = async () => {
    if (!combo) return;
    if (combo === 'favor' || combo === 'pair' || combo === 'triple') {
      setPicking({ ids: sel, kind: combo });
      return;
    }
    const r = await send('play', { ids: sel });
    if (r.ok) clearPick();
  };
  const finish = async (args) => {
    const r = await send('play', args);
    setPicking(null);
    if (r.ok) clearPick();
  };

  // ---------- 状态条：一眼看出现在轮到谁 ----------
  // 大字一行说「谁在做什么」，小字一行补充刚发生的事
  const p = v.pending;
  const last = v.log[v.log.length - 1];
  const lastText = last ? logText(last, who) : '游戏开始！轮流出牌，最后摸一张。';
  let head;
  let sub = lastText;
  let tone = '';
  if (v.phase === 'reaction' && p) {
    tone = 'react';
    head = html`<b>${who(p.by)}</b> 打出${kindName(p.kind, p.cards)}${p.target !== null ? html` → <b>${who(p.target)}</b>` : ''}`;
    sub = p.nopes > 0
      ? `被「不要」了 ${p.nopes} 次：${p.nopes % 2 ? '现在会被取消' : '现在会生效'}`
      : (p.named ? `点名要「${cardName(p.named)}」` : (nopeCard && alive ? '想拦就按下面的「不要！」' : '看看有没有人拦…'));
  } else if (v.phase === 'favor' && v.favor) {
    if (v.favor.from === seat) tone = 'mine';
    head = v.favor.from === seat ? '挑一张牌给对方' : `${who(v.favor.from)} 正在挑牌给 ${who(v.favor.to)}`;
  } else if (v.phase === 'insert') {
    if (v.inserting === seat) tone = 'mine';
    head = v.inserting === seat ? '把爆炸猫放回牌堆' : `${who(v.inserting)} 正在把猫放回牌堆`;
  } else if (v.phase === 'turn') {
    if (myTurn) {
      tone = 'mine';
      head = v.turnsLeft > 1 ? `轮到你了！要摸 ${v.turnsLeft} 次` : '轮到你了！';
    } else {
      head = html`轮到 <b>${who(v.turn)}</b>${v.turnsLeft > 1 ? `（要摸 ${v.turnsLeft} 次）` : ''}`;
    }
  }
  if (!alive && v.phase !== 'over') sub = `你出局了 · ${lastText}`;

  return html`<div class="ek">
    <div class="ek-main">
      <div class="ek-opps">
        ${seats.filter((s) => s.seat !== seat).map((s) => html`<${Opponent} key=${s.seat} s=${s} v=${v} me=${seat} />`)}
      </div>

      ${head && html`<div class="ek-banner-row">
        <div class=${`stk ek-banner ${tone}`} aria-live="polite">
          <div class="ek-head disp">${head}</div>
          <div class="ek-sub">${sub}</div>
          ${tone === 'react' && html`<${ReactBar} endsAt=${p.endsAt} total=${v.reactSec * 1000} />`}
        </div>
        <button class="btn btn-icon ek-help-btn" aria-label="牌面说明" onClick=${() => setHelp(true)}>?</button>
      </div>`}

      <div class="ek-table">
        <div class="ek-pile">
          <div class="ek-deck" aria-hidden="true"><span></span><span></span><span class="top"><${CardIcon} t="kitten" size=${44} /></span></div>
          <div class="small" style=${{ fontWeight: 900 }}>牌堆 <span class="num">${v.deckCount}</span> 张</div>
          <div class="small">里面有 <b class="num">${v.kittensLeft}</b> 只爆炸猫</div>
        </div>
        <div class="ek-pile">
          ${v.discardTop ? html`<span style=${{ transform: 'rotate(6deg)', display: 'inline-flex' }}><${Card} t=${v.discardTop.t} /></span>` : html`<span class="ek-empty">弃牌堆</span>`}
          <div class="small" style=${{ fontWeight: 900 }}>弃牌堆</div>
        </div>
      </div>

      ${v.peek && html`<div class="stk ek-peek">
        <span class="small" style=${{ fontWeight: 900 }}>牌堆顶（从上往下）</span>
        <div class="row" style=${{ gap: 8 }}>${v.peek.map((c, i) => html`<${Card} key=${i} t=${c.t} small />`)}</div>
      </div>`}

      ${alive && html`<div class=${`ek-hand${myTurn ? ' mine' : ''}`} aria-label="你的手牌">
        ${groups.map((g) => html`<${Card} key=${g.t} t=${g.t} count=${g.cards.length}
          selected=${pick && pick.t === g.t} picked=${pick && pick.t === g.t && g.cards.length > 1 ? pick.k : 0}
          label=${`${cardName(g.t)} ${g.cards.length} 张`}
          disabled=${!myTurn || g.t === 'defuse'} onClick=${() => tap(g.t, g.cards.length)} />`)}
      </div>`}
      ${myTurn && pick && CARDS[pick.t].cat && pick.k === 1 && html`<div class="ek-tip small">${v.hand.filter((c) => c.t === pick.t).length > 1
        ? '猫咪牌要两张一样的一起出，再点一下多选一张'
        : '单张猫咪牌不能出，要凑两张一样的'}</div>`}

      <div class="ek-actions">
        ${v.phase === 'reaction' && alive && nopeCard && html`<button class="btn btn-big ek-nope" onClick=${() => send('nope', { id: nopeCard.id })}>不要！</button>`}
        ${myTurn && html`
          <button class="btn btn-primary btn-big grow" disabled=${!combo} onClick=${playSel}>
            ${sel.length === 0 ? '选牌出牌' : combo ? playLabel(combo, selCards) : '这样不能出'}
          </button>
          <button class="btn btn-big grow" style=${{ background: 'var(--paper)' }} onClick=${() => send('draw')}>摸一张</button>`}
      </div>
    </div>

    <aside class="ek-side">
      <div class="stk ek-log">
        <div class="small" style=${{ fontWeight: 900 }}>记录</div>
        <ol>${v.log.slice().reverse().map((e, i) => html`<li key=${i}>${logText(e, who)}</li>`)}</ol>
      </div>
      <button class="btn" onClick=${() => setHelp(true)}>牌面说明</button>
    </aside>

    ${picking && html`<${Sheet} onClose=${() => setPicking(null)}>
      ${picking.kind === 'triple' && picking.target !== undefined
        ? html`<div class="disp" style=${{ fontSize: 24 }}>点名要哪种牌？</div>
          <div class="ek-pick-grid">${NAMEABLE.map((t) => html`<${Card} key=${t} t=${t} small
            onClick=${() => finish({ ids: picking.ids, target: picking.target, named: t })} />`)}</div>`
        : html`<div class="disp" style=${{ fontSize: 24 }}>${picking.kind === 'favor' ? '向谁索要？' : '从谁那里拿？'}</div>
          <div class="row" style=${{ flexWrap: 'wrap', gap: 14 }}>
            ${targets.map((i) => html`<button key=${i} class="stk ek-target" onClick=${() => (picking.kind === 'triple'
              ? setPicking({ ...picking, target: i })
              : finish({ ids: picking.ids, target: i }))}>
              <${Avatar} n=${seats[i].avatar ?? i} size=${48} />
              <span style=${{ fontWeight: 900 }}>${seats[i].name}</span>
              <span class="small num">${v.handCounts[i]} 张</span>
            </button>`)}
          </div>`}
      <button class="btn" onClick=${() => setPicking(null)}>算了</button>
    <//>`}

    ${v.phase === 'favor' && v.favor && v.favor.from === seat && html`<${Sheet}>
      <div class="disp" style=${{ fontSize: 24 }}>${who(v.favor.to)} 向你索要一张牌</div>
      <div class="small">挑一张给对方：</div>
      <div class="ek-pick-grid">${groups.map((g) => html`<${Card} key=${g.t} t=${g.t} small count=${g.cards.length}
        onClick=${() => send('give', { id: g.cards[0].id })} />`)}</div>
    <//>`}

    ${v.phase === 'insert' && v.inserting === seat && html`<${Sheet}>
      <div class="disp" style=${{ fontSize: 26 }}>拆除成功！</div>
      <div>把爆炸猫偷偷放回牌堆，别人看不到放在哪。牌堆现在有 <b class="num">${v.deckCount}</b> 张。</div>
      <div class="ek-pos">
        ${insertChoices(v.deckCount).map(([label, pos]) => html`<button key=${label} class="btn" onClick=${() => send('insert', { pos })}>${label}</button>`)}
        <button class="btn btn-primary" onClick=${() => send('insert', { pos: Math.floor(Math.random() * (v.deckCount + 1)) })}>随机</button>
      </div>
    <//>`}

    ${help && html`<${Sheet} onClose=${() => setHelp(false)}>
      <div class="disp" style=${{ fontSize: 24 }}>怎么玩</div>
      <div class="small">轮到你时，可以先出任意张功能牌，最后摸一张牌结束回合。摸到爆炸猫又没有拆除就出局，最后活着的人赢。</div>
      <div class="ek-guide">
        ${['kitten', 'defuse', 'attack', 'skip', 'future', 'shuffle', 'favor', 'nope', 'cat1'].map((t) => html`<div key=${t} class="row" style=${{ alignItems: 'flex-start' }}>
          <${Card} t=${t} small />
          <div class="small"><b>${t === 'cat1' ? '猫咪牌（五种）' : cardName(t)}</b><br />${cardDesc(t)}</div>
        </div>`)}
      </div>
      <button class="btn" onClick=${() => setHelp(false)}>知道了</button>
    <//>`}

    <${Flash} flash=${flash} />
  </div>`;
}

function comboOf(cards) {
  if (cards.length === 1 && ['attack', 'skip', 'future', 'shuffle', 'favor'].includes(cards[0].t)) return cards[0].t;
  if ((cards.length === 2 || cards.length === 3) && CARDS[cards[0].t].cat && cards.every((c) => c.t === cards[0].t)) {
    return cards.length === 2 ? 'pair' : 'triple';
  }
  return null;
}

function playLabel(combo, cards) {
  if (combo === 'favor') return '索要：选一个人';
  if (combo === 'pair') return '一对：抽别人一张';
  if (combo === 'triple') return '三张：点名要牌';
  return `打出「${cardName(cards[0].t)}」`;
}

function insertChoices(n) {
  const out = [['最上面', 0]];
  if (n >= 2) out.push(['第 2 张', 1]);
  if (n >= 3) out.push(['第 3 张', 2]);
  if (n >= 6) out.push(['中间', Math.floor(n / 2)]);
  if (n >= 1) out.push(['最下面', n]);
  return out;
}
