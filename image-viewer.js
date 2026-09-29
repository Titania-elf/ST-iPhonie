// Full-screen image viewer shared by the tavern page (pictures in the chat) and the phone (album, drawing app).
// It opens at the size the picture had on the page (`from`), then zooms freely: wheel, pinch or the buttons;
// drag to move; double-click or double-tap switches between that size and 2.5x.
// It brings its own styles, so it works in any document.

const STYLE_ID = 'sttts-viewer-style';
const CSS = `
.sttts-viewer{position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;z-index:40000;background:rgba(8,10,20,.92);touch-action:none;user-select:none;-webkit-user-select:none;overscroll-behavior:contain;font:14px/1.4 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#fff}
.sttts-viewer img{position:absolute;left:0;top:0;max-width:none;max-height:none;transform-origin:0 0;will-change:transform;cursor:grab;-webkit-user-drag:none}
.sttts-viewer[data-dragging] img{cursor:grabbing}
.sttts-viewer-bar{position:absolute;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;align-items:center;gap:2px;padding:4px;border-radius:24px;background:rgba(20,24,40,.78);box-shadow:0 8px 24px rgba(0,0,0,.4);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);max-width:calc(100vw - 24px);flex-wrap:wrap;justify-content:center}
.sttts-viewer button{all:unset;box-sizing:border-box;min-width:40px;height:44px;padding:0 10px;border-radius:999px;display:inline-grid;place-items:center;cursor:pointer;color:#fff;font-weight:700;white-space:nowrap}
.sttts-viewer button:hover{background:rgba(255,255,255,.12)}
.sttts-viewer button:focus-visible{outline:2px solid #7cc4ff;outline-offset:2px}
.sttts-viewer button[data-danger]{color:#ff9cb8}
.sttts-viewer output{min-width:48px;text-align:center;font-variant-numeric:tabular-nums;opacity:.85}
@media(max-width:480px){.sttts-viewer [data-v=full]{display:none}}
.sttts-viewer .sttts-viewer-close{position:absolute;top:max(14px,env(safe-area-inset-top));right:14px;background:rgba(20,24,40,.7);font-size:22px}
@media(prefers-reduced-motion:no-preference){.sttts-viewer img[data-animate]{transition:transform .2s ease}}
`;

/**
 * Opens the viewer. from: the element the picture was shown in (its size and place are where the viewer starts).
 * actions: [{label, danger?, run}] extra buttons; `run` may return a promise; the viewer
 * closes after an action unless it returns false.
 */
export function openImageViewer({doc = document, src, alt = '', actions = [], from = null}) {
  const win = doc.defaultView;
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.append(style);
  }
  const focus = doc.activeElement;
  const root = doc.createElement('div');
  root.className = 'sttts-viewer';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '查看图片');
  root.innerHTML = `<img alt=""><button class="sttts-viewer-close" data-v="close" aria-label="关闭">×</button>
    <div class="sttts-viewer-bar"><button data-v="out" aria-label="缩小">－</button><output aria-live="polite"></output><button data-v="in" aria-label="放大">＋</button><button data-v="home">复原</button><button data-v="fit">适应屏幕</button><button data-v="full">实际像素</button>${actions.map((a, i) => `<button data-action="${i}"${a.danger ? ' data-danger' : ''}></button>`).join('')}</div>`;
  const img = root.querySelector('img'), label = root.querySelector('output');
  img.alt = alt;
  actions.forEach((a, i) => { root.querySelector(`[data-action="${i}"]`).textContent = a.label; });
  doc.body.append(root);

  let s = 1, tx = 0, ty = 0, fit = 1, base = 1, closed = false, opened = false;
  const start = from?.getBoundingClientRect?.();
  const pointers = new Map();
  let gesture = null, lastTap = null;
  // The tavern puts a transform on <html>, which makes a fixed box with only `inset` collapse to 0 height:
  // the box has an explicit viewport size, and the window size is the fallback.
  const size = () => ({w: root.clientWidth || win.innerWidth, h: root.clientHeight || win.innerHeight});
  const nat = () => ({w: img.naturalWidth || 1, h: img.naturalHeight || 1});

  function clamp() {
    const {w, h} = size(), n = nat(), iw = n.w * s, ih = n.h * s;
    tx = iw <= w ? (w - iw) / 2 : Math.min(0, Math.max(w - iw, tx));
    ty = ih <= h ? (h - ih) / 2 : Math.min(0, Math.max(h - ih, ty));
  }
  function apply(animate = false) {
    clamp();
    img.toggleAttribute('data-animate', animate);
    img.style.transform = `translate(${tx}px,${ty}px) scale(${s})`;
    label.textContent = Math.round(s * 100) + '%';
  }
  function zoomAt(next, x, y, animate) {
    const max = Math.max(4, fit * 8, base * 8), min = Math.min(fit, base, 1) * .5;
    next = Math.min(max, Math.max(min, next));
    tx = x - (x - tx) * next / s;
    ty = y - (y - ty) * next / s;
    s = next;
    apply(animate);
  }
  function measure() {
    const {w, h} = size(), n = nat();
    // Leave room for the button bar when there is space; a hidden viewer (0×0) keeps 100%.
    const room = h > 240 ? h - 90 : h;
    fit = w > 0 && room > 0 ? Math.min(w / n.w, room / n.h, 1) : 1;
    base = start?.width > 0 ? start.width / n.w : fit;
  }
  /** Back to the size the picture had on the page, centred. */
  function home(animate = false) { measure(); s = base; tx = 0; ty = 0; apply(animate); }
  function fitView(animate = false) { measure(); s = fit; tx = 0; ty = 0; apply(animate); }
  function reset() {
    if (opened) { home(); return; }
    opened = true;
    measure();
    s = base;
    // Start exactly over the picture on the page, then glide to the centre.
    if (start?.width > 0) { tx = start.left; ty = start.top; img.style.transform = `translate(${tx}px,${ty}px) scale(${s})`; label.textContent = Math.round(s * 100) + '%'; win.requestAnimationFrame(() => win.requestAnimationFrame(() => { tx = 0; ty = 0; apply(true); })); }
    else apply();
  }
  const center = () => { const {w, h} = size(); return [w / 2, h / 2]; };

  img.addEventListener('load', () => reset());
  img.src = src;
  if (img.complete && img.naturalWidth) reset();

  function close() {
    if (closed) return;
    closed = true;
    root.remove();
    win.removeEventListener('resize', onResize);
    doc.removeEventListener('keydown', onKey, true);
    if (focus?.isConnected) focus.focus?.({preventScroll: true});
  }
  const onResize = () => home();
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === '+' || e.key === '=') zoomAt(s * 1.25, ...center(), true);
    else if (e.key === '-') zoomAt(s / 1.25, ...center(), true);
  };
  win.addEventListener('resize', onResize);
  doc.addEventListener('keydown', onKey, true);

  root.addEventListener('wheel', e => {
    e.preventDefault();
    const r = root.getBoundingClientRect();
    zoomAt(s * Math.exp(-e.deltaY * .0015), e.clientX - r.left, e.clientY - r.top);
  }, {passive: false});
  root.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    root.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
    root.toggleAttribute('data-dragging', true);
    gesture = null;
  });
  root.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const r = root.getBoundingClientRect();
    if (pointers.size === 1) {
      tx += e.clientX - p.x; ty += e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(e.clientX - (lastTap?.x ?? e.clientX), e.clientY - (lastTap?.y ?? e.clientY)) > 20) lastTap = null;
      apply();
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
    if (gesture) {
      tx += mx - gesture.mx; ty += my - gesture.my;
      zoomAt(s * dist / gesture.dist, mx, my);
    }
    gesture = {dist, mx, my};
    lastTap = null;
  });
  const end = e => {
    if (!pointers.has(e.pointerId)) return;
    const moved = pointers.size === 1 && gesture === null;
    pointers.delete(e.pointerId);
    gesture = null;
    if (!pointers.size) root.removeAttribute('data-dragging');
    if (e.type !== 'pointerup' || !moved) return;
    const r = root.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, now = Date.now();
    if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
      lastTap = null;
      if (s > base * 1.05) home(true); else zoomAt(base * 2.5, x, y, true);
    } else lastTap = {t: now, x: e.clientX, y: e.clientY};
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const v = b.dataset.v;
    if (v === 'close') close();
    else if (v === 'in') zoomAt(s * 1.5, ...center(), true);
    else if (v === 'out') zoomAt(s / 1.5, ...center(), true);
    else if (v === 'home') home(true);
    else if (v === 'fit') fitView(true);
    else if (v === 'full') zoomAt(1, ...center(), true);
    else if (b.dataset.action !== undefined) {
      const result = await actions[Number(b.dataset.action)].run();
      if (result !== false) close();
    }
  });
  root.querySelector('[data-v=close]').focus({preventScroll: true});
  return {close, get scale() { return s; }};
}
