// The self-check report: facts gathered in the tavern page become sections of findings and a plain-text report that
// can be copied and sent to whoever is helping. Nothing here reads or prints keys.

const ENGINE_NAMES = {fish: 'Fish Audio', mini: 'MiniMax', eleven: 'ElevenLabs', nai: 'NovelAI'};
const MARKS = {ok: '✓', warn: '⚠', error: '✗', info: '·'};
const item = (level, label, detail = '') => ({level, label, detail: String(detail ?? '')});
const time = at => new Date(at).toLocaleString('zh-CN', {hour12: false});

/** facts → {sections: [{title, items: [{level, label, detail}]}], text, counts: {ok, warn, error, info}} */
export function buildReport(f) {
  const sections = [];
  const add = (title, items) => { if (items.length) sections.push({title, items}); };

  const copies = f.plugin?.copies || [];
  add('插件', [
    item('info', '版本', f.plugin?.version || '读不到'),
    copies.length > 1
      ? item('error', `装了 ${copies.length} 份插件`, `同时加载了：${copies.join('、')}。只留一份，把其余的文件夹删掉后刷新页面。`)
      : item('ok', '只装了一份')
  ]);

  add('酒馆', [
    item('info', '版本', f.tavern?.version || '读不到'),
    f.tavern?.mode === 'hook'
      ? item('ok', '显示方式', '消息格式钩子（1.19 及以上）')
      : item('ok', '显示方式', '兼容方式（1.13.2～1.18：酒馆画完回复后再画一次）'),
    ...(f.extensions?.length ? [item('info', '已加载的第三方插件', f.extensions.join('、'))] : [])
  ]);

  const b = f.browser || {};
  const storage = b.storage?.quota ? b.storage.usage / b.storage.quota : null;
  add('浏览器', [
    b.secure === false ? item('error', '不是 localhost 或 HTTPS 地址', '语音缓存、设置和密钥都用不了，请用 localhost 或 HTTPS 打开酒馆。') : item('ok', '安全地址'),
    b.audio === false ? item('error', '不支持网页音频', '请换用或更新浏览器。') : item('ok', '可以播放音频'),
    b.indexedDB === false ? item('error', '本地存储不可用', '可能开了无痕模式或禁用了网站数据，收藏、相册和缓存都存不下来。') : item('ok', '本地存储可用'),
    ...(storage === null ? [] : [item(storage > 0.9 ? 'warn' : 'info', '本地存储用量', `${mb(b.storage.usage)} / ${mb(b.storage.quota)}${storage > 0.9 ? '，快满了，可以清理语音缓存' : ''}`)]),
    ...(b.agent ? [item('info', '浏览器', b.agent)] : [])
  ]);

  const v = f.voice || {};
  const silent = (v.roles || []).filter(r => !r.voice).map(r => r.name);
  add('配音', [
    v.enabled === false ? item('warn', '正文语音已关闭', '设置 → 正文语音。关着的时候不会要求模型写语音标签，也不显示声波。') : item('ok', '正文语音已打开'),
    item('info', '当前预设', `${v.preset || '（没有）'} · 插入位置 ${v.injection || '未知'}`),
    item('info', '台词格式', v.format || '（没有）'),
    !(v.roles || []).length ? item('info', '还没有角色', '在正文里点一次声波，或者在「角色」里添加。')
      : silent.length ? item('warn', `${silent.length} 个角色还没选音色`, silent.join('、')) : item('ok', `${v.roles.length} 个角色都选好了音色`)
  ]);

  const keys = [];
  for (const [engine, k] of Object.entries(f.keys || {})) {
    const name = ENGINE_NAMES[engine] || engine;
    if (!k.set) { if (k.needed) keys.push(item('error', `${name} 没有密钥`, k.needed)); continue; }
    if (k.check === 'ok') keys.push(item('ok', `${name} 密钥可用`, k.detail));
    else if (k.check === 'error') keys.push(item('error', `${name} 密钥检查失败`, k.detail));
    else keys.push(item('info', `${name} 已填写密钥`, k.detail || '没有免费的检查方法，播放时才知道能不能用'));
  }
  add('密钥', keys.length ? keys : [item('info', '还没有填写任何密钥')]);

  const r = f.reply;
  if (!r) add('最近一条回复', [item('info', '当前聊天还没有角色回复')]);
  else {
    const items = [item('info', '消息', `#${r.id}${r.name ? ' · ' + r.name : ''}`)];
    if (r.streaming) items.push(item('info', '正在生成中', '生成结束后再查一次更准确。'));
    if (!r.tags && !r.lines) items.push(item(v.enabled === false ? 'info' : 'warn', '没有语音标签', '模型没有按格式写台词。可以重新生成，或者检查预设是不是插进去了。'));
    else items.push(item(r.lines ? 'ok' : 'warn', `认出 ${r.lines} 句台词`));
    for (const p of r.problems || []) items.push(item('warn', `${p.role || '未写角色'}：${p.reason}`, p.snippet));
    if (r.lines && v.enabled !== false) {
      if (!r.inChat) items.push(item('error', '在聊天区里找不到这条消息', '可能被美化主题或前端卡换了显示方式。'));
      else if (!r.waves) items.push(item('error', '认出了台词，但正文里没有画出声波',
        r.iframes ? `这条消息里有 ${r.iframes} 个内嵌页面（前端卡或酒馆助手的界面），声波可能被放进去了，里面的点击传不到插件。` : '刷新页面试试；还不行就把这份报告发出来。'));
      else items.push(item('ok', `正文里画出了 ${r.waves} 个声波`));
      if (r.stale) items.push(item('warn', `${r.stale} 个声波是刷新前画的`, '点一下会重新画好；经常出现的话，可能有插件缓存了旧的消息。'));
      if (r.covered) items.push(item('error', '声波被别的东西盖住了', `上次手机关着时看到，盖在上面的是 ${r.covered}，点击会落在它上面。多半是主题或别的插件的元素。`));
    }
    add('最近一条回复', items);
  }

  if (f.errors?.length) add('最近的提示', f.errors.slice(-10).map(e => item(e.kind === 'error' ? 'warn' : 'info', time(e.at), e.message)));

  const counts = {ok: 0, warn: 0, error: 0, info: 0};
  for (const s of sections) for (const i of s.items) counts[i.level]++;
  return {sections, counts, text: reportText(f, sections, counts)};
}

function mb(bytes) { return bytes >= 1024 ** 3 ? (bytes / 1024 ** 3).toFixed(1) + ' GB' : Math.round(bytes / 1024 ** 2) + ' MB'; }

function reportText(f, sections, counts) {
  const lines = [`ST-iPhonie 自检报告 · ${time(f.at || Date.now())}`, `问题 ${counts.error} · 提醒 ${counts.warn} · 正常 ${counts.ok}`, ''];
  for (const s of sections) {
    lines.push(`【${s.title}】`);
    for (const i of s.items) lines.push(`${MARKS[i.level]} ${i.label}${i.detail ? '：' + i.detail.replace(/\s*\n\s*/g, ' ') : ''}`);
    lines.push('');
  }
  lines.push('（报告里没有密钥。）');
  return lines.join('\n');
}
