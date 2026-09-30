import {createView, esc, btn, field, select, toggle, heading, size, languageField, languageOptions, groupTitle} from './common.js';
import {buildReport} from '../core/diagnostics.js';
import {saveFile} from '../download.js';
import {icon, GLYPH_NAMES} from './icons.js';
import {APPS} from './apps.js';
import {wallpapers, skins} from './wallpapers.js';

const MARKS = {ok: '✓', warn: '!', error: '✕', info: '·'};
const IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/avif,image/gif';

export function settingsApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'settings');
  let appearance = null, check = null, epoch = 0;
  const glyphName = key => APPS[key]?.name || GLYPH_NAMES[key] || key;

  // The self-check page: what core/diagnostics.js found, grouped, with the plain report to copy, save or send.
  function renderCheck() {
    const intro = '<p class="hint">自检会看插件、酒馆、浏览器、密钥和最近一条回复有没有问题。出问题时可以把报告复制给帮你的人，报告里没有密钥。</p>';
    if (check.loading) { v.draw(heading('自检', '', 'Self-check') + '<div class="group pad"><p class="help-copy">正在检查……</p></div>' + intro); return; }
    const {sections, counts, text} = check.report, level = counts.error ? 'error' : counts.warn ? 'warn' : 'ok';
    v.draw(heading('自检', '', 'Self-check')
      + `<div class="check-summary" data-level="${level}"><strong>${counts.error ? `发现 ${counts.error} 个问题` : counts.warn ? `有 ${counts.warn} 条提醒` : '一切正常'}</strong><small>问题 ${counts.error} · 提醒 ${counts.warn} · 正常 ${counts.ok}</small></div>`
      + sections.map(s => groupTitle(s.title) + `<div class="group pad">${s.items.map(i => `<div class="check-row" data-level="${i.level}"><span class="check-mark" aria-hidden="true">${MARKS[i.level]}</span><div><strong>${esc(i.label)}</strong>${i.detail ? `<small>${esc(i.detail)}</small>` : ''}</div></div>`).join('')}</div>`).join('')
      + `<div class="actions">${btn('copy-report', icon('copy') + '复制报告', 'primary')}${btn('save-report', icon('download') + '下载报告', 'secondary')}</div>`
      + `<div class="actions">${btn('run-check', icon('refresh') + '再查一次', 'secondary')}</div>`
      + `<details class="report-text"><summary>报告原文（复制不了时长按这里手动复制）</summary><textarea readonly rows="12" aria-label="报告原文">${esc(text)}</textarea></details>` + intro);
  }
  async function runCheck() {
    check = {loading: true};
    await render();
    try { const facts = await api.diagnose(); if (check) check = {report: buildReport(facts)}; }
    catch (error) { check = null; await render(); throw error; }
    await render();
  }

  function renderAppearance() {
    const d = appearance;
    v.draw(heading('壁纸与图标', '', 'Appearance')
      + groupTitle('壁纸')
      + `<div class="group pad"><div class="wallpaper-options">${Object.entries(wallpapers).map(([key, w]) => `<button class="wallpaper-choice" data-action="wallpaper" data-key="${key}" aria-pressed="${d.wallpaper.kind === 'builtin' && d.wallpaper.key === key}"><span style="--p:${w.background};--ps:${w.size || 'auto'};--pp:${w.pos || 'center'}"></span>${w.name}</button>`).join('')}</div>
        <label class="secondary file-button">${icon('image')}选择本地图片作壁纸<input type="file" data-personal-file="wallpaper" aria-label="选择本地壁纸" accept="${IMAGE_TYPES}"></label>
        ${d.wallpaper.kind === 'photo' ? `<p class="hint">现在用的是自己的照片。点上面任意一张内置壁纸再点“应用”就能换回来；内置壁纸会跟着日夜自动变。</p><div class="actions">${btn('photo-off', '换回主题壁纸', 'secondary')}${btn('photo-delete', icon('trash') + '删除这张照片', 'danger')}</div>` : ''}
        ${field('图标外观', select('iconStyle', d.iconStyle, [['color', '彩色'], ['glass', '玻璃'], ['mono', '单色']]))}</div>`
      + groupTitle('应用图标')
      + `<div class="group">${Object.entries(APPS).map(([app, meta]) => `<div class="icon-settings-row"><strong>${meta.name}</strong>${select('glyph', d.icons[app]?.kind === 'glyph' ? d.icons[app].key : 'default', api.phoneCatalog.glyphs.map(key => [key, glyphName(key)]), `data-icon-app="${app}"`).replace('aria-label="glyph"', `aria-label="${meta.name}图标"`)}<label class="chip-button file-button">${d.icons[app]?.kind === 'photo' ? '换图' : '用图片'}<input type="file" data-personal-file="icon" data-app="${app}" aria-label="${meta.name}图标图片" accept="${IMAGE_TYPES}"></label></div>`).join('')}</div>`
      + `<div class="savebar">${btn('cancel-appearance', '取消', 'secondary')}${btn('save-appearance', '应用', 'primary')}</div>`);
  }

  async function render() {
    const ticket = ++epoch;
    if (appearance) { renderAppearance(); return; }
    if (check) { renderCheck(); return; }
    const [phone, cache, library, drawn] = await Promise.all([api.getPhone(), api.cacheStats(), api.libraryStats().catch(() => null), api.generatedPhotos().catch(() => null)]);
    const chatPictures = api.chatPictureStats?.() || null;
    if (v.disposed || ticket !== epoch) return;
    const s = api.getState();
    const wallName = phone.wallpaper.kind === 'builtin' ? wallpapers[phone.wallpaper.key]?.name : '自定义照片';
    v.draw(heading('设置', '', 'Settings')
      + groupTitle('外观')
      + `<div class="group pad">
          <div class="field"><span>主题风格</span><div class="skin-options">${Object.entries(skins).map(([key, s]) => `<button class="skin-choice" data-action="skin" data-value="${key}" aria-pressed="${(phone.skin || 'sky') === key}"><span style="background:${s.preview[0]}"><b style="background:${s.preview[3]}"></b><i style="background:${s.preview[1]}"></i><i style="background:${s.preview[2]}"></i></span>${s.name}</button>`).join('')}</div></div>
          <div class="field"><span>日夜</span><div class="segmented" style="margin:0">${[['system', '跟随系统'], ['light', '日间'], ['dark', '夜间']].map(([key, label]) => `<button data-action="theme" data-value="${key}" aria-pressed="${phone.theme === key}">${label}</button>`).join('')}</div></div>
          <button class="list-row" data-action="appearance"><span><strong>壁纸与图标</strong><small>${wallName} · ${({color: '彩色', glass: '玻璃', mono: '单色'})[phone.iconStyle]}图标</small></span>${icon('next')}</button>
          ${phone.wallpaper.kind === 'photo' ? `<div class="setting-row"><span>现在用的是自己的照片当壁纸</span>${btn('builtin-wallpaper', '换回主题壁纸', 'chip-button')}</div>` : ''}
        </div>`
      + groupTitle('配音')
      + `<div class="group pad">${languageField('defaultLanguage', s.general.defaultLanguage, false)}${languageOptions()}
          ${toggle('voiceEnabled', '正文语音', s.general.voiceEnabled !== false, '关掉后，聊天请求里不再加入语音规则，模型只写普通对白；正文里已有的语音标签只显示中文译文，不显示声波；手机聊天里的联系人也只发文字。打开后恢复。')}
          ${toggle('floatingEnabled', '悬浮入口', s.general.floatingEnabled, '在酒馆里显示可以拖动的小球，点开再点一次进入手机。')}
          ${toggle('waveformEnabled', '声波动效', s.general.waveformEnabled, '台词旁和手机里的声波随真实音频跳动。系统开启减少动态效果时保持静止。\n\n正文声波的颜色跟随酒馆主题：\n· 虚线小点：这个角色还没配音（斜体色）\n· 淡色：还没生成（正文色）\n· 引号色：已生成，可以播放\n· 引号色加底色：正在播放\n· 下划线色：已经播放过')}
          <div class="field"><div class="meter-label"><span>播放音量</span><output>${Math.round(phone.volume * 100)}%</output></div><input class="slider" type="range" data-field="volume" min="0" max="100" value="${Math.round(phone.volume * 100)}" aria-label="播放音量"></div>
        </div>`
      + groupTitle('绘图')
      + `<div class="group">${toggle('drawEnabled', '正文出图', s.draw.enabled, '开启后，绘图预设会加进聊天请求，让模型在正文里写出图标签。')}${toggle('drawAuto', '新回复自动出图', s.draw.auto, '只在免费档内自动画；超出免费档或读不到订阅时，正文里显示“点击生成”。')}${toggle('drawFold', '正文图片默认收起', s.draw.fold, '正文里只留一个小缩略图，点开再看。每张图也能单独收起或展开。')}${toggle('drawGuard', '免费档守卫', s.draw.guard, '步数不超过 28、尺寸不超过 1024×1024，不会发出扣 Anlas 的请求。')}</div>`
      + groupTitle('手机')
      + `<div class="group">${toggle('lockOnOpen', '打开时显示锁屏', phone.lockOnOpen, '锁屏可随时跳过，是插件内的外观，不是手机安全锁。')}<button class="list-row" data-action="lock"><span><strong>看一眼锁屏</strong></span>${icon('lock')}</button></div>`
      + groupTitle('存储')
      + `<div class="group">${toggle('cacheEnabled', '保存语音缓存', s.general.cacheEnabled, '已生成的音频用于重播。清缓存不会删除收藏、相册、备忘录或参考音频。')}
          <div class="setting-row"><span>语音缓存</span><small>${cache.available ? cache.count + ' 段 · ' + size(cache.bytes) : '本地缓存不可用'}</small></div>
          <div class="setting-row"><span>本地资料</span><small>${library ? size(library.bytes) + ' / ' + size(library.limit) : '无法读取'}</small></div>
          <div class="setting-row"><span>相册里的绘图</span><small>${drawn ? drawn.count + ' 张 · ' + size(drawn.bytes) : '无法读取'}</small></div>
          ${chatPictures ? `<div class="setting-row"><span>当前聊天的正文图片</span><small>${chatPictures.count} 张 · 存在酒馆</small></div>` : ''}</div>
        <div class="actions">${btn('clear-cache', icon('trash') + '清理语音缓存', 'danger')}</div>
        <div class="actions">${btn('clear-drawn', icon('trash') + '清除相册里的绘图', 'danger', drawn?.count ? '' : 'disabled')}${chatPictures ? btn('clear-chat-pictures', icon('trash') + '清除正文图片', 'danger', chatPictures.count ? '' : 'disabled') : ''}</div>
        ${groupTitle('帮助')}<div class="group"><button class="list-row" data-action="self-check"><span><strong>自检</strong><small>出问题时看看是哪里不对，可以把报告发给帮你的人</small></span>${icon('next')}</button></div>
        <div class="actions">${btn('about', '关于 ST-iPhonie', 'text-button')}</div>`);
  }

  v.back = () => { if (!appearance && !check) return false; appearance = check = null; render().catch(e => ctx.notify(e.message)); return true; };
  v.refresh = () => { if (!appearance) return render(); };
  v.on('input', '[data-field=volume]', el => { el.previousElementSibling.querySelector('output').textContent = el.value + '%'; });
  v.on('change', '[data-field]', async el => {
    const key = el.dataset.field;
    if (appearance) {
      if (key === 'iconStyle') appearance.iconStyle = el.value;
      if (key === 'glyph') appearance.icons[el.dataset.iconApp] = el.value === 'default' ? null : {kind: 'glyph', key: el.value};
      return;
    }
    if (['voiceEnabled', 'floatingEnabled', 'waveformEnabled', 'cacheEnabled'].includes(key)) api.updateGeneral({[key]: el.checked});
    else if (key === 'drawEnabled') api.saveDraw({enabled: el.checked});
    else if (key === 'drawAuto') api.saveDraw({auto: el.checked});
    else if (key === 'drawGuard') api.saveDraw({guard: el.checked});
    else if (key === 'drawFold') api.saveDraw({fold: el.checked});
    else if (key === 'defaultLanguage') api.updateGeneral({defaultLanguage: el.value});
    else if (key === 'volume') await api.setVolume(Number(el.value) / 100);
    else if (key === 'lockOnOpen') await api.savePhone({lockOnOpen: el.checked});
  });
  v.on('change', '[data-personal-file]', async el => {
    const file = el.files?.[0], target = appearance;
    if (!file || !target) return;
    el.disabled = true;
    try {
      const photo = await api.addPhoto({name: file.name, blob: file});
      if (appearance !== target) return;
      if (el.dataset.personalFile === 'wallpaper') target.wallpaper = {kind: 'photo', photoId: photo.id};
      else target.icons[el.dataset.app] = {kind: 'photo', photoId: photo.id};
      await render();
    } finally { if (el.isConnected) { el.disabled = false; el.value = ''; } }
  });
  v.on('click', '[data-action]', async el => {
    switch (el.dataset.action) {
      case 'theme': await api.savePhone({theme: el.dataset.value}); await render(); break;
      // A skin brings its own wallpaper, unless a personal photo is the wallpaper.
      case 'skin': { const p = await api.getPhone(); await api.savePhone({skin: el.dataset.value, ...(p.wallpaper.kind === 'builtin' ? {wallpaper: {kind: 'builtin', key: el.dataset.value}} : {})}); await render(); break; }
      case 'appearance': { const p = await api.getPhone(); appearance = {wallpaper: p.wallpaper, icons: p.icons, iconStyle: p.iconStyle}; await render(); break; }
      case 'wallpaper': appearance.wallpaper = {kind: 'builtin', key: el.dataset.key}; await render(); break;
      // Stop using a photo: back to the skin's own wallpaper, which follows day and night.
      case 'builtin-wallpaper': { const p = await api.getPhone(); await api.savePhone({wallpaper: {kind: 'builtin', key: p.skin || 'sky'}}); await render(); ctx.notify('已换回主题壁纸'); break; }
      case 'photo-off': { const p = await api.getPhone(); appearance.wallpaper = {kind: 'builtin', key: p.skin || 'sky'}; await api.savePhone({wallpaper: appearance.wallpaper}); await render(); ctx.notify('已换回主题壁纸'); break; }
      case 'photo-delete': {
        if (!await ctx.confirm('删除这张照片？', '照片会从相册删除，壁纸换回主题壁纸。')) break;
        await api.deletePhoto(appearance.wallpaper.photoId);
        const p = await api.getPhone();
        if (p.wallpaper.kind !== 'builtin' || p.wallpaper.key !== (p.skin || 'sky')) await api.savePhone({wallpaper: {kind: 'builtin', key: p.skin || 'sky'}});
        const now = await api.getPhone();
        appearance = {wallpaper: now.wallpaper, icons: now.icons, iconStyle: now.iconStyle};
        await render();
        ctx.notify('照片已删除');
        break;
      }
      case 'cancel-appearance': appearance = null; await render(); break;
      case 'save-appearance': await v.busy(el, async () => { await api.savePhone(appearance); appearance = null; await render(); ctx.notify('外观已应用'); }); break;
      case 'lock': ctx.lock(); break;
      case 'self-check': case 'run-check': await runCheck(); break;
      case 'copy-report': {
        const text = check?.report?.text || '';
        try { await ctx.win.navigator.clipboard.writeText(text); ctx.notify('已复制报告'); }
        catch { const box = v.root.querySelector('.report-text'); if (box) { box.open = true; box.querySelector('textarea')?.select(); } ctx.notify('没能自动复制，请在下面的报告原文里手动复制'); }
        break;
      }
      case 'save-report': {
        const text = check?.report?.text || '', stamp = new Date().toLocaleString('zh-CN', {hour12: false}).replace(/[/:]/g, '-');
        await v.busy(el, async () => ctx.notify('已下载 ' + await saveFile(ctx.doc, new Blob([text], {type: 'text/plain;charset=utf-8'}), `ST-iPhonie 自检 ${stamp}`)));
        break;
      }
      case 'clear-drawn':
        if (await ctx.confirm('清除相册里的绘图？', '绘图 App 和正文出图存进相册的图片会被删除，自己导入的照片保留。正文里的图片不受影响。')) { const n = await v.busy(el, () => api.deleteGeneratedPhotos()); await render(); ctx.notify(`已清除 ${n} 张`); }
        break;
      case 'clear-chat-pictures':
        if (await ctx.confirm('清除当前聊天的正文图片？', '图片文件会从酒馆删除，出图标签还在，之后可以点“点击生成”重新画。相册里的副本不受影响。')) { const r = await v.busy(el, () => api.clearChatPictures()); await render(); ctx.notify(`已清除 ${r.count} 张` + (r.failed ? `，${r.failed} 张没删掉` : '')); }
        break;
      case 'clear-cache':
        if (await ctx.confirm('清理语音缓存？', '正在播放的音频会停止，收藏和其他资料会保留。')) { await v.busy(el, () => api.clearCache()); await render(); ctx.notify('语音缓存已清理'); }
        break;
      case 'about': ctx.help('ST-iPhonie\n酒馆里的小手机：聊天、角色配音、听取、NovelAI 绘图、收藏、相册和备忘录。\n\n密钥和本地资料保存在当前浏览器与酒馆地址。状态栏的信号和电量是装饰。语音只在你点击播放或试听后生成。'); break;
    }
  });
  render().catch(e => ctx.notify(e.message));
  return v;
}
