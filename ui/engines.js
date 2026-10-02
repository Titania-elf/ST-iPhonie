import {createView, esc, engines, btn, field, input, select, textArea, toggle, heading, help, groupTitle, plate} from './common.js';

const TIERS = {0: '未订阅', 1: 'Tablet', 2: 'Scroll', 3: 'Opus'};
import {icon, spark} from './icons.js';

export function enginesApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'engines'), drafts = new Map();
  let engine = null, dirty = false, subscription = null, subscriptionError = '', subscriptionStatus = 0, textDraft = null, models = [];
  // The wallet is a stack: the last card is the one in front. A tap on another card draws it to the front; a tap on
  // the front card opens it.
  let order = ['llm', ...Object.keys(engines), 'nai'];
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

  /** 已保存，末尾 ab12 · or, with several keys: 已保存 3 个，正在用第 2 个（末尾 ab12），1 个这次被拒已跳过. */
  const keyState = id => {
    const tail = api.keyHint?.(id) || '', pool = api.keyPool?.(id);
    if (!pool || pool.count < 2) return '已保存' + (tail ? '，末尾 ' + esc(tail) : '');
    return `已保存 ${pool.count} 个，正在用第 ${pool.current} 个${tail ? '（末尾 ' + esc(tail) + '）' : ''}${pool.refused ? `，${pool.refused} 个这次被拒已跳过` : ''}`;
  };
  /** The saved keys of a voice engine, one row each: never the key, only its last characters. */
  const keyRows = id => {
    const list = api.keyList?.(id) || [];
    if (!list.length) return '';
    return `<div class="key-list">${list.map((k, i) => `<div class="key-row${k.current ? ' current' : ''}"><span class="key-no" aria-label="第 ${i + 1} 个">${i + 1}</span><span class="mono">•••• ${esc(k.tail)}</span>${k.current ? plate('正在用') : ''}${k.refused ? '<small class="error-copy">这次被拒</small>' : ''}<button class="text-button" data-action="remove-key" data-index="${i}" aria-label="删除第 ${i + 1} 个密钥">删除</button></div>`).join('')}</div>`;
  };
  /** The text model preset being edited (the draft's active one). */
  const textPreset = () => textDraft.presets.find(p => p.id === textDraft.active) || textDraft.presets[0];
  const nameOf = id => id === 'nai' ? 'NovelAI' : id === 'llm' ? '文字模型' : engines[id];
  function card(id, tag = 'button') {
    const saved = api.keyStatus(id), nai = id === 'nai', llm = id === 'llm';
    const name = nameOf(id), t = llm ? (engine === 'llm' && textDraft ? textDraft : api.getState().text) : null, custom = t?.source === 'custom';
    const fields = llm
      ? [['SOURCE', custom ? 'CUSTOM API' : 'TAVERN'], ['MODEL', custom ? t.presets.find(p => p.id === t.active)?.model || '未填写' : '跟随酒馆']]
      : nai
      ? [['TIER', subscription ? TIERS[subscription.tier] || '未知' : '—'], ['ANLAS', subscription ? String(subscription.anlas) : '—']]
      : PRICED.includes(id) && saved
        ? [['MODEL', api.getState().connections[id].model], [id === 'eleven' ? 'CREDITS' : 'BALANCE', balanceText(id)]]
        : [['MODEL', api.getState().connections[id].model], ['ROLES', api.getState().routes.filter(r => r.engine === id && r.voice).length + ' 个角色']];
    const front = order.at(-1) === id;
    const attrs = tag === 'button' ? `data-action="engine" data-engine="${id}" aria-label="${name}，${front ? '点一下打开' : '点一下抽到最前面'}"` : `data-engine="${id}"`;
    const dots = `•••• •••• •••• ${api.keyHint?.(id) || '••••'}`;
    const number = llm ? (custom ? (saved ? dots : '未绑定密钥 · 点卡片去填写') : '用酒馆当前连接的模型') : saved ? dots : '未绑定密钥 · 点卡片去填写';
    return `<${tag} class="bank-card${tag === 'div' ? ' detail-card' : ''}" ${attrs}>${spark()}
      <span class="card-top"><span class="card-name">${name}</span><span class="card-kind">${nai ? 'IMAGE' : llm ? 'TEXT' : 'VOICE'}${icon('nfc')}</span></span>
      <span class="card-chip"></span>
      <span class="card-number${number.startsWith('•') ? '' : ' none'}">${number}</span>
      <span class="card-bottom">${fields.map(([k, value]) => `<span><span class="k">${k}</span><span class="v">${esc(value)}</span></span>`).join('')}<span class="card-brand">ST-iPhonie</span></span></${tag}>`;
  }

  const relayNoSubscription = () => !subscription && subscriptionStatus === 404 && !!api.getState().draw.relay.url;
  /** What the relay check found, one line each for drawing and the subscription. */
  function probeReport(r) {
    const d = r.draw, s = r.subscription, where = r.relay ? '中转' : 'NovelAI';
    const draw = d.ok ? `✓ 出图接口通了${d.status === 429 ? '，不过账号现在正忙（429）' : ''}（只发了一个空请求试探，没有出图，不扣 Anlas）`
      : d.status === 0 ? `✗ 连不上${where}：地址不对，或${r.relay ? '中转没有允许跨域（CORS）；酒馆用 HTTPS 打开时中转也要用 HTTPS' : '网络不通'}`
      : [401, 403].includes(d.status) ? `✗ ${where}拒绝了密钥（${d.status}）：请填写${r.relay ? '中转要求的' : '正确的'}密钥`
      : d.status === 404 ? `✗ 出图接口 404：插件请求的是「${esc(api.getState().draw.relay.url || 'https://image.novelai.net')}/ai/generate-image」，${where}不认这个路径。中转地址只填到这个路径前面为止。`
      : `? 出图接口返回 ${d.status}，说不准能不能出图，可以直接试着画一张`;
    const sub = s.ok ? `✓ 读到订阅：${TIERS[s.tier] || '未知档位'}`
      : r.relay && s.status === 404 ? `— 这个中转不转发查订阅，不影响出图。${api.getState().draw.relay.assumeOpus ? '已经按 Opus 算。' : '想自动出图，打开「读不到订阅时按 Opus 算」。'}`
      : `✗ 查订阅失败：${esc(s.message)}`;
    return `<div class="group pad"><p class="probe-line">${draw}</p><p class="probe-line">${sub}</p></div>`;
  }
  async function loadSubscription(refresh) {
    subscriptionError = ''; subscriptionStatus = 0;
    try { subscription = await api.naiSubscription(refresh); }
    catch (error) { subscription = null; subscriptionError = error.message; subscriptionStatus = error.status || 0; }
    if (!v.disposed) render();
  }

  function renderNovelAI() {
    const saved = api.keyStatus('nai'), d = api.getState().draw;
    v.root.dataset.engine = 'nai';
    v.draw(heading('NovelAI', '', 'Image Card')
      + card('nai', 'div')
      + groupTitle('连接')
      + `<div class="group pad">
          <div class="setting-row"><span>密钥</span><span class="key-state ${saved ? 'ok' : 'no'}">${saved ? `已保存${api.keyHint?.(engine) ? '，末尾 ' + esc(api.keyHint(engine)) : ''}` : '还没有填写'}</span></div>
          ${field(d.relay.url ? '中转密钥' : 'Persistent API Token', input('key', '', 'password', `autocomplete="off" placeholder="${saved ? '已保存，填写新的可替换' : d.relay.url ? '填中转要求的密钥' : '在 NovelAI 账户设置里获取，以 pst- 开头'}"`), d.relay.url ? '用了中转时，填中转要求的密钥（可能就是 NovelAI 的 pst- 密钥，也可能是中转自己发的）。密钥只保存在当前浏览器和酒馆地址。' : '插件直接连接 NovelAI，不经过酒馆。密钥只保存在当前浏览器和酒馆地址。')}
          <div class="key-actions">${btn('save-key', icon('key') + '保存密钥', 'primary')}${btn('reveal-key', '显示', 'secondary')}${btn('clear-key', '清除', 'danger')}</div>
        </div>`
      + groupTitle('中转', help('自己搭的 NovelAI 中转。中转的路径要和官方一样：出图 /ai/generate-image，查订阅 /user/subscription；插件把请求原样发到「中转地址 + 路径」。留空就直连 NovelAI。\n\n中转要允许跨域（CORS）；酒馆用 HTTPS 打开时，中转也要用 HTTPS。'))
      + `<div class="group pad">
          ${field('中转地址', input('relay', d.relay.url, 'url', 'autocomplete="off" placeholder="留空直连，例如 https://nai.example.com"'))}
          ${d.relay.url ? toggle('relayOpus', '读不到订阅时按 Opus 算', d.relay.assumeOpus, '中转不转发查订阅的接口时打开：28 步、1024×1024 以内的非 V5 小图当作免费，可以自动出图。V5 的免费额度读不到，仍然会先问。账号不是 Opus 时，这些图会扣 Anlas。') : ''}
          <div class="key-actions">${btn('save-relay', d.relay.url ? '保存中转' : '使用中转', 'primary')}${d.relay.url ? btn('test-relay', icon('refresh') + '测试连接', 'secondary', saved ? '' : 'disabled') : ''}</div>
        </div>`
      + groupTitle('订阅', btn('refresh-subscription', icon('refresh') + '刷新', 'chip-button', saved ? '' : 'disabled'))
      + `<div class="group">
          <div class="setting-row"><span>档位</span><small>${subscription ? TIERS[subscription.tier] || '未知' : saved ? (relayNoSubscription() ? '中转不提供' : subscriptionError ? '读取失败' : '读取中') : '—'}</small></div>
          <div class="setting-row"><span>Anlas 余额</span><strong>${subscription ? subscription.anlas : '—'}</strong></div>
          <div class="setting-row"><span>免费小图</span><small>${subscription ? (subscription.unlimited ? 'V4.5 及更早：无限（28 步、1024×1024 以内）' : subscription.active ? '仅 Opus 可用：每张图都会扣 Anlas' : '订阅未生效：每张图都会扣 Anlas') : '—'}</small></div>
          ${subscription?.unlimited ? `<div class="setting-row"><span>V5 免费额度</span><small>${subscription.usage ? (subscription.usage.negative || subscription.usage.percent < 2 ? `${subscription.usage.percent}% · 已用完，会扣 Anlas` : `还剩 ${subscription.usage.percent}%，会慢慢恢复`) : '未读到'}</small></div>` : ''}
        </div>${relayNoSubscription() ? `<p class="hint">这个中转不转发查订阅（插件请求的是「中转地址/user/subscription」），出图不受影响。${d.relay.assumeOpus ? '已经按 Opus 算，小图会自动出。' : '想让新回复自动出图，打开上面的「读不到订阅时按 Opus 算」。'}点「测试连接」可以单独检查出图接口。</p>` : subscriptionError ? `<p class="error-copy hint">${esc(subscriptionError)}</p>` : ''}`
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

  /** Draws a card to the front of the stack: the cards move from where they were to where they end up (FLIP). */
  function bringFront(id) {
    const wallet = v.root.querySelector('.wallet');
    order = [...order.filter(x => x !== id), id];
    if (!wallet) return render();
    const before = new Map([...wallet.children].map(el => [el.dataset.engine, el.getBoundingClientRect().top]));
    for (const key of order) { const el = wallet.querySelector(`[data-engine="${key}"]`); if (el) wallet.append(el); }
    const reduce = ctx.win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    for (const el of wallet.children) {
      const key = el.dataset.engine, dy = (before.get(key) ?? 0) - el.getBoundingClientRect().top;
      el.setAttribute('aria-label', `${nameOf(key)}，${key === id ? '点一下打开' : '点一下抽到最前面'}`);
      if (!dy || reduce) continue;
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
    }
    void wallet.offsetHeight;
    for (const el of wallet.children) { el.style.transition = ''; el.style.transform = ''; }
    wallet.querySelector(`[data-engine="${id}"]`)?.focus({preventScroll: true});
  }

  function renderList() {
    delete v.root.dataset.engine;
    v.draw(heading('引擎', help('每个服务一张卡：文字模型、四家语音引擎（Fish Audio、MiniMax、ElevenLabs、小米 MiMo），加上绘图用的 NovelAI。点一张卡片把它抽到最前面，再点一下打开，查看连接和全部参数。ElevenLabs 和 Fish 的卡片上显示剩余额度。\n卡片只显示密钥是否保存，不显示内容；“已保存”不代表鉴权成功。'), 'Wallet · 05')
      + `<div class="wallet">${order.map(id => card(id)).join('')}</div>`);
    for (const id of PRICED) if (!balances.has(id)) loadBalance(id);
  }
  /** The 额度 group of the ElevenLabs and Fish cards. */
  /** Fish relay (中转): an address in front of Fish Audio, saved on its own, and a check of what it forwards. */
  function fishRelay() {
    const relay = api.getState().connections.fish.relay || '';
    return `${field('中转地址', input('relay', relay, 'url', 'autocomplete="off" placeholder="留空直连 Fish Audio，例如 https://fish.example.com"'), '用中转（公益站、自己搭的反代）时填这里，留空就直连 Fish Audio。\n\n插件会把请求发到「中转地址」加上 Fish 官方的路径：合成 /compat/v1/audio/speech，音色列表 /model，余额 /wallet/self/api-credit。所以只填到这些路径前面为止；把完整地址粘进来也行，会自动去掉。\n\n中转要允许网页直接访问（CORS）；酒馆用 HTTPS 打开时，中转也要是 HTTPS。密钥填中转要求的那个（可能是 Fish 的，也可能是站长发的），一样可以存好几个。')}
      <div class="key-actions">${btn('save-fish-relay', relay ? '保存中转' : '使用中转', 'primary')}${btn('test-fish-relay', icon('refresh') + '测试连接', 'secondary', api.keyStatus('fish') ? '' : 'disabled')}</div>`;
  }
  function fishProbeReport(r) {
    const where = r.relay ? '中转' : 'Fish Audio', path = p => `「${esc(r.base)}${p}」`;
    const speech = r.speech.status === 0 ? `✗ 连不上${where}：地址不对，或${r.relay ? '中转没有允许跨域（CORS）；酒馆用 HTTPS 打开时中转也要用 HTTPS' : '网络不通'}`
      : [401, 403].includes(r.speech.status) ? `✗ ${where}拒绝了密钥（${r.speech.status}）：请填写${r.relay ? '中转要求的' : '正确的'}密钥`
      : r.speech.status === 404 ? `✗ 合成接口 404：插件请求的是${path('/compat/v1/audio/speech')}，${where}不认这个路径。中转地址只填到这个路径前面为止；如果这个中转只转发别的路径，把它的说明发给插件作者。`
      : r.speech.status === 402 ? `✓ 合成接口通了，但${where}说额度不够（402）`
      : r.speech.status === 429 ? `✓ 合成接口通了，现在请求太多（429），稍后再试`
      : r.speech.status >= 500 ? `✗ ${where}自己出错了（HTTP ${r.speech.status}），稍后再试或者问问站长`
      : `✓ 合成接口通了（测试请求故意是空的，返回 ${r.speech.status} 是正常的）`;
    const voices = r.voices.ok ? '✓ 音色列表也能读' : r.voices.status === 0 ? '— 读不到音色列表（不影响合成，音色 ID 可以手动填）' : `— 音色列表返回 ${r.voices.status}（不影响合成，音色 ID 可以手动填）`;
    return `<div class="group pad"><p class="probe-line">${speech}</p><p class="probe-line">${voices}</p></div>`;
  }
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
          <div class="setting-row"><span>密钥</span><span class="key-state ${saved ? 'ok' : 'no'}">${saved ? keyState(engine) : '还没有填写'}</span></div>
          ${keyRows(engine)}
          ${field(saved ? '添加密钥' : 'API Key', textArea('key', '', `rows="2" class="code" autocomplete="off" spellcheck="false" placeholder="${saved ? '粘贴新的密钥，会加在后面' : '粘贴密钥；有多个账号可以每行一个'}"`), '可以保存多个账号的密钥，新加的排在后面，不用的可以单独删掉。先用排在前面的；某个密钥被拒（401、403）、额度用完（402）或请求太频繁（429）时，自动换下一个重试，这次打开页面里不再用它。\n\n密钥只保存在当前浏览器和酒馆地址，按账户分别保存。')}
          <div class="key-actions">${btn('add-key', icon('key') + (saved ? '添加' : '保存密钥'), 'primary')}${saved ? btn('clear-key', '全部清除', 'danger') : ''}</div>
          ${field('默认模型', select('model', c.model, schema.models.map(m => [m.id, m.id, !m.supported])), unsupported || '角色没有单独指定模型时使用这里的模型。')}
          ${engine === 'mini' ? field('服务区域', select('region', c.region, [['cn', '国内'], ['global', '国际'], ['uw', '国际 · 低延迟入口']])) : ''}
          ${engine === 'fish' ? fishRelay() : ''}
          <div class="actions">${btn('read-voices', icon('refresh') + '读取音色列表', 'secondary')}</div><p class="hint" data-connection-status></p>
        </div>`
      + balanceGroup()
      + groupTitle('参数')
      + schema.groups.map((g, i) => `<details data-group="${engine}:${g.id}" ${i === 0 ? 'open' : ''}><summary>${esc(g.title)}</summary><div>${g.fields.map(f => control(f, c)).join('')}</div></details>`).join('')
      + `<details data-group="tags"><summary>情绪与语气标签</summary><div>${schema.tagNote ? `<p class="hint">${esc(schema.tagNote)}</p>` : ''}<div class="tags">${schema.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>${engine === 'mini' && c.model.startsWith('speech-2.8') ? '<div class="tags">' + ['laughs', 'chuckle', 'coughs', 'clear-throat', 'groans', 'breath', 'pant', 'inhale', 'exhale', 'gasps', 'sniffs', 'sighs', 'snorts', 'burps', 'lip-smacking', 'humming', 'hissing', 'emm', 'sneezes'].map(x => `<span class="tag">(${x})</span>`).join('') + '</div>' : ''}${schema.sounds?.length ? '<div class="tags">' + schema.sounds.map(x => `<span class="tag">(${esc(x)})</span>`).join('') + '</div>' : ''}<a href="${esc(schema.source)}" target="_blank" rel="noopener noreferrer">查看官方文档</a></div></details>`
      + `<div class="actions">${engine === 'fish' ? btn('references', '管理参考音频', 'secondary') : ''}${btn('request-preview', icon('eye') + '请求预览', 'text-button')}</div>`
      + `<div class="savebar"><span class="save-state" data-save-state>${dirty ? '未保存' : '已保存'}</span>${btn('save-connection', '保存配置', 'primary')}</div>`);
  }

  /** 文字模型: the tavern's model, or an OpenAI-compatible API of the user's own. */
  function renderText() {
    const all = textDraft, t = textPreset(), hint = api.textKeyHint?.(t.id) || '', saved = !!hint, custom = all.source === 'custom';
    v.root.dataset.engine = 'llm';
    v.draw(heading('文字模型', '', 'Text Card')
      + card('llm', 'div')
      + groupTitle('谁来写手机里的字', help('手机里的字：聊天回复、朋友圈、来电，以及正文配图时挑画面。正文本身始终用酒馆的模型。\n酒馆主模型：和正文一样，用酒馆当前连接的模型，换了酒馆的模型手机也跟着换。\n自定义接口：用你自己的 OpenAI 兼容接口，不占用酒馆正在用的模型，正文和手机可以用不同的模型。插件直接从浏览器连接这个接口，不经过酒馆。'))
      + `<div class="group pad"><div class="segmented" style="margin:0">${[['tavern', '酒馆主模型'], ['custom', '自定义接口']].map(([k, l]) => `<button type="button" data-action="text-source" data-source="${k}" aria-pressed="${all.source === k}">${l}</button>`).join('')}</div>
</div>`
      + (custom ? groupTitle('接口预设', help('可以存好几套自定义接口：地址、模型、密钥、温度、长度各一份，点一下切换正在用的那套。每套的密钥分开保存；删掉一套，它的密钥也一起删掉。切换、新建、删除和改名都要点下面的「保存」才生效。'))
        + `<div class="group pad"><div class="text-presets">${all.presets.map(p => `<button type="button" class="combo-chip" data-action="text-preset" data-id="${esc(p.id)}" aria-pressed="${p.id === all.active}">${esc(p.name)}</button>`).join('')}${btn('text-new', icon('add') + '新建', 'chip-button')}</div>
          ${field('预设名字', input('text-name', t.name, 'text', 'maxlength="40" autocomplete="off"'))}
          ${all.presets.length > 1 ? `<div class="actions" style="margin-top:0">${btn('text-delete', icon('trash') + '删除这套', 'danger')}</div>` : ''}</div>`
        + groupTitle('连接') + `<div class="group pad">
          ${field('接口地址', input('text-url', t.url, 'url', 'autocomplete="off" placeholder="https://api.openai.com/v1"'), '填到 /v1 为止，后面的 /chat/completions 不用写。OpenAI 格式的服务都可以：OpenAI、DeepSeek、OpenRouter、硅基流动、各种中转站。接口要允许网页直接访问（CORS），不然浏览器会拦下请求。')}
          <div class="setting-row"><span>密钥</span><span class="key-state ${saved ? 'ok' : 'no'}">${saved ? `已保存，末尾 ${esc(hint)}` : '还没有填写'}</span></div>
          ${field('API Key', input('key', '', 'password', `autocomplete="off" placeholder="${saved ? '已保存，填写新密钥可替换' : '这个接口的密钥（本地模型可以不填）'}"`), '密钥只保存在当前浏览器和酒馆地址，不会写进设置或备份。')}
          <div class="key-actions">${btn('save-key', icon('key') + '保存密钥', 'primary')}${btn('reveal-key', '显示', 'secondary')}${btn('clear-key', '清除', 'danger')}</div>
          ${field('模型', input('text-model', t.model, 'text', 'autocomplete="off" placeholder="例如 gpt-4o-mini、deepseek-chat"'))}
          <div class="actions">${btn('text-models', icon('refresh') + '读取模型列表', 'secondary')}</div>
          <div class="combo-menu model-list" data-model-list ${models.length ? '' : 'hidden'}>${models.map(m => `<button type="button" class="combo-chip" data-action="text-pick" data-model="${esc(m)}" aria-pressed="${m === t.model}">${esc(m)}</button>`).join('')}</div>
          <p class="hint" data-text-status></p>
          ${field('温度', input('text-temperature', t.temperature, 'number', 'min="0" max="2" step="0.05"'), '越高越随性，越低越稳定。0.7–1 比较常用。')}
          ${field('最长回复（tokens）', input('text-maxTokens', t.maxTokens, 'number', 'min="64" max="32000" step="1"'), '一次回复最多写多少。聊天和电话用不了多少，配图规划会按需要取更小的值。')}
        </div>` : '')
      + `<div class="savebar"><span class="save-state" data-save-state>${dirty ? '未保存' : '已保存'}</span>${btn('save-text', '保存', 'primary')}</div>`);
  }

  const render = () => engine === 'nai' ? renderNovelAI() : engine === 'llm' ? renderText() : engine ? renderDetail() : renderList();
  function edit(id) {
    engine = id;
    if (!order.length || order.at(-1) !== id) order = [...order.filter(x => x !== id), id];
    if (id === 'llm') { textDraft = structuredClone(api.getState().text); dirty = false; render(); v.root.scrollTop = 0; return; }
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
    if (engine === 'llm') {
      const key = el.dataset.field.replace(/^text-/, '');
      if (!['name', 'url', 'model', 'temperature', 'maxTokens'].includes(key)) return;
      textPreset()[key] = ['temperature', 'maxTokens'].includes(key) ? Number(el.value) : el.value.trim();
      changed();
      return;
    }
    if (el.dataset.field === 'guard') { api.saveDraw({guard: el.checked}); render(); return; }
    if (el.dataset.field === 'relayOpus') { api.saveDraw({relay: {assumeOpus: el.checked}}); render(); return; }
    if (el.dataset.field === 'relay') return;
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
      case 'engine': if (order.at(-1) === el.dataset.engine) edit(el.dataset.engine); else bringFront(el.dataset.engine); break;
      case 'text-source': textDraft.source = el.dataset.source; changed(); dirty = true; render(); break;
      case 'text-preset': if (textDraft.active !== el.dataset.id) { textDraft.active = el.dataset.id; models = []; changed(); dirty = true; render(); } break;
      case 'text-new': {
        const id = crypto.randomUUID(), now = textPreset();
        textDraft.presets.push({id, name: '接口 ' + (textDraft.presets.length + 1), url: '', model: '', temperature: now.temperature, maxTokens: now.maxTokens});
        textDraft.active = id; models = []; changed(); dirty = true; render();
        v.root.querySelector('[data-field=text-name]')?.focus();
        break;
      }
      case 'text-delete': {
        const gone = textPreset();
        if (textDraft.presets.length < 2 || !await ctx.confirm('删除这套接口？', `「${gone.name}」和它的密钥会被删掉（点「保存」后生效），其他的保留。`)) break;
        textDraft.presets = textDraft.presets.filter(p => p.id !== gone.id); textDraft.active = textDraft.presets[0].id; models = []; changed(); dirty = true; render();
        break;
      }
      case 'save-text': api.saveText(textDraft); textDraft = structuredClone(api.getState().text); dirty = false; render(); ctx.notify('文字模型已保存'); break;
      case 'text-pick': {
        textPreset().model = el.dataset.model;
        const box = v.root.querySelector('[data-field=text-model]');
        if (box) box.value = textPreset().model;
        for (const chip of v.root.querySelectorAll('[data-action=text-pick]')) chip.setAttribute('aria-pressed', String(chip === el));
        changed();
        break;
      }
      case 'text-models': {
        const status = () => v.root.querySelector('[data-text-status]');
        await v.busy(el, async () => {
          try {
            models = await api.textModels(textDraft);
            render();
            if (status()) status().textContent = models.length ? `连接成功，读到 ${models.length} 个模型，点一个就能选上` : '连接成功，但这个接口没有列出模型，直接填写模型名就好';
          } catch (error) { if (status()) status().textContent = error.message; }
        });
        break;
      }
      case 'save-connection': {
        // A key typed in the box is kept too: people expect the big button to save everything on the page.
        const typed = v.root.querySelector('[data-field=key]')?.value || '';
        if (typed.trim()) { api.setKey(engine, typed); balances.delete(engine); }
        api.saveConnection(engine, draft()); dirty = false; render(); ctx.notify(typed.trim() ? '密钥和引擎配置都已保存' : '引擎配置已保存');
        if (typed.trim()) loadBalance(engine, true);
        break;
      }
      case 'save-key': if (engine === 'llm') { api.setTextKey(textDraft.active, v.root.querySelector('[data-field=key]').value); render(); ctx.notify('密钥已保存'); break; } api.setKey(engine, v.root.querySelector('[data-field=key]').value); balances.delete(engine); render(); ctx.notify('密钥已保存'); if (engine === 'nai') loadSubscription(true); else loadBalance(engine, true); break;
      case 'refresh-subscription': await v.busy(el, () => loadSubscription(true)); break;
      case 'save-relay': {
        const url = v.root.querySelector('[data-field=relay]').value;
        api.saveDraw({relay: {url}});
        subscription = null; render();
        ctx.notify(api.getState().draw.relay.url ? '中转地址已保存' : '已改回直连 NovelAI');
        if (api.keyStatus('nai')) loadSubscription(true);
        break;
      }
      case 'save-fish-relay': {
        api.saveConnection('fish', {relay: v.root.querySelector('[data-field=relay]').value});
        draft().relay = api.getState().connections.fish.relay;
        balances.delete('fish'); render();
        ctx.notify(draft().relay ? 'Fish 中转地址已保存' : '已改回直连 Fish Audio');
        if (api.keyStatus('fish')) loadBalance('fish', true);
        break;
      }
      case 'test-fish-relay': await v.busy(el, async () => { ctx.dialog('测试连接', fishProbeReport(await api.fishProbe())); }); break;
      case 'test-relay': await v.busy(el, async () => {
        const result = await api.naiProbe();
        await loadSubscription(false);
        ctx.dialog('测试连接', probeReport(result));
      }); break;
      case 'refresh-balance': await v.busy(el, () => loadBalance(engine, true)); break;
      case 'open-draw': ctx.open('draw'); break;
      case 'add-key': {
        const added = api.addKeys(engine, v.root.querySelector('[data-field=key]').value);
        balances.delete(engine); render(); ctx.notify(added > 1 ? `已添加 ${added} 个密钥` : '密钥已保存'); loadBalance(engine, true);
        break;
      }
      case 'remove-key': {
        const index = Number(el.dataset.index), k = api.keyList(engine)[index];
        if (!k || !await ctx.confirm('删除这个密钥？', `第 ${index + 1} 个（末尾 ${k.tail}）会被删掉，其他的保留。`)) break;
        api.removeKey(engine, index); balances.delete(engine); render(); ctx.notify('已删除'); loadBalance(engine, true);
        break;
      }
      case 'clear-key': if (engine === 'llm') { if (await ctx.confirm('清除这套接口的密钥？', '其他接口预设的密钥不受影响。')) { api.clearTextKey(textDraft.active); render(); } break; }
        if (await ctx.confirm(engine === 'nai' ? '清除密钥？' : '清除全部密钥？', '之后使用这个引擎需要重新填写。')) { api.clearKey(engine); if (engine === 'nai') subscription = null; balances.delete(engine); render(); } break;
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
