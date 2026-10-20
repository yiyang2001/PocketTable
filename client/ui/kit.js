// 组件库：所有界面（包括各游戏的视图）都从这里拿按钮、头像、计时器等，保证风格一致。

import { html, useEffect, useState } from '../vendor/preact-htm.js';

// ---------- 图标（描边 SVG） ----------

const ICONS = {
  back: html`<path d="M17 7l-7 7 7 7" />`,
  next: html`<path d="M11 7l7 7-7 7" />`,
  plus: html`<path d="M14 6v16M6 14h16" />`,
  close: html`<path d="M8 8l12 12M20 8L8 20" />`,
  flag: html`<path d="M7 24V5M7 6h12l-3 4 3 4H7" />`,
  refresh: html`<path d="M21 10a8 8 0 1 0 1 6" /><path d="M22 5v6h-6" />`,
};

export function Icon({ name, size = 24, color = 'currentColor' }) {
  return html`<svg width=${size} height=${size} viewBox="0 0 28 28" fill="none" stroke=${color} stroke-width="3"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

// ---------- 头像 ----------

const AVATAR_COLORS = ['#4D8DFF', '#3DD68C', '#9B6BFF', '#FF8A2A', '#FF5A3C', '#FFD84D', '#BFE9F5', '#F7A8C8'];
const FACES = [
  html`<circle cx="11" cy="14" r="2" fill="#1F1A2E" /><circle cx="23" cy="14" r="2" fill="#1F1A2E" /><path d="M10 22c4 4 10 4 14 0" />`,
  html`<path d="M8 14h6M20 14h6" /><path d="M12 23h10" />`,
  html`<circle cx="11" cy="14" r="2" fill="#1F1A2E" /><circle cx="23" cy="14" r="2" fill="#1F1A2E" /><circle cx="17" cy="23" r="3" />`,
  html`<path d="M7 12l3-6 4 5M27 12l-3-6-4 5" /><circle cx="12" cy="17" r="1.6" fill="#1F1A2E" /><circle cx="22" cy="17" r="1.6" fill="#1F1A2E" /><path d="M14 23l3 2 3-2" />`,
];

export function Avatar({ n = 0, size = 52, dead = false }) {
  const face = dead
    ? html`<path d="M8 11l6 6M14 11l-6 6M20 11l6 6M26 11l-6 6" /><path d="M12 25h10" />`
    : FACES[n % FACES.length];
  return html`<span class="avatar" style=${{ width: size, height: size, background: dead ? '#D9D3C7' : AVATAR_COLORS[n % AVATAR_COLORS.length] }}>
    <svg width=${size * 0.55} height=${size * 0.55} viewBox="0 0 34 34" fill="none" stroke="#1F1A2E" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${face}</svg>
  </span>`;
}
export const AVATAR_COUNT = AVATAR_COLORS.length;

// ---------- 计时器 ----------

export function useNow(intervalMs = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** 倒计时。deadline 是服务器时间；局域网里时钟误差可以忽略。 */
export function Timer({ deadline }) {
  const now = useNow();
  if (!deadline) return null;
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  const text = left >= 60 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : `0:${String(left).padStart(2, '0')}`;
  return html`<span class=${`timer num${left <= 5 ? ' hurry' : ''}`} role="timer" aria-label=${`剩余 ${left} 秒`}>${text}</span>`;
}

// ---------- 弹出层 ----------

export function Sheet({ children, onClose }) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);
  return html`<div class="sheet-back" onClick=${(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
    <div class="sheet stk" role="dialog" aria-modal="true">${children}</div>
  </div>`;
}

export function Toasts({ items }) {
  return html`<div class="toasts" aria-live="polite">
    ${items.map((x) => html`<div key=${x.id} class=${`toast stk${x.bad ? ' bad' : ''}`}>${x.text}</div>`)}
  </div>`;
}

// ---------- 游戏封面 ----------

const COVERS = {
  count21: { color: '#FFD84D', icon: html`<text x="18" y="24" text-anchor="middle" font-size="16" font-weight="700" fill="#1F1A2E" stroke="none">21</text>` },
};

export function Cover({ id }) {
  const c = COVERS[id] || { color: '#FFFFFF', icon: html`<circle cx="18" cy="18" r="9" />` };
  return html`<span class="cover" style=${{ background: c.color }}>
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="#1F1A2E" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${c.icon}</svg>
  </span>`;
}
