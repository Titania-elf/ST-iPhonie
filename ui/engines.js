import {createView, esc, engines, btn, field, input, select, toggle, heading, help, groupTitle} from './common.js';

const TIERS = {0: '未订阅', 1: 'Tablet', 2: 'Scroll', 3: 'Opus'};
import {icon, spark} from './icons.js';

export function enginesApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'engines'), drafts = new Map();
  let engine = null, dirty = false, subscription = null, subscriptionError = '';
  // Voice balances shown on the ElevenLabs and Fish cards: engine -> {value, error, loading}.
  const balances = new Map(), PRICED = ['eleven', 'fish'];
  const number = n => Number(n).toLocaleString('zh-CN');
  const balanceText = id => {
    const b = balances.get(id)?.value;
    if (!b) return '—';
    return b.kind === 'characters' ? number(b.left) : '$' + b.credit.toFixed(2);
  };
  async function loadBalance(id, refresh = false) {
    if (!PRICED.includes(id) || !api.keyStatus(id)) return;
    const entry = balances.get(id) || {};
    balances.set(id, {...entry, loading: true});
    try { balances.set(id, {value: await api.voiceBalance(id, refresh), error: '', loading: false}); }
    catch (error) { balances.set(id, {value: entry.value || null, error: error.message, loading: false}); }
    if (!v.disposed && (engine === null || engine === id)) render();
  }
  const draft = () => drafts.get(engine);
  const changed = () => { dirty = true; const e = v.root.querySelector('[data-save-state]'); if (e) e.textContent = '未保存'; };

  function card(id, tag = 'button') {
    const saved = api.keyStatus(id), nai = id === 'nai';
    const name = nai ? 'NovelAI' : engines[id];
    const fields = nai
      ? [['TIER', subscription ? TIERS[subscription.tier] || '未知' : '—'], ['ANLAS', subscription ? String(subscription.anlas) : '—']]
      : PRICED.includes(id) && saved
        ? [['MODEL', api.getState().connections[id].model], [id === 'eleven' ? 'CREDITS' : 'BALANCE', balanceText(id)]]
        : [['MODEL', api.getState().connections[id].model], ['ROLES', api.getState().routes.filter(r => r.engine === id && r.voice).length + ' 个角色']];
    const attrs = tag === 'button' ? `data-action="engine" data-engine="${id}" aria-label="${name}"` : `data-engine="${id}"`;
    return `<${tag} class="bank-card${tag === 'div' ? ' detail-card' : ''}" ${attrs}>${spark()}
      <span class="card-top"><span class="card-name">${name}</span><span class="card-kind">${nai ? 'IMAGE' : 'VOICE'}${icon('nfc')}</span></span>
      <span class="card-chip"></span>
      <span class="card-number${saved ? '' : ' none'}">${saved ? '•••• •••• •••• ••••' : '未绑定密钥 · 点卡片去填写'}</span>
      <span class="card-bottom">${fields.map(([k, value]) => `<span><span class="k">${k}</span><span class="v">${esc(value)}</span></span>`).join('')}<span class="card-brand">ST-iPhonie</span></span></${tag}>`;
  }

  async function loadSubscription(refresh) {
    subscriptionError = '';
    try { subscription = await api.naiSubscription(refresh); }
    catch (error) { subscription = null; subscriptionError = error.message; }
    if (!v.disposed) render();
  }

  function renderNovelAI() {
    const saved = api.keyStatus('nai'), d = api.getState().draw;
    v.root.dataset.engine = 'nai';
    v.draw(heading('NovelAI', '', 'Image Card')
      + card('nai', 'div')
      + groupTitle('连接')
      + `<div class="group pad">
          <div class="setting-row"><span>密钥</span><span class="key-state ${saved ? 'ok' : 'no'}">${saved ? '已保存在这台浏览器' : '还没有填写'}</span></div>
          ${field('Persistent API Token', input('key', '', 'password', `autocomplete="off" placeholder="${saved ? '已保存，填写新的可替换' : '在 NovelAI 账户设置里获取，以 pst- 开头'}"`), '插件直接连接 NovelAI，不经过酒馆。密钥只保存在当前浏览器和酒馆地址。')}
          <div class="key-actions">${btn('save-key', icon('key') + '保存密钥', 'primary')}${btn('reveal-key', '显示', 'secondary')}${btn('clear-key', '清除', 'danger')}</div>
        </div>`
      + groupTitle('订阅', btn('refresh-subscription', icon('refresh') + '刷新', 'chip-button', saved ? '' : 'disabled'))
      + `<div class="group">
          <div class="setting-row"><span>档位</span><small>${subscription ? TIERS[subscription.tier] || '未知' : saved ? (subscriptionError ? '读取失败' : '读取中') : '—'}</small></div>
          <div class="setting-row"><span>Anlas 余额</span><strong>${subscription ? subscription.anlas : '—'}</strong></div>
          <div class="setting-row"><span>免费小图</span><small>${subscription ? (subscription.unlimited ? 'V4.5 及更早：无限（28 步、1024×1024 以内）' : subscription.active ? '仅 Opus 可用：每张图都会扣 Anlas' : '订阅未生效：每张图都会扣 Anlas') : '—'}</small></div>
          ${subscription?.unlimited ? `<div class="setting-row"><span>V5 免费额度</span><small>${subscription.usage ? (subscription.usage.negative || subscription.usage.percent < 2 ? `${subscription.usage.percent}% · 已用完，会扣 Anlas` : `还剩 ${subscription.usage.percent}%，会慢慢恢复`) : '未读到'}</small></div>` : ''}
        </div>${subscriptionError ? `<p class="error-copy hint">${esc(subscriptionError)}</p>` : ''}`
      + `<div class="group">${toggle('guard', '免费档守卫', d.guard, '开启时绘图参数不会超出免费档，不会发出扣 Anlas 的请求。')}</div>
        <div class="actions">${btn('open-draw', icon('paint') + '打开绘图', 'primary')}</div>`);
  }

  function control(f, c, rowIndex = null, parent = null) {
    const value = rowIndex === null ? c.params[f.key] : c.params[parent.key][rowIndex][f.key];
    const reason = parent?.unavailable || f.unavailable || '';
    const attrs = `data-param="${esc(parent?.key || f.key)}" ${rowIndex !== null ? `data-row="${rowIndex}" data-column="${esc(f.key)}"` : ''} aria-label="${esc(f.label)}" ${reason ? 'disabled' : ''}`;
    const note = [f.help, reason, '官方字段：' + (parent ? parent.key + '.' : '') + f.key].filter(Boolean).join('\n');
    if (f.type === 'rows') {
      return `<div class="parameter-field" aria-disabled="${!!reason}"><div class="row-heading"><span>${esc(f.label)}${help(note)}</span>${btn('add-row', icon('add') + '增加', 'chip-button', `data-param-key="${esc(f.key)}" ${reason || value.length >= f.max ? 'disabled' : ''}`)}</div>${value.map((row, i) => `<div class="parameter-row">${f.columns.map(col => control(col, c, i, f)).join('')}${btn('remove-row', '删除这一条', 'text-button', `data-param-key="${esc(f.key)}" data-index="${i}" ${reason ? 'disabled' : ''}`)}</div>`).join('')}</div>`;
    }
    if (f.type === 'boolean') return `<div class="setting-row"><span>${esc(f.label)}${help(note)}</span><input type="checkbox" class="switch" ${attrs} ${value ? 'checked' : ''}></div>`;
    let html;
    if (f.type === 'select') html = `<span class="select"><select ${attrs}>${f.options.map(([option, label]) => `<option value="${esc(option)}" ${value === option ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></span>`;
    else if (f.type === 'file') html = `<input type="file" accept="audio/*,.wav,.mp3,.flac,.m4a,.ogg,.opus" ${attrs}>${value ? '<small>已选参考音频</small>' : ''}`;
    else if (['textarea', 'lines'].includes(f.type)) html = `<textarea rows="4" ${attrs}>${esc(value)}</textarea>`;
    else html = `<input type="${f.type === 'number' ? 'number' : 'text'}" ${attrs} value="${esc(value)}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.step !== undefined ? `step="${f.step}"` : ''}>`;
    return field(f.label, html, note);
  }

  function renderList() {
    delete v.root.dataset.engine;
    v.draw(heading('引擎', help('每个服务一张卡：三家语音引擎，加上绘图用的 NovelAI。点卡片查看连接和全部参数。\n卡片只显示密钥是否保存，不显示内容；“已保存”不代表鉴权成功。'), 'Wallet · 04')
      + `<div class="wallet">${[...Object.keys(engines), 'nai'].map(id => card(id)).join('')}</div><p class="hint">点一张卡片，查看连接、模型和参数。ElevenLabs 和 Fish 的卡片上显示剩余额度。</p>`);
    for (const id of PRICED) if (!balances.has(id)) loadBalance(id);
  }
  /** The 额度 group of the ElevenLabs and Fish cards. */
  function balanceGroup() {
    if (!PRICED.includes(engine)) return '';
    const saved = api.keyStatus(engine), entry = balances.get(engine) || {}, b = entry.value;
    const state = !saved ? '填写密钥后可以查看' : entry.loading && !b ? '读取中' : entry.error && !b ? '读取失败' : '';
    let rows;
    if (b?.kind === 'characters') {
      const ratio = b.limit ? Math.min(1, b.used / b.limit) : 0;
      const status = {active: '生效中', trialing: '试用中', past_due: '待付款', incomplete: '未完成付款', free_disabled: '免费额度已停用'}[b.status] || '';
      const tier = b.tier ? b.tier.charAt(0).toUpperCase() + b.tier.slice(1).replace(/_/g, ' ') : '未知';
      rows = `<div class="setting-row"><span>档位</span><small>${esc(tier)}${status ? ' · ' + status : ''}</small></div>
        <div class="field balance-meter"><div class="meter-label"><span>本期已用</span><output>${number(b.used)} / ${number(b.limit)}</output></div><span class="meter-track" role="img" aria-label="已用 ${Math.round(ratio * 100)}%"><i style="width:${(ratio * 100).toFixed(1)}%"></i></span></div>
        <div class="setting-row"><span>剩余额度</span><strong>${number(b.left)}</strong></div>
        <div class="setting-row"><span>下次重置</span><small>${b.resetAt ? new Date(b.resetAt).toLocaleString('zh-CN', {hour12: false}) : '—'}</small></div>`;
    } else if (b?.kind === 'credit') {
      rows = `<div class="setting-row"><span>API 余额</span><strong>$${b.credit.toFixed(2)}</strong></div>
        <div class="setting-row"><span>免费额度</span><small>${b.free ? '还有' : '没有或已用完'}</small></div>`;
    } else rows = `<div class="setting-row"><span>额度</span><small>${state || '—'}</small></div>`;
    return groupTitle('额度', btn('refresh-balance', icon('refresh') + '刷新', 'chip-button', saved ? '' : 'disabled'))
      + `<div class="group${b?.kind === 'characters' ? ' pad' : ''}">${rows}</div>${entry.error ? `<p class="error-copy hint">${esc(entry.error)}</p>` : ''}`
      + `<p class="hint">${engine === 'eleven' ? '每生成一句新语音后自动重新读取。ElevenLabs 按字符扣积分，v3/v4 等模型的倍率以官网为准。' : '每生成一句新语音后自动重新读取。金额是 Fish Audio 后台的 API 余额。'}</p>`;
  }

  function renderDetail() {
    const schema = api.engineSchema(engine, draft());
    drafts.set(engine, schema.connection);
    const c = draft(), saved = api.keyStatus(engine);
    v.root.dataset.engine = engine;
    const unsupported = schema.models.filter(m => !m.supported).map(m => m.id + '：' + m.reason).join('\n');
    v.draw(heading(engines[engine], '', 'Engine Card')
      + card(engine, 'div')
      + groupTitle('连接')
      + `<div class="group pad">
          <div class="setting-row"><span>密钥</span><span class="key-state ${saved ? 'ok' : 'no'}">${saved ? '已保存在这台浏览器' : '还没有填写'}</span></div>
          ${field('API Key', input('key', '', 'password', `autocomplete="off" placeholder="${saved ? '已保存，填写新密钥可替换' : '填写这家引擎的密钥'}"`), '密钥只保存在当前浏览器和酒馆地址，按账户分别保存。填写过不代表鉴权成功。')}
          <div class="key-actions">${btn('save-key', icon('key') + '保存密钥', 'primary')}${btn('reveal-key', '显示', 'secondary')}${btn('clear-key', '清除', 'danger')}</div>
          ${field('默认模型', select('model', c.model, schema.models.map(m => [m.id, m.id, !m.supported])), unsupported || '角色没有单独指定模型时使用这里的模型。')}
          ${engine === 'mini' ? field('服务区域', select('region', c.region, [['cn', '国内'], ['global', '国际'], ['uw', '国际 · 低延迟入口']])) : ''}
          <div class="actions">${btn('read-voices', icon('refresh') + '读取音色列表', 'secondary')}</div><p class="hint" data-connection-status></p>
        </div>`
      + balanceGroup()
      + groupTitle('参数')
      + schema.groups.map((g, i) => `<details data-group="${engine}:${g.id}" ${i === 0 ? 'open' : ''}><summary>${esc(g.title)}</summary><div>${g.fields.map(f => control(f, c)).join('')}</div></details>`).join('')
      + `<details data-group="tags"><summary>情绪与语气标签</summary><div>${schema.tagNote ? `<p class="hint">${esc(schema.tagNote)}</p>` : ''}<div class="tags">${schema.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>${engine === 'mini' && c.model.startsWith('speech-2.8') ? '<div class="tags">' + ['laughs', 'chuckle', 'coughs', 'clear-throat', 'groans', 'breath', 'pant', 'inhale', 'exhale', 'gasps', 'sniffs', 'sighs', 'snorts', 'burps', 'lip-smacking', 'humming', 'hissing', 'emm', 'sneezes'].map(x => `<span class="tag">(${x})</span>`).join('') + '</div>' : ''}${schema.sounds?.length ? '<div class="tags">' + schema.sounds.map(x => `<span class="tag">(${esc(x)})</span>`).join('') + '</div>' : ''}<a href="${esc(schema.source)}" target="_blank" rel="noopener noreferrer">查看官方文档</a></div></details>`
      + `<div class="actions">${engine === 'fish' ? btn('references', '管理参考音频', 'secondary') : ''}${btn('request-preview', icon('eye') + '请求预览', 'text-button')}</div>`
      + `<div class="savebar"><span class="save-state" data-save-state>${dirty ? '未保存' : '已保存'}</span>${btn('save-connection', '保存配置', 'primary')}</div>`);
  }

  const render = () => engine === 'nai' ? renderNovelAI() : engine ? renderDetail() : renderList();
  function edit(id) {
    engine = id;
    if (id === 'nai') { render(); v.root.scrollTop = 0; loadSubscription(false); return; }
    if (!drafts.has(id)) drafts.set(id, structuredClone(api.getState().connections[id]));
    dirty = JSON.stringify(draft()) !== JSON.stringify(api.getState().connections[id]);
    render();
    v.root.scrollTop = 0;
  }
  v.edit = edit;
  v.back = () => { if (!engine) return false; engine = null; render(); return true; };
  v.refresh = () => { if (!engine) render(); };
  if (api.keyStatus('nai')) loadSubscription(false);

  v.on('change', '[data-field]', el => {
    if (el.dataset.field === 'key') return;
    if (el.dataset.field === 'guard') { api.saveDraw({guard: el.checked}); render(); return; }
    draft()[el.dataset.field] = el.value; changed(); render();
  });
  const readValue = (el, f) => f.type === 'boolean' ? el.checked : f.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : f.type === 'select' ? f.options.find(([key]) => String(key) === el.value)?.[0] : el.value;
  async function updateParam(el, redraw) {
    const c = draft(), schema = api.engineSchema(engine, c), f = schema.groups.flatMap(g => g.fields).find(x => x.key === el.dataset.param);
    if (!f) return;
    if (el.dataset.row !== undefined) {
      const row = c.params[f.key][Number(el.dataset.row)], col = f.columns.find(x => x.key === el.dataset.column);
      if (!row) return;
      if (col.type === 'file') {
        const file = el.files?.[0];
        if (!file) return;
        el.disabled = true;
        try {
          const id = await api.reference(file);
          if (c.params[f.key].includes(row)) { row[col.key] = id; if (draft() === c) { changed(); render(); } }
        } finally { if (el.isConnected) el.disabled = false; }
        return;
      }
      row[col.key] = readValue(el, col);
    } else c.params[f.key] = readValue(el, f);
    changed();
    if (redraw && ['select', 'boolean'].includes(f.type)) render();
  }
  v.on('input', '[data-param]', el => { if (!['checkbox', 'file'].includes(el.type) && el.tagName !== 'SELECT') return updateParam(el, false); });
  v.on('change', '[data-param]', el => updateParam(el, true));
  v.on('click', '[data-action]', async el => {
    switch (el.dataset.action) {
      case 'engine': edit(el.dataset.engine); break;
      case 'save-connection': api.saveConnection(engine, draft()); dirty = false; render(); ctx.notify('引擎配置已保存'); break;
      case 'save-key': api.setKey(engine, v.root.querySelector('[data-field=key]').value); balances.delete(engine); render(); ctx.notify('密钥已保存'); if (engine === 'nai') loadSubscription(true); else loadBalance(engine, true); break;
      case 'refresh-subscription': await v.busy(el, () => loadSubscription(true)); break;
      case 'refresh-balance': await v.busy(el, () => loadBalance(engine, true)); break;
      case 'open-draw': ctx.open('draw'); break;
      case 'clear-key': if (await ctx.confirm('清除密钥？', '之后使用这个引擎需要重新填写。')) { api.clearKey(engine); if (engine === 'nai') subscription = null; balances.delete(engine); render(); } break;
      case 'reveal-key': {
        const field = v.root.querySelector('[data-field=key]');
        field.type = field.type === 'password' ? 'text' : 'password';
        el.textContent = field.type === 'password' ? '显示' : '隐藏';
        break;
      }
      case 'read-voices': {
        const current = engine;
        await v.busy(el, async () => {
          const r = await api.voices(current, draft());
          if (current === engine) { const status = v.root.querySelector('[data-connection-status]'); if (status) status.textContent = r.note + ' · ' + r.voices.length + ' 个'; }
        });
        break;
      }
      case 'add-row': {
        const f = api.engineSchema(engine, draft()).groups.flatMap(g => g.fields).find(x => x.key === el.dataset.paramKey);
        if (draft().params[f.key].length < f.max) draft().params[f.key].push(Object.fromEntries(f.columns.map(c => [c.key, c.value ?? (c.type === 'boolean' ? false : c.type === 'number' ? c.min ?? 0 : '')])));
        changed();
        render();
        break;
      }
      case 'remove-row': draft().params[el.dataset.paramKey].splice(Number(el.dataset.index), 1); changed(); render(); break;
      case 'request-preview': {
        const state = api.getState(), r = state.routes.find(r => r.engine === engine) || {name: '预览角色', voice: 'voice-id', engine, language: state.general.defaultLanguage};
        const request = api.previewRequest(engine, draft(), {...r, model: ''}, {role: r.name, emotion: 'calm', text: '雨还没停，再坐一会儿吧。', translation: '雨还没停，再坐一会儿吧。'});
        ctx.dialog('请求预览', `<pre class="code-preview">${esc(JSON.stringify(request, null, 2))}</pre>`);
        break;
      }
      case 'references': await manageReferences(); break;
    }
  });

  async function manageReferences() {
    const d = ctx.dialog('参考音频', '<p class="hint">正在读取…</p>');
    const refresh = async () => {
      const rows = await api.listReferences();
      if (!d.live) return;
      d.body.innerHTML = rows.length
        ? '<div class="group">' + rows.map(r => `<div class="list-row"><span><strong>${esc(r.name)}</strong><small>${Math.round(r.size / 1024)} KB</small></span><button class="text-button" data-delete-reference="${esc(r.id)}">删除</button></div>`).join('') + '</div>'
        : '<p class="hint">还没有保存参考音频。</p>';
    };
    d.body.addEventListener('click', async e => {
      const el = e.target.closest('[data-delete-reference]');
      if (!el) return;
      el.disabled = true;
      try {
        await api.deleteReference(el.dataset.deleteReference);
        for (const c of drafts.values()) if (c.params.references) c.params.references = c.params.references.filter(r => r.audio !== el.dataset.deleteReference);
        await refresh();
      } catch (error) { ctx.notify(error.message); }
      finally { if (el.isConnected) el.disabled = false; }
    });
    await refresh();
  }

  render();
  v.onBalance = event => {
    if (!event.stale || !PRICED.includes(event.engine)) return;
    if (engine === event.engine || (engine === null && balances.has(event.engine))) loadBalance(event.engine, true);
    else balances.delete(event.engine);
  };
  return v;
}
