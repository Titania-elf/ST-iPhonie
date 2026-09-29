import {connectBackend} from './backend-client.js';
import {glyph, icon, spark, wave} from './icons.js';
import {esc, avatar, plate} from './common.js';
import {APPS, HOME, SLOT} from './apps.js';
import {wallpaperLook} from './wallpapers.js';
import {rolesApp} from './roles.js';
import {enginesApp} from './engines.js';
import {presetsApp} from './presets.js';
import {libraryApp, galleryApp, notesApp, listenApp} from './media-apps.js';
import {settingsApp} from './settings.js';
import {drawApp} from './draw.js';
import {chatApp} from './chat.js';

// App factories, keyed by the ids in apps.js.
const FACTORIES = {roles: rolesApp, engines: enginesApp, presets: presetsApp, library: libraryApp, gallery: galleryApp, notes: notesApp, listen: listenApp, settings: settingsApp, draw: drawApp, chat: chatApp};
const ACTIVE_PHASES = ['playing', 'paused', 'generating', 'waiting'];

const SIGNAL = '<svg viewBox="0 0 18 12" fill="currentColor" aria-hidden="true"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>';

export function createPhoneApp({window: win, api, mount = win.document.getElementById('root')}) {
  const doc = win.document;
  const controller = new win.AbortController(), signal = controller.signal;
  const views = new Map(), assets = new Map();
  const media = win.matchMedia('(prefers-color-scheme: dark)'), motion = win.matchMedia('(prefers-reduced-motion: reduce)');
  let panelVisible = true, active = null, locked = false, sheet = null, disposed = false;
  let preferences = null, appearanceKey = '', appearanceEpoch = 0, toastTimer, animation, openTimer, unread = 0, unreadTimer;
  let playback = api.status();

  mount.innerHTML = `
    <div class="stage">
      <div class="stage-bar"><span>ST-iPhonie</span><div class="stage-actions"><button class="info" data-system="help" aria-label="手机界面说明">i</button><button class="close" data-system="close" aria-label="返回酒馆">${icon('close')}</button></div></div>
      <div class="device">
        <button class="power-key" data-system="power" aria-label="锁屏或唤醒"></button>
        <div class="screen" data-view="home">
          <div class="wallpaper"></div>
          <div class="statusbar"><time data-clock="small"></time><button class="status-icons" data-system="control" aria-label="打开控制中心，或向下拖动">${SIGNAL}<span class="battery" aria-hidden="true"></span></button></div>
          <button class="island" data-system="island" aria-label="打开听取"><span class="island-avatar"></span><span class="island-title"></span><span class="island-wave" hidden>${wave}</span><span class="camera"></span></button>
          <main class="home">
            <button class="home-close" data-system="close" aria-label="返回酒馆">${icon('close')}</button>
            <div class="home-pages"></div>
            <div class="dots" aria-hidden="true"></div>
            <nav class="phone-dock" aria-label="常用应用"></nav>
          </main>
          <section class="app-frame" hidden><header class="app-nav"><button class="nav-button" data-system="back" aria-label="返回">${icon('back')}</button><button class="nav-button" data-system="home" aria-label="返回桌面">${icon('home')}</button></header><div class="app-content"></div></section>
          <button class="home-indicator" data-system="home" aria-label="返回桌面"></button>
          <section class="lockscreen" role="dialog" aria-modal="true" aria-label="锁屏" hidden></section>
          <div class="toast" role="status" hidden></div>
        </div>
      </div>
    </div>`;
  const $ = s => mount.querySelector(s);
  const screen = $('.screen'), home = $('.home'), frame = $('.app-frame'), content = $('.app-content'), lockscreen = $('.lockscreen');

  function notify(text) {
    if (disposed) return;
    const el = $('.toast');
    el.textContent = text || '操作未完成';
    el.hidden = false;
    win.clearTimeout(toastTimer);
    toastTimer = win.setTimeout(() => el.hidden = true, 4500);
  }
  function run(fn) {
    try {
      const result = fn();
      result?.catch?.(error => notify(error.message));
      return result;
    } catch (error) { notify(error.message); }
  }
  function syncInert() {
    home.inert = !!active || locked || !!sheet;
    frame.inert = !active || locked || !!sheet;
    for (const s of ['.statusbar', '.island', '.home-indicator']) $(s).inert = locked || !!sheet;
    lockscreen.inert = !locked || !!sheet;
  }

  // ---------- Sheets ----------
  function dialog(title, html, {top = false} = {}) {
    sheet?.close(null);
    const focus = doc.activeElement, overlay = doc.createElement('div');
    overlay.className = 'overlay' + (top ? ' top' : '');
    overlay.innerHTML = `<section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header class="sheet-header"><h2>${esc(title)}</h2><button class="nav-button" data-sheet-close aria-label="关闭">${icon('close')}</button></header><div class="sheet-body">${html}</div></section>`;
    screen.append(overlay);
    let live = true;
    const callbacks = [];
    const result = {
      body: overlay.querySelector('.sheet-body'),
      get live() { return live; },
      onClose(fn) { callbacks.push(fn); },
      close(value = null) {
        if (!live) return;
        live = false;
        overlay.remove();
        if (sheet === result) sheet = null;
        syncInert();
        for (const callback of callbacks) callback(value);
        if (focus?.isConnected && !focus.closest('[inert]')) focus.focus({preventScroll: true});
      }
    };
    overlay.addEventListener('click', e => { if (e.target === overlay || e.target.closest('[data-sheet-close]')) result.close(null); });
    overlay.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const controls = [...overlay.querySelectorAll('button,input,select,textarea,a[href]')].filter(el => !el.disabled && !el.hidden);
      if (!controls.length) return;
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    sheet = result;
    syncInert();
    overlay.querySelector('button').focus({preventScroll: true});
    return result;
  }
  function confirm(title, text = '') {
    return new Promise(resolve => {
      const d = dialog(title, `<p class="help-copy">${esc(text)}</p><div class="actions"><button type="button" class="secondary" data-action="cancel">取消</button><button type="button" class="primary" data-action="confirm">确认</button></div>`);
      d.onClose(value => resolve(value === true));
      d.body.addEventListener('click', e => {
        const action = e.target.closest('button')?.dataset.action;
        if (action === 'confirm') d.close(true);
        if (action === 'cancel') d.close(false);
      });
    });
  }
  const help = text => dialog('说明', `<p class="help-copy">${esc(text)}</p>`);

  const routeFor = name => api.getState().routes.find(r => r.name === name);
  const engineOf = name => { const r = routeFor(name); return r?.voice ? r.engine : 'none'; };
  const ctx = {api, doc, win, notify, dialog, confirm, help, lock, open, routeFor, engineOf, openPendingRole: name => openPendingRole(name), visible: name => active === name && !locked,
    editEngine: id => views.get('engines')?.edit?.(id), showPresetKind: kind => views.get('presets')?.showKind?.(kind)};

  // ---------- Navigation ----------
  function open(name, roleId) {
    if (!FACTORIES[name]) return;
    sheet?.close(null);
    unlock();
    active = name;
    let v = views.get(name);
    if (!v) { v = FACTORIES[name](ctx); views.set(name, v); content.append(v.root); }
    else run(() => v.refresh());
    for (const [id, view] of views) view.root.hidden = id !== name;
    home.hidden = true;
    frame.hidden = false;
    screen.dataset.view = 'app';
    screen.dataset.opening = 'true';
    win.clearTimeout(openTimer);
    openTimer = win.setTimeout(() => delete screen.dataset.opening, 260);
    syncInert();
    $('.app-nav [data-system=back]').focus({preventScroll: true});
    if (roleId && v.edit) v.edit(roleId);
    v.onPlayback?.(playback);
  }
  function showHome() {
    sheet?.close(null);
    if (locked) return;
    active = null;
    home.hidden = false;
    frame.hidden = true;
    screen.dataset.view = 'home';
    syncInert();
  }
  function back() {
    if (sheet) { sheet.close(null); return; }
    if (locked) { unlock(); return; }
    if (active && views.get(active)?.back?.()) return;
    showHome();
  }
  function lock() {
    sheet?.close(null);
    locked = true;
    renderLock();
    lockscreen.hidden = false;
    syncInert();
    lockscreen.querySelector('[data-system=unlock]').focus({preventScroll: true});
  }
  function unlock() {
    if (!locked) return;
    locked = false;
    lockscreen.hidden = true;
    syncInert();
    if (active) $('.app-nav [data-system=back]').focus({preventScroll: true});
    else home.querySelector('.app-icon')?.focus({preventScroll: true});
  }
  function openPendingRole(name) {
    const route = routeFor(name);
    if (route) { open('roles', route.id); return; }
    open('roles');
    views.get('roles')?.create?.(name);
  }

  // ---------- Clock and theme ----------
  function clock() {
    const now = new Date();
    const time = now.toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', hour12: false});
    const date = now.toLocaleDateString('zh-CN', {month: 'long', day: 'numeric', weekday: 'long'});
    for (const el of mount.querySelectorAll('[data-clock]')) el.textContent = el.dataset.clock === 'date' ? date : time;
  }
  const isDark = () => doc.documentElement.dataset.theme === 'dark';
  function applyThemeMode() {
    const mode = preferences?.theme || api.getState().theme;
    doc.documentElement.dataset.theme = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode;
    doc.documentElement.dataset.skin = preferences?.skin || 'sky';
  }
  function theme() {
    applyThemeMode();
    if (preferences) run(() => appearance(preferences));
  }

  // ---------- Home screen ----------
  function appIcon(id) {
    if (id === SLOT) return `<button class="app-icon slot" data-slot aria-label="预留位置"><span class="icon-tile">${icon('add')}</span><span class="app-label">预留</span></button>`;
    const meta = APPS[id], custom = preferences?.icons?.[id], [t1, t2, tac] = meta.colors;
    const image = custom?.kind === 'photo' ? assets.get(custom.photoId) : null;
    const art = image ? `<img src="${esc(image)}" alt="">` : glyph(custom?.kind === 'glyph' && custom.key !== 'default' ? custom.key : id);
    const badge = id === 'chat' && unread ? `<span class="badge app-badge">${unread > 99 ? '99+' : unread}</span>` : '';
    return `<button class="app-icon" data-app="${id}" aria-label="${esc(meta.name)}${badge ? `，${unread} 条未读` : ''}"><span class="icon-tile" style="--t1:${t1};--t2:${t2};--tac:${tac}">${art}</span>${badge}<span class="app-label">${esc(meta.name)}</span></button>`;
  }
  function renderHome() {
    const pages = HOME.pages.map((ids, index) => `<div class="home-page">${index === 0
      ? `<div class="clock-block"><p class="home-date" data-clock="date"></p><p class="home-clock" data-clock="large"></p></div><div class="widgets"><button class="widget live-wave" data-system="island" data-widget="playing"></button><div class="widget" data-widget="cast"></div></div>`
      : ''}<div class="apps-grid">${ids.map(appIcon).join('')}</div>${ids.every(id => id === SLOT) ? '<p class="slot-note">这一页留给以后的新 App</p>' : ''}</div>`).join('');
    $('.home-pages').innerHTML = pages;
    $('.dots').innerHTML = HOME.pages.map((_, i) => `<i${i === 0 ? ' data-on' : ''}></i>`).join('');
    $('.phone-dock').innerHTML = HOME.dock.map(appIcon).join('');
    clock();
    renderWidgets();
  }
  function renderWidgets() {
    const playing = $('[data-widget=playing]'), cast = $('[data-widget=cast]');
    if (playing) {
      const line = playback.line, speaker = playback.speaker, on = ACTIVE_PHASES.includes(playback.phase) && speaker;
      playing.dataset.engine = on ? engineOf(speaker) : 'none';
      playing.innerHTML = `<span class="widget-head"><span class="eyebrow">Now Playing</span>${wave}</span>${on
        ? `<span class="who">${avatar(speaker, engineOf(speaker), 30)}${plate(speaker)}</span><span class="widget-line">${esc(line?.translation ? '“' + line.translation + '”' : playback.message || '')}</span>`
        : '<span class="widget-line">还没有在播放</span><small>点聊天里的声波，或打开听取</small>'}`;
    }
    if (cast) {
      const routes = api.getState().routes.slice(0, 4);
      cast.innerHTML = `<span class="widget-head"><span class="eyebrow">Cast</span></span>${routes.length
        ? `<div class="cast">${routes.map(r => `<button data-open-role="${esc(r.id)}" aria-label="打开 ${esc(r.name)} 的配音">${avatar(r.name, r.voice ? r.engine : 'none', 28)}<span>${esc(r.name)}</span></button>`).join('')}</div>`
        : `<span class="widget-line">还没有角色</span><button class="chip-button" data-app="roles">新增角色</button>`}`;
    }
  }
  function renderLock() {
    const on = ACTIVE_PHASES.includes(playback.phase) && playback.speaker;
    lockscreen.innerHTML = `${icon('lock')}<p class="home-date" data-clock="date"></p><p class="home-clock" data-clock="large"></p>
      <div class="widget live-wave" data-engine="${on ? engineOf(playback.speaker) : 'none'}"><span class="widget-head"><span class="eyebrow">Now Playing</span>${wave}</span>${on ? `<span class="who">${avatar(playback.speaker, engineOf(playback.speaker), 30)}${plate(playback.speaker)}</span>` : ''}<span class="widget-line" data-playing-message>${esc(playback.line?.translation || playback.message || '点击台词开始')}</span></div>
      <div class="lock-bottom"><button class="primary" data-system="unlock">点这里进入</button><button class="chip-button" data-system="unlock">跳过锁屏</button></div>`;
    clock();
  }

  async function appearance(phone) {
    preferences = phone;
    applyThemeMode();
    const dark = isDark();
    const key = JSON.stringify([phone.wallpaper, phone.icons, phone.iconStyle, dark]);
    if (key === appearanceKey) return;
    const ticket = ++appearanceEpoch;
    const photoIds = new Set([phone.wallpaper.kind === 'photo' ? phone.wallpaper.photoId : null, ...Object.values(phone.icons).filter(x => x?.kind === 'photo').map(x => x.photoId)].filter(Boolean));
    const records = await Promise.all([...photoIds].map(async id => [id, await api.getPhoto(id)]));
    if (disposed || ticket !== appearanceEpoch) return;
    for (const url of assets.values()) win.URL.revokeObjectURL(url);
    assets.clear();
    for (const [id, record] of records) if (record) assets.set(id, win.URL.createObjectURL(record.blob));
    const photo = phone.wallpaper.kind === 'photo' ? assets.get(phone.wallpaper.photoId) : null;
    const look = wallpaperLook(phone.wallpaper.key, dark);
    const vars = photo
      ? {'--wall': `linear-gradient(#0000001f,#0000001f),url("${photo}")`, '--wall-size': 'cover', '--wall-pos': 'center', '--wall-ink': '#fff', '--label-halo': '#000'}
      : {'--wall': look.background, '--wall-size': look.size || 'auto', '--wall-pos': look.pos || 'center', '--wall-ink': look.ink, '--clock-stroke': look.stroke, '--clock-shadow': look.shadow || look.stroke, '--label-halo': look.halo};
    for (const [name, value] of Object.entries(vars)) screen.style.setProperty(name, value);
    screen.dataset.clockStyle = photo ? 'shade' : look.clock;
    screen.dataset.iconStyle = phone.iconStyle;
    $('.wallpaper').innerHTML = photo || look.clock === 'glow' ? '' : [['12%', '20%', 14], ['84%', '14%', 22], ['72%', '28%', 10], ['20%', '58%', 12]].map(([x, y, s]) => spark('spark').replace('<svg', `<svg style="left:${x};top:${y};width:${s}px;height:${s}px"`)).join('');
    appearanceKey = key;
    renderHome();
  }

  // ---------- Playback ----------
  function animate() {
    win.cancelAnimationFrame(animation);
    for (const bar of mount.querySelectorAll('.wave i,.visualizer i')) bar.style.removeProperty('transform');
    for (const el of mount.querySelectorAll('.portrait')) el.style.removeProperty('--level');
    if (disposed || !panelVisible || doc.hidden || motion.matches || playback.phase !== 'playing' || !api.getState().general.waveformEnabled) return;
    let before = 0;
    const draw = time => {
      if (time - before > 32) {
        const levels = api.levels();
        const five = [...mount.querySelectorAll('.island-wave .wave i,.live-wave .wave i,[data-state=playing] .wave i')];
        five.forEach((bar, i) => bar.style.transform = 'scaleY(' + (.2 + .8 * (levels[i % 5] || 0)) + ')');
        for (const viz of mount.querySelectorAll('.visualizer')) {
          const bars = viz.children, n = bars.length;
          for (let i = 0; i < n; i++) {
            const envelope = .35 + .65 * Math.sin(Math.PI * (i + .5) / n);
            bars[i].style.transform = 'scaleY(' + (.08 + .92 * envelope * (levels[Math.floor(i * 5 / n)] || 0)) + ')';
          }
        }
        const average = levels.reduce((a, b) => a + b, 0) / (levels.length || 1);
        for (const el of mount.querySelectorAll('.portrait')) el.style.setProperty('--level', average.toFixed(3));
        before = time;
      }
      animation = win.requestAnimationFrame(draw);
    };
    animation = win.requestAnimationFrame(draw);
  }
  function paintPlayback(state) {
    playback = state;
    const on = ACTIVE_PHASES.includes(state.phase);
    const island = $('.island');
    island.toggleAttribute('data-active', on && !!state.speaker);
    island.dataset.engine = state.speaker ? engineOf(state.speaker) : 'none';
    $('.island-avatar').textContent = (state.speaker || '').slice(0, 1);
    $('.island-title').textContent = on ? (state.phase === 'waiting' ? '等待 ' + state.speaker : state.speaker || '听取') : '';
    $('.island-wave').hidden = !on || state.phase === 'waiting';
    island.setAttribute('aria-label', on ? '查看 ' + state.speaker + ' 的播放状态' : '打开听取');
    renderWidgets();
    for (const el of mount.querySelectorAll('[data-playing-speaker]')) el.textContent = state.speaker || '等待播放';
    for (const el of mount.querySelectorAll('[data-playing-message]')) el.textContent = state.line?.translation || state.message || '点击台词开始';
    for (const el of mount.querySelectorAll('[data-system=toggle]')) {
      el.innerHTML = icon(state.phase === 'playing' ? 'pause' : 'play', true);
      el.disabled = !['playing', 'paused', 'generating'].includes(state.phase);
    }
    for (const v of views.values()) v.onPlayback?.(state);
    animate();
  }

  // ---------- Control center ----------
  function control() {
    const s = api.getState(), p = preferences || {volume: api.getVolume(), theme: s.theme};
    const on = ACTIVE_PHASES.includes(playback.phase) && playback.speaker;
    const d = dialog('控制中心', `<div class="control-grid">
      <div class="control-tile wide live-wave" data-engine="${on ? engineOf(playback.speaker) : 'none'}">${on ? avatar(playback.speaker, engineOf(playback.speaker), 42) : wave}<div><strong data-playing-speaker></strong><small data-playing-message></small></div><button class="play-round" data-system="toggle" aria-label="暂停或继续">${icon('play', true)}</button></div>
      <div class="control-tile wide" style="flex-direction:column;align-items:stretch"><div class="meter-label"><span>播放音量</span><output>${Math.round(p.volume * 100)}%</output></div><input class="slider" data-control="volume" type="range" min="0" max="100" value="${Math.round(p.volume * 100)}" aria-label="播放音量"></div>
      <button class="control-tile" data-control="floating" aria-pressed="${s.general.floatingEnabled}"><span class="bubble">${icon('float')}</span>悬浮入口<small>${s.general.floatingEnabled ? '开' : '关'}</small></button>
      <button class="control-tile" data-system="power" aria-pressed="true"><span class="bubble">${icon('lock')}</span>锁屏<small>看一眼</small></button>
      <div class="control-tile wide" style="flex-direction:column;align-items:stretch"><span>主题</span><div class="segmented">${[['system', '跟随系统'], ['light', '日间'], ['dark', '夜间']].map(([key, label]) => `<button data-theme="${key}" aria-pressed="${p.theme === key}">${label}</button>`).join('')}</div></div>
      <button class="control-tile" data-control="stop" aria-pressed="true"><span class="bubble">${icon('stop', true)}</span>停止播放<small>清空当前队列</small></button>
      <button class="control-tile" data-app="listen" aria-pressed="true"><span class="bubble">${icon('wave')}</span>打开听取<small>整条播放与记录</small></button>
    </div>`, {top: true});
    d.body.addEventListener('input', e => { if (e.target.dataset.control === 'volume') d.body.querySelector('output').textContent = e.target.value + '%'; });
    d.body.addEventListener('change', e => { if (e.target.dataset.control === 'volume') run(() => api.setVolume(Number(e.target.value) / 100)); });
    d.body.addEventListener('click', e => {
      const el = e.target.closest('button');
      if (!el) return;
      run(async () => {
        if (el.dataset.theme) {
          await api.savePhone({theme: el.dataset.theme});
          if (d.live) for (const b of d.body.querySelectorAll('[data-theme]')) b.setAttribute('aria-pressed', String(b === el));
        }
        if (el.dataset.control === 'floating') {
          const enabled = !api.getState().general.floatingEnabled;
          api.updateGeneral({floatingEnabled: enabled});
          el.setAttribute('aria-pressed', String(enabled));
          el.querySelector('small').textContent = enabled ? '开' : '关';
        }
        if (el.dataset.control === 'stop') api.stop();
      });
    });
    paintPlayback(playback);
  }

  // ---------- Events ----------
  mount.addEventListener('click', event => {
    const b = event.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.app) { open(b.dataset.app); return; }
    if (b.dataset.openRole) { open('roles', b.dataset.openRole); return; }
    if (b.hasAttribute('data-slot')) { notify('这个位置留给以后的新 App'); return; }
    if (!b.dataset.system) return;
    run(() => {
      switch (b.dataset.system) {
        case 'close': api.close(); break;
        case 'home': showHome(); break;
        case 'back': back(); break;
        case 'power': locked ? unlock() : lock(); break;
        case 'unlock': unlock(); break;
        case 'island': {
          const pending = playback.phase === 'waiting' && api.pendingRole();
          if (pending) openPendingRole(pending); else open('listen');
          break;
        }
        case 'control': control(); break;
        case 'toggle': api.toggle(); break;
        case 'help': help('桌面左右滑动翻页，图标打开对应应用；底部横条或左上角返回键回到桌面。\n右上角的信号图标可以点开，也可以向下拉出控制中心。侧键可以看锁屏，锁屏随时可以跳过。\n\n信号与电量是装饰。语音只在点击台词、播放或试听时生成。'); break;
      }
    });
  }, {signal});
  $('.home-pages').addEventListener('scroll', e => {
    const i = Math.round(e.target.scrollLeft / (e.target.clientWidth || 1));
    mount.querySelectorAll('.dots i').forEach((dot, k) => dot.toggleAttribute('data-on', k === i));
  }, {signal, passive: true});
  let drag = null;
  mount.addEventListener('pointerdown', e => {
    const zone = e.target.closest('.status-icons,.lockscreen');
    if (!zone || drag || e.button !== 0) return;
    drag = {id: e.pointerId, y: e.clientY, x: e.clientX, lock: zone === lockscreen};
  }, {signal});
  mount.addEventListener('pointerup', e => {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag, dy = e.clientY - d.y;
    drag = null;
    if (Math.abs(e.clientX - d.x) > 70) return;
    if (d.lock && dy < -45) unlock();
    else if (!d.lock && dy > 45) control();
  }, {signal});
  mount.addEventListener('pointercancel', () => drag = null, {signal});
  doc.addEventListener('keydown', e => {
    doc.documentElement.dataset.keyboard = 'true';
    if (e.key === 'Escape') {
      e.preventDefault();
      if (sheet || locked || active) back(); else api.close();
    }
    if (locked && e.key === 'Tab') {
      const focusable = [...lockscreen.querySelectorAll('button')].filter(el => !el.disabled), first = focusable[0], last = focusable.at(-1);
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, {signal});
  doc.addEventListener('pointerdown', () => delete doc.documentElement.dataset.keyboard, {signal});
  doc.addEventListener('visibilitychange', animate, {signal});
  media.addEventListener('change', theme, {signal});
  motion.addEventListener('change', animate, {signal});

  const unsubscribe = api.subscribe(event => {
    if (disposed) return;
    if (event.type === 'playback') paintPlayback(event);
    if (event.type === 'settings') { theme(); renderWidgets(); animate(); }
    if (event.type === 'phone') run(() => appearance(event.preferences));
    if (event.type === 'library') {
      const key = ({favorites: 'library', cache: 'library', photos: 'gallery', notes: 'notes'})[event.collection];
      if (active === key) run(() => views.get(key)?.refresh());
    }
    if (event.type === 'audio-ready') views.get('listen')?.onPlayback?.(api.status());
    if (event.type === 'draw') views.get('draw')?.onDraw?.(event);
    if (event.type === 'chat') { run(() => views.get('chat')?.onChat?.(event)); countUnread(); }
    if (event.type === 'settings') run(() => views.get('chat')?.onChat?.({}));
  });

  // Unread chat messages, shown as a badge on the chat icon.
  function countUnread() {
    win.clearTimeout(unreadTimer);
    unreadTimer = win.setTimeout(() => run(async () => {
      const n = await api.chatUnread();
      if (disposed || n === unread) return;
      unread = n;
      renderHome();
    }), 120);
  }

  // ---------- Host hooks ----------
  const previousOpenRole = win.stTtsOpenRole, previousVisibility = win.stTtsPanelVisibility, previousOpenDraw = win.stTtsOpenDraw;
  win.stTtsOpenRole = id => open('roles', id);
  function takeDraw() {
    const request = api.takeDraw?.();
    if (!request) return false;
    open('draw');
    views.get('draw')?.load?.(request);
    return true;
  }
  win.stTtsOpenDraw = () => run(takeDraw);
  win.stTtsPanelVisibility = visible => {
    panelVisible = visible;
    if (!visible) sheet?.close(null);
    else if (takeDraw()) { /* opened from a chat picture */ }
    else if (preferences?.lockOnOpen && !api.pendingRole()) lock();
    animate();
  };
  function dispose() {
    if (disposed) return;
    disposed = true;
    appearanceEpoch++;
    unsubscribe();
    controller.abort();
    sheet?.close(null);
    for (const v of views.values()) v.dispose();
    for (const url of assets.values()) win.URL.revokeObjectURL(url);
    assets.clear();
    win.clearInterval(clockTimer);
    win.clearTimeout(toastTimer);
    win.clearTimeout(openTimer);
    win.clearTimeout(unreadTimer);
    win.cancelAnimationFrame(animation);
    win.stTtsOpenRole = previousOpenRole;
    win.stTtsPanelVisibility = previousVisibility;
    win.stTtsOpenDraw = previousOpenDraw;
  }
  win.addEventListener('pagehide', dispose, {signal});
  applyThemeMode();
  renderHome();
  const clockTimer = win.setInterval(clock, 15000);
  countUnread();
  paintPlayback(playback);

  const fallback = {wallpaper: {kind: 'builtin', key: 'sky'}, icons: {}, iconStyle: 'color', lockOnOpen: false, volume: api.getVolume(), theme: api.getState().theme};
  const ready = api.getPhone().then(async p => {
    if (disposed) return;
    preferences = p;
    theme();
    await appearance(p);
    if (disposed) return;
    const pending = api.pendingRole();
    if (pending) openPendingRole(pending);
    else if (takeDraw()) { /* opened from a chat picture */ }
    else if (p.lockOnOpen) lock();
  }).catch(error => {
    if (disposed) return;
    notify(error.message);
    return appearance(fallback);
  });
  return {ready, open, home: showHome, back, lock, unlock, dispose, views, get active() { return active; }, get locked() { return locked; }};
}

if (typeof window !== 'undefined' && window.document.getElementById('root')) {
  try { window.stTtsPhone = createPhoneApp({window, api: connectBackend()}); }
  catch (error) {
    const el = window.document.querySelector('.startup');
    if (el) { el.textContent = error.message; el.setAttribute('role', 'alert'); }
  }
}
