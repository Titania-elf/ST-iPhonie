import {createView, esc, btn, field, input, select, textArea, toggle, heading, help, groupTitle, plate, empty} from './common.js';
import {icon, glyph} from './icons.js';
import {APPS} from './apps.js';

const positions = [['in_chat', '聊天内'], ['before_prompt', '主提示词之前'], ['in_prompt', '主提示词之后']];
const roles = [['system', '系统'], ['user', '用户'], ['assistant', '助手']];
// Preset kinds: voice (dialogue tags), chat (phone chat replies and bringing chats into the story), drawing (<img> tags in the chat text).
const KINDS = [['tts', '配音', 'listen'], ['chat', '聊天', 'chat'], ['draw', '绘图', 'draw']];

export function presetsApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'presets'), drafts = new Map();
  let current = null, currentKind = 'tts', kind = 'tts';
  const mark = () => { const el = v.root.querySelector('[data-save-state]'); if (el) el.textContent = '未保存'; };
  const tile = app => { const [t1, t2, tac] = APPS[app].colors; return `<span class="mini-tile" style="--t1:${t1};--t2:${t2};--tac:${tac}">${glyph(app)}</span>`; };
  // Operations differ only in which backend list they touch.
  const ops = k => k === 'draw'
    ? {list: () => api.getState().draw.presets, active: () => api.getState().draw.activePreset, save: p => api.saveDrawPreset(p), remove: id => api.deleteDrawPreset(id), use: id => api.saveDraw({activePreset: id}), preview: p => api.previewDrawPrompt(p), validate: () => ''}
    : k === 'chat'
    ? {list: () => api.getState().chat.presets, active: () => api.getState().chat.activePreset, save: p => api.saveChatPreset(p), remove: id => api.deleteChatPreset(id), use: id => api.selectChatPreset(id), preview: p => api.previewChatPrompt(p), validate: p => api.validateChatPreset(p)}
    : {list: () => api.getState().presets, active: () => api.getState().activePreset, save: p => api.savePreset(p), remove: id => api.deletePreset(id), use: id => api.selectPreset(id), preview: p => api.previewPrompt({...p, id: p.id || 'preview'}), validate: p => api.validatePreset(p)};

  function injection(i, index = 'preset') {
    const attrs = `data-injection-owner="${index}"`;
    const inChat = i.position === 'in_chat';
    return field('插入位置', select('position', i.position, positions, attrs))
      + field('深度', input('depth', i.depth, 'number', `${attrs} min="0" max="10000" step="1" ${inChat ? '' : 'disabled'}`))
      + field('身份', select('role', i.role, roles, `${attrs} ${inChat ? '' : 'disabled'}`));
  }

  function renderList() {
    const [, label, app] = KINDS.find(k => k[0] === kind);
    const tabs = `<div class="segmented">${KINDS.map(([k, l]) => `<button data-action="kind" data-kind="${k}" aria-pressed="${k === kind}">${l}</button>`).join('')}</div>`;
    let body;
    {
      const o = ops(kind), active = o.active();
      const draw = api.getState().draw;
      body = (kind === 'draw' ? `<div class="group">${toggle('drawEnabled', '正文出图', draw.enabled, '开启后，使用中的绘图预设会加进聊天请求，让模型在正文里写出图标签。')}</div>` : '')
        + o.list().map(p => `<button class="preset-card" data-action="edit-preset" data-kind="${kind}" data-id="${esc(p.id)}"${p.id === active ? ' data-active' : ''}>${tile(app)}<span><strong>${esc(p.name || '未命名预设')}</strong><small>${kind === 'chat' ? `读正文 ${p.context} 条 · 聊天记录 ${p.history} 条` : kind === 'draw' ? `每条回复 ${p.count} 张 · ${p.entries.length} 条规则` : `${p.entries.length} 条规则 · ${esc(positions.find(x => x[0] === p.injection.position)?.[1] || '')}`}</small></span>${p.id === active ? plate('使用中') : icon('next')}</button>`).join('')
        + `<p class="hint">${kind === 'draw'
          ? '绘图预设是给正文模型看的出图规则：什么时候出图、标签怎么写。画师串和固定 tag 在绘图 App 的“画风”里。'
          : kind === 'chat'
          ? '聊天预设决定手机里的联系人怎么回消息、能看到多少剧情，以及“带进剧情”时怎么写进下一次正文。手机聊天单独生成，不会写进正文。'
          : '配音预设让模型把台词写成带 TTS 标签的格式。角色配音不在预设里，切换预设不会改动角色。'}</p>`;
    }
    v.draw(heading('预设', btn('add-preset', icon('add'), 'round-button', `aria-label="新增${label}预设"`), 'Preset · 3 类') + tabs + body);
  }

  function renderEditor() {
    const p = current, o = ops(currentKind), draw = currentKind === 'draw', chat = currentKind === 'chat';
    const used = p.id && p.id === o.active();
    v.draw(heading(p.id ? '编辑预设' : '新预设', '', draw ? 'Drawing Preset' : chat ? 'Chat Preset' : 'Voice Preset')
      + `<div class="group pad">${field('名称', input('name', p.name))}${chat
        ? `${field('读取最近的正文', input('context', p.context, 'number', 'min="0" max="40" step="1"'), '回消息时参考最近几条正文，0 表示不看剧情。')}${field('读取聊天记录', input('history', p.history, 'number', 'min="2" max="200" step="1"'), '回消息时带上最近多少条手机聊天。')}${field('带进剧情的写法', textArea('bring', p.bring, 'class="code" rows="4"'), '选中的聊天消息会按这段文字注入下一次正文，只用一次。需要包含 {{聊天记录}}；也可以用 {{用户}}、{{对象}}。')}`
        : draw
        ? `${field('每条回复出图数量', input('count', p.count ?? 1, 'number', `min="1" max="${api.drawCountMax}" step="1"`), '模型每条回复固定写这么多个出图标签。规则里写 {{出图数量}} 会换成这个数字；插件还会在规则最后加一段硬性要求，让数量更稳定。张数越多，出图越久。')}<div class="field"><span>出图标签格式${help('规则里写 {{出图格式}} 会换成下面这段；{{角色列表}} 会换成角色 App 里的角色名。别的插件要排除出图内容时，排除标签填 <img></img>。')}</span><pre class="code-preview" style="margin:0">${esc(api.picTagFormat)}</pre></div>`
        : field('台词格式', textArea('format', p.format, 'class="code"'), '{译文}、{角色}、{情绪}、{文本} 各保留一次。译文供阅读，原语言供语音生成。默认格式是成对的 <tts></tts>，别的插件要排除语音原文时，排除标签填 <tts></tts>。')}</div>
        <details data-group="preset-injection"><summary>${chat ? '带进剧情的插入位置' : '默认插入设置'} ${help(chat ? '带进剧情的文字插在正文请求的哪里。深度与身份仅在聊天内插入时生效。' : '深度与身份仅在聊天内插入时生效；条目可以单独覆盖。')}</summary><div>${injection(p.injection)}</div></details>
        ${groupTitle(draw ? '出图规则' : chat ? '聊天规则' : '提示词条目', btn('add-entry', icon('add') + '条目', 'chip-button'))}
        ${p.entries.map((e, i) => `<details data-group="entry:${esc(e.id)}" ${i === 0 ? 'open' : ''}><summary>${esc(e.title || '未命名条目')}${e.enabled ? '' : ' · 已停用'}</summary><div data-entry="${i}">
          ${toggle('enabled', '启用此条目', e.enabled)}
          ${field('条目名称', input('title', e.title))}
          ${field(draw ? '规则' : chat ? '规则' : '提示词', textArea('text', e.text, 'class="code"'), draw ? '需要包含 {{出图格式}}，让模型知道标签怎么写。可以用 {{出图数量}}、{{角色列表}}。' : chat ? '可以用 {{用户}}、{{对象}}；写语音消息规则时用 {{语音格式}}、{{可发语音}}。' : '启用规则的合计文字需包含 {{格式}} 和 {{语言}}。')}
          ${chat ? '' : toggle('customInjection', '单独设置插入位置', !!e.injection)}${!chat && e.injection ? injection(e.injection, i) : ''}
          <div class="entry-tools">${btn('entry-up', icon('up') + '上移', 'text-button', `data-index="${i}" ${i === 0 ? 'disabled' : ''}`)}${btn('entry-down', icon('down') + '下移', 'text-button', `data-index="${i}" ${i === p.entries.length - 1 ? 'disabled' : ''}`)}${btn('delete-entry', icon('trash') + '删除', 'text-button', `data-index="${i}"`)}</div>
        </div></details>`).join('')}
        <div class="actions">${btn('prompt-preview', icon('eye') + '发送预览', 'secondary')}${p.id ? btn('use-preset', used ? '正在使用' : '保存并使用', 'secondary', used ? 'disabled' : '') : ''}</div>
        <div class="savebar"><span class="save-state" data-save-state>草稿</span>${btn('save-preset', '保存预设', 'primary')}</div>
        ${p.id ? `<div class="actions">${btn('delete-preset', '删除预设', 'danger')}</div>` : ''}`);
  }

  const render = () => current ? renderEditor() : renderList();
  function edit(k, id) {
    const key = k + ':' + id;
    current = drafts.get(key) || structuredClone(ops(k).list().find(p => p.id === id));
    if (!current) return;
    currentKind = k;
    drafts.set(key, current);
    render();
  }
  v.showKind = k => { current = null; kind = k; render(); };
  v.back = () => { if (!current) return false; current = null; render(); return true; };
  v.refresh = () => { if (!current) render(); };

  function update(el, redraw) {
    const key = el.dataset.field, index = el.closest('[data-entry]')?.dataset.entry;
    if (el.dataset.injectionOwner !== undefined) {
      const owner = el.dataset.injectionOwner === 'preset' ? current : current.entries[Number(el.dataset.injectionOwner)];
      owner.injection[key] = key === 'depth' ? Number(el.value) : el.value;
    } else if (index !== undefined) {
      const entry = current.entries[Number(index)];
      if (key === 'customInjection') { if (el.checked) entry.injection = structuredClone(current.injection); else delete entry.injection; }
      else entry[key] = el.type === 'checkbox' ? el.checked : el.value;
    } else current[key] = el.value;
    mark();
    if (redraw) render();
  }
  v.on('input', '[data-field]', el => { if (current && el.type !== 'checkbox' && el.tagName !== 'SELECT') update(el, false); });
  v.on('change', '[data-field]', el => {
    if (el.dataset.field === 'drawEnabled') { api.saveDraw({enabled: el.checked}); ctx.notify(el.checked ? '已开启正文出图' : '已关闭正文出图'); return; }
    if (current && (el.type === 'checkbox' || el.tagName === 'SELECT')) update(el, true);
  });
  function save() {
    const key = currentKind + ':' + (current.id || 'new');
    current = ops(currentKind).save(current);
    drafts.delete(key);
    drafts.set(currentKind + ':' + current.id, current);
    render();
    v.root.querySelector('[data-save-state]').textContent = '已保存';
    ctx.notify('预设已保存');
  }
  v.on('click', '[data-action]', async el => {
    const index = Number(el.dataset.index);
    switch (el.dataset.action) {
      case 'kind': kind = el.dataset.kind; render(); break;
      case 'add-preset':
        currentKind = kind;
        current = drafts.get(kind + ':new') || (kind === 'chat'
          ? {...structuredClone(api.defaultChatPreset), name: '新聊天预设', entries: api.defaultChatPreset.entries.map(e => ({...e, id: crypto.randomUUID()}))}
          : kind === 'draw'
          ? {name: '新出图规则', count: 1, injection: {position: 'in_chat', depth: 1, role: 'system'}, entries: [{id: crypto.randomUUID(), title: '出图规则', text: api.defaultDrawRule, enabled: true}]}
          : {name: '新预设', format: api.defaultFormat, injection: {position: 'in_chat', depth: 0, role: 'system'}, entries: [{id: crypto.randomUUID(), title: '台词生成规则', text: api.defaultPrompt, enabled: true}]});
        drafts.set(kind + ':new', current);
        render();
        break;
      case 'edit-preset': edit(el.dataset.kind || 'tts', el.dataset.id); break;
      case 'save-preset': save(); break;
      case 'use-preset': save(); ops(currentKind).use(current.id); render(); break;
      case 'add-entry':
        current.entries.push({id: crypto.randomUUID(), title: '新条目', enabled: true, text: ''});
        render();
        v.root.querySelector('details:last-of-type').open = true;
        mark();
        break;
      case 'delete-entry': if (await ctx.confirm('删除这条规则？', '保存预设后生效。')) { current.entries.splice(index, 1); render(); mark(); } break;
      case 'entry-up':
      case 'entry-down': {
        const to = index + (el.dataset.action === 'entry-up' ? -1 : 1);
        if (to >= 0 && to < current.entries.length) { [current.entries[index], current.entries[to]] = [current.entries[to], current.entries[index]]; render(); mark(); }
        break;
      }
      case 'delete-preset':
        if (await ctx.confirm('删除这个预设？', '角色配音和画风不会被删除。')) { ops(currentKind).remove(current.id); drafts.delete(currentKind + ':' + current.id); current = null; render(); }
        break;
      case 'prompt-preview': {
        const o = ops(currentKind), error = o.validate(current);
        if (error) throw Error(error);
        ctx.dialog('发送预览', `<pre class="code-preview">${esc(o.preview(current))}</pre>`);
        break;
      }
    }
  });
  render();
  return v;
}
