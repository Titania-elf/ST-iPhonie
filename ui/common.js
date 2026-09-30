import {icon, spark} from './icons.js';

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const engines = {fish: 'Fish Audio', mini: 'MiniMax', eleven: 'ElevenLabs'};
export const languages = [['', '跟随默认'], ['zh', '中文'], ['en', '英语'], ['ja', '日语'], ['ko', '韩语'], ['fr', '法语'], ['de', '德语'], ['es', '西班牙语'], ['ru', '俄语'], ['it', '意大利语'], ['pt', '葡萄牙语'], ['ar', '阿拉伯语'], ['hi', '印地语'], ['th', '泰语'], ['vi', '越南语']];
export const languageName = code => languages.find(([value]) => value === code)?.[1] || code;
export const size = bytes => bytes < 1024 * 1024 ? Math.round(bytes / 1024) + ' KB' : (bytes / 1024 / 1024).toFixed(1) + ' MB';

// style: primary | secondary | danger | text-button | chip-button
export const btn = (action, text, style = 'secondary', attrs = '') => `<button type="button" class="${style}" data-action="${action}" ${attrs}>${text}</button>`;
export const help = text => `<button type="button" class="info" data-help="${esc(text)}" aria-label="查看说明">i</button>`;
export const field = (label, control, info = '') => `<div class="field"><span>${esc(label)}${info ? help(info) : ''}</span>${control.replace(/aria-label="[^"]*"/, 'aria-label="' + esc(label) + '"')}</div>`;
export const input = (key, value = '', type = 'text', attrs = '') => `<input data-field="${esc(key)}" aria-label="${esc(key)}" type="${type}" value="${esc(value)}" ${attrs}>`;
export const select = (key, value, choices, attrs = '') => `<span class="select"><select data-field="${esc(key)}" aria-label="${esc(key)}" ${attrs}>${choices.map(([v, t, disabled]) => `<option value="${esc(v)}" ${String(value) === String(v) ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${esc(t)}</option>`).join('')}</select></span>`;
export const textArea = (key, value, attrs = '') => `<textarea data-field="${esc(key)}" aria-label="${esc(key)}" rows="5" ${attrs}>${esc(value)}</textarea>`;
export const toggle = (key, label, value, info = '') => `<div class="setting-row"><span>${esc(label)}${info ? help(info) : ''}</span><input class="switch" aria-label="${esc(label)}" type="checkbox" data-field="${esc(key)}" ${value ? 'checked' : ''}></div>`;
export const empty = (title, detail = '', art = 'music') => `<div class="empty">${icon(art)}<h2>${esc(title)}</h2>${detail ? `<p>${esc(detail)}</p>` : ''}</div>`;

// Page title: small English eyebrow, a big title with a marker underline, and optional actions.
export const heading = (title, actions = '', eyebrow = '') => `<header class="page-heading"><div>${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ''}<h1><span>${esc(title)}</span>${spark()}</h1></div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</header>`;
export const groupTitle = (title, extra = '') => `<div class="group-title"><span>${esc(title)}</span>${extra}</div>`;

// A skewed name plate; engine colour comes from the nearest data-engine ancestor.
export const plate = (text, attrs = '') => `<span class="plate" ${attrs}><span>${esc(text)}</span></span>`;
export const avatar = (name, engine = 'none', size = 48) => `<span class="avatar${engine === 'none' ? ' none' : ''}" data-engine="${engine}" style="--s:${size}px">${esc(String(name || '?').trim().slice(0, 1) || '?')}</span>`;

export function createView(ctx, name) {
  const root = ctx.doc.createElement('section');
  root.className = 'view';
  root.dataset.app = name;
  const controller = new ctx.win.AbortController();
  let disposed = false;
  const view = {
    root,
    back: null,
    refresh() {},
    dispose() { disposed = true; controller.abort(); },
    get disposed() { return disposed; },
    // Replaces the view content while keeping scroll position and open <details> groups.
    draw(html) {
      const y = root.scrollTop;
      const opened = [...root.querySelectorAll('details[open]')].map(el => el.dataset.group);
      root.innerHTML = html;
      for (const el of root.querySelectorAll('details')) if (opened.includes(el.dataset.group)) el.open = true;
      root.scrollTop = y;
    },
    on(type, selector, fn) {
      root.addEventListener(type, event => {
        const el = event.target.closest(selector);
        if (!el || !root.contains(el)) return;
        if (type === 'click') event.preventDefault();
        try {
          const result = fn(el, event);
          if (result?.catch) result.catch(error => ctx.notify(error.message, {error: true}));
        } catch (error) { ctx.notify(error.message, {error: true}); }
      }, {signal: controller.signal});
    },
    async busy(el, task) {
      if (el.disabled) return;
      el.disabled = true;
      try { return await task(); } finally { if (el.isConnected) el.disabled = false; }
    }
  };
  view.on('click', '[data-help]', el => ctx.help(el.dataset.help));
  bindCombos(root, controller.signal);
  return view;
}

// A browser <datalist> only lists the entries that match what is already typed (with "ja" in the box it shows only
// 日语), so the language box has its own list: every language as a chip under the box, opened by tapping the box or ▾.
export function languageField(key, value, inherit = true) {
  const chip = (v, t) => `<button type="button" class="combo-chip" data-combo-value="${esc(v)}" aria-pressed="${String(value) === v}">${esc(t)}${v ? `<small>${esc(v)}</small>` : ''}</button>`;
  const control = `<span class="combo">${input(key, value, 'text', `placeholder="${inherit ? '留空跟随默认' : '例如 zh、en、ja'}" autocomplete="off"`)}<button type="button" class="combo-open" data-combo-open aria-expanded="false" aria-label="展开全部语言">${icon('down')}</button></span><span class="combo-menu" role="group" aria-label="全部语言" hidden>${languages.filter(([v]) => v || inherit).map(([v, t]) => chip(v, t)).join('')}</span>`;
  return field('台词语言', control, '可填写语言代码或语言名称；角色留空时使用默认台词语言。点输入框或右边的箭头可以看到全部语言。');
}
function bindCombos(root, signal) {
  const menuOf = el => el.closest('.field')?.querySelector('.combo-menu');
  const show = (field, open, filter = '') => {
    const menu = field.querySelector('.combo-menu'), box = field.querySelector('.combo input');
    if (!menu || !box) return;
    menu.hidden = !open;
    field.querySelector('[data-combo-open]')?.setAttribute('aria-expanded', String(open));
    const q = filter.trim().toLowerCase();
    for (const chip of menu.querySelectorAll('[data-combo-value]')) {
      chip.hidden = !!q && !chip.textContent.toLowerCase().includes(q);
      chip.setAttribute('aria-pressed', String(chip.dataset.comboValue === box.value.trim()));
    }
  };
  root.addEventListener('focusin', e => { if (e.target.matches('.combo input')) show(e.target.closest('.field'), true); }, {signal});
  root.addEventListener('click', e => {
    const opener = e.target.closest('[data-combo-open]'), pick = e.target.closest('[data-combo-value]');
    if (opener) { const f = opener.closest('.field'); show(f, menuOf(opener).hidden); return; }
    if (e.target.matches('.combo input')) { show(e.target.closest('.field'), true); return; }
    if (!pick) return;
    const f = pick.closest('.field'), box = f.querySelector('.combo input');
    box.value = pick.dataset.comboValue;
    for (const type of ['input', 'change']) box.dispatchEvent(new box.ownerDocument.defaultView.Event(type, {bubbles: true}));
    show(f, false);
  }, {signal});
  // Typing narrows the list; a value already chosen (like "ja") still opens the whole list.
  root.addEventListener('input', e => { if (e.target.matches('.combo input') && e.isTrusted !== false && e.target.ownerDocument.activeElement === e.target) show(e.target.closest('.field'), true, e.target.value); }, {signal});
  root.addEventListener('keydown', e => { if (e.key === 'Escape' && e.target.closest('.combo')) { const f = e.target.closest('.field'); if (!menuOf(e.target).hidden) { e.stopPropagation(); show(f, false); } } }, {signal});
  root.ownerDocument.addEventListener('pointerdown', e => {
    for (const menu of root.querySelectorAll('.combo-menu:not([hidden])')) if (!menu.closest('.field').contains(e.target)) show(menu.closest('.field'), false);
  }, {signal});
}
