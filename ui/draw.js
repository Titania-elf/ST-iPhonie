import {createView, esc, btn, field, input, select, textArea, toggle, heading, help, groupTitle, plate, avatar, empty} from './common.js';
import {icon} from './icons.js';

const SIZES = [['portrait', '竖图', 832, 1216], ['landscape', '横图', 1216, 832], ['square', '方图', 1024, 1024], ['tall', '大竖图', 1024, 1536]];
const TIERS = {0: '未订阅', 1: 'Tablet', 2: 'Scroll', 3: 'Opus'};
const POSITION = i => i < 0 ? '自动' : 'ABCDE'[i % 5] + (Math.floor(i / 5) + 1);

export function drawApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'draw'), urls = new Map();
  let tab = 'prompt', prompt = '', negative = '', characters = [], seed = -1, results = [], current = -1, busy = false, subscription = null, styleDraft = null, epoch = 0;
  const state = () => api.getState().draw;
  const style = () => { const d = state(); return d.styles.find(s => s.id === d.activeStyle) || d.styles[0]; };
  const urlFor = async id => {
    if (urls.has(id)) return urls.get(id);
    const photo = await api.getPhoto(id);
    if (!photo) return '';
    const url = ctx.win.URL.createObjectURL(photo.blob);
    urls.set(id, url);
    return url;
  };

  function quote() {
    const d = state();
    return api.drawQuote({...d.params, ...(seed >= 0 ? {seed} : {})});
  }
  function costChip(q) {
    if (!api.keyStatus('nai')) return '<span class="chip" data-engine="none">未填密钥</span>';
    if (q.free === true) return `<span class="chip">${icon(q.guard ? 'lock' : 'unlock')}免费档 · 0 Anlas</span>`;
    if (q.free === false) return `<span class="chip warn">${icon('alert')}会扣 Anlas</span>`;
    return `<span class="chip" data-engine="none">${icon(q.guard ? 'lock' : 'unlock')}免费档内 · 订阅未确认</span>`;
  }

  async function render() {
    const ticket = ++epoch, d = state(), s = styleDraft || style(), q = quote(), p = q.params, keyed = api.keyStatus('nai');
    const shown = results[current];
    const main = shown ? await urlFor(shown.photoId) : '';
    const thumbs = await Promise.all(results.map(r => urlFor(r.photoId)));
    if (v.disposed || ticket !== epoch) return;
    const size = SIZES.find(([, , w, h]) => w === d.params.width && h === d.params.height)?.[0] || 'custom';
    const tabs = [['prompt', '提示词'], ['chars', '角色'], ['params', '参数'], ['chat', '正文出图']];
    let body = '';
    if (tab === 'prompt') body = `
      <div class="group pad">${field('这张图的提示词', textArea('prompt', prompt, 'rows="4" placeholder="英文 tag，逗号分隔，例如 2girls, rainy day, cafe window, sharing an umbrella"'), '实际发送：画师串 + 固定正面 + 这里的提示词。')}
        <div class="actions" style="margin-top:0">${btn('suggest', icon('wand') + '从剧情生成', 'secondary')}</div>
        ${field('这张图额外的负面', textArea('negative', negative, 'rows="2" placeholder="可以留空，会和固定负面合在一起"'))}</div>`;
    if (tab === 'chars') body = (characters.length ? characters.map((c, i) => `
      <div class="group pad draw-char" data-engine="${ctx.engineOf(c.name)}"><div class="row-heading">${avatar(c.name, ctx.engineOf(c.name), 30)}<strong style="flex:1">${esc(c.name)}</strong><span class="chip">位置 ${POSITION(c.position)}</span>${btn('remove-char', icon('trash'), 'text-button', `data-index="${i}" aria-label="移除 ${esc(c.name)}"`)}</div>
        <div class="char-body">${textArea('char', c.prompt, `data-index="${i}" rows="3" aria-label="${esc(c.name)} 的提示词"`)}
          <div class="pos-grid" aria-label="画面位置">${Array.from({length: 25}, (_, k) => `<button data-action="position" data-index="${i}" data-position="${k}" aria-pressed="${c.position === k}" aria-label="位置 ${POSITION(k)}"></button>`).join('')}</div></div>
        ${btn('position', '让模型自己决定位置', 'text-button', `data-index="${i}" data-position="-1" aria-pressed="${c.position < 0}"`)}</div>`).join('') : empty('还没有加入角色', 'V4 / 4.5 可以给每个角色单独写外貌，并指定在画面里的大致位置。', 'person'))
      + `<div class="actions">${btn('add-char', icon('add') + '从角色里添加', 'secondary')}${btn('add-custom', icon('add') + '手动添加', 'secondary')}</div>`;
    if (tab === 'params') body = `
      <div class="group pad">
        ${field('模型', select('model', d.params.model, api.drawCatalog.models.map(m => [m, m])))}
        <div class="field"><span>尺寸</span><div class="size-chips">${SIZES.map(([k, label, w, h]) => `<button data-action="size" data-size="${k}" aria-pressed="${size === k}" ${d.guard && w * h > 1048576 ? 'disabled' : ''}><i style="width:${w / 100}px;height:${h / 100}px"></i>${label}<small>${w}×${h}</small></button>`).join('')}</div></div>
        <div class="field"><div class="meter-label"><span>步数${d.guard ? ' · 免费档最多 28' : ''}</span><output>${d.params.steps}</output></div><input class="slider" type="range" data-param="steps" min="1" max="${d.guard ? 28 : 50}" value="${d.params.steps}" aria-label="步数"></div>
        <div class="field"><div class="meter-label"><span>提示词相关性 CFG</span><output>${d.params.scale.toFixed(1)}</output></div><input class="slider" type="range" data-param="scale" min="0" max="10" step="0.1" value="${d.params.scale}" aria-label="CFG"></div>
        ${field('采样器', select('sampler', d.params.sampler, api.drawCatalog.samplers.map(m => [m, m])))}
        ${field('噪声调度', select('schedule', d.params.schedule, api.drawCatalog.schedules.map(m => [m, m])))}
        <div class="field"><span>种子${help('填 -1 或留空表示每次随机。')}</span><div class="inline-row">${input('seed', seed >= 0 ? seed : '', 'number', 'min="-1" placeholder="随机"')}${btn('dice', icon('dice'), 'round-button', 'aria-label="随机一个种子"')}</div></div>
        ${toggle('variety', 'Variety+', d.params.variety, '让构图更多变，适合 V4 / 4.5。')}
      </div>
      <div class="group">${toggle('guard', '免费档守卫', d.guard, '开启时步数不超过 28、尺寸不超过 1024×1024，不会发出扣 Anlas 的请求。关闭后，会扣点的生成每次都先问你。')}</div>`;
    if (tab === 'chat') body = `
      <div class="group">${toggle('enabled', '正文出图', d.enabled, '开启后，会把「预设 · 绘图」里的出图规则加进聊天请求，让模型在正文里写出图标签。')}${toggle('auto', '新回复自动出图', d.auto, '只在免费档内自动画；超出免费档或读不到订阅时，正文里会显示“点击生成”。')}</div>
      <div class="group pad"><p class="hint" style="padding:6px 0">模型写的标签长这样：</p><pre class="code-preview">${esc(api.picTagFormat)}</pre><p class="hint" style="padding:0">插件识别后拼上当前画风的固定串，再补上出场角色的外貌 tag（在角色 App 里填写），交给 NovelAI。图片会上传到酒馆，并存进相册。</p></div>
      <div class="actions">${btn('open-presets', icon('edit') + '编辑出图规则', 'secondary')}</div>`;
    const sub = subscription ? `${TIERS[subscription.tier] || '订阅'} · ${subscription.anlas} Anlas` : keyed ? '读取中' : '';
    v.draw(heading('绘图', keyed ? `<span class="chip">${esc(sub)}</span>` : '', 'NovelAI')
      + (keyed ? '' : `<div class="banner">${icon('key')}<span>还没有填写 NovelAI 密钥。</span>${btn('go-key', '去填写', 'chip-button')}</div>`)
      + `<div class="draw-meta">${btn('pick-style', icon('layers') + esc(style().name) + icon('down'), 'chip-button')}${costChip(q)}</div>
        <div class="canvas-card"><div class="canvas-main${main ? '' : ' empty'}" style="aspect-ratio:${p.width}/${p.height}">${main ? `<img src="${esc(main)}" alt="生成的图片">` : `<span>${p.width} × ${p.height}<br>还没有图</span>`}${busy ? '<span class="canvas-busy">NovelAI 正在画……</span>' : ''}</div>
          ${results.length ? `<div class="canvas-side">${thumbs.map((url, i) => `<button class="thumb" data-action="thumb" data-index="${i}" aria-pressed="${i === current}" aria-label="第 ${i + 1} 张">${url ? `<img src="${esc(url)}" alt="">` : ''}</button>`).join('')}</div>` : ''}</div>
        ${shown ? `<p class="hint canvas-meta">${esc(shown.params.model)} · ${shown.params.width}×${shown.params.height} · ${shown.params.steps} 步 · 种子 ${shown.seed}</p>` : ''}
        <div class="draw-actions">${btn('insert', icon('insert') + '插入正文', 'secondary', shown ? '' : 'disabled')}${btn('wallpaper', icon('image') + '设为壁纸', 'secondary', shown ? '' : 'disabled')}${btn('reuse-seed', icon('dice') + '用这个种子', 'secondary', shown ? '' : 'disabled')}</div>
        <details data-group="style" class="style-card"><summary>${icon('paint')}画风 · ${esc(s.name)}<span class="save-state" data-style-state>${styleDraft ? '未保存' : ''}</span></summary><div>
          ${field('画师串', textArea('artist', s.artist, 'class="code" rows="2" data-style-field placeholder="例如 artist:wlop, artist:ciloranko"'))}
          ${field('固定正面', textArea('positive', s.positive, 'class="code" rows="2" data-style-field'))}
          ${field('固定负面', textArea('negative-fixed', s.negative, 'class="code" rows="2" data-style-field'))}
          <div class="actions" style="margin-top:0">${btn('save-style', '保存画风', 'primary')}</div>
          <p class="hint" style="padding:0">正文出图和这里单独生图都会带上这三栏。</p></div></details>
        <div class="segmented draw-tabs">${tabs.map(([k, l]) => `<button data-action="tab" data-tab="${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</div>
        ${body}
        <div class="savebar">${btn('generate', busy ? '正在画……' : q.free === false ? icon('alert') + '生成（会扣 Anlas）' : icon('paint') + '生成', 'primary', busy || !keyed ? 'disabled' : '')}</div>`);
  }

  async function refreshSubscription(force = false) {
    if (!api.keyStatus('nai')) { subscription = null; return; }
    try { subscription = await api.naiSubscription(force); }
    catch (error) { subscription = null; ctx.notify(error.message); }
    if (!v.disposed) render();
  }

  // Loads a picture request sent from the chat ("在绘图中打开").
  v.load = request => {
    if (!request) return;
    prompt = request.tag || request.prompt || '';
    seed = Number.isInteger(request.seed) ? request.seed : -1;
    const routes = api.getState().routes;
    characters = (request.characters || []).map(c => ({name: routes.find(r => r.appearance?.trim() === c.prompt?.trim())?.name || '角色', prompt: c.prompt, position: c.position ?? -1}));
    tab = 'prompt';
    render();
  };
  v.refresh = () => { styleDraft = null; render(); refreshSubscription(); };
  v.onDraw = event => { if (event.subscription) { subscription = event.subscription; render(); } };
  const dispose = v.dispose;
  v.dispose = () => { epoch++; for (const url of urls.values()) ctx.win.URL.revokeObjectURL(url); urls.clear(); dispose(); };

  v.on('input', '[data-field]', el => {
    const key = el.dataset.field;
    if (key === 'prompt') prompt = el.value;
    else if (key === 'negative') negative = el.value;
    else if (key === 'char') characters[Number(el.dataset.index)].prompt = el.value;
    else if (el.hasAttribute('data-style-field')) {
      styleDraft ||= {...style()};
      styleDraft[key === 'negative-fixed' ? 'negative' : key] = el.value;
      const mark = v.root.querySelector('[data-style-state]');
      if (mark) mark.textContent = '未保存';
    } else if (key === 'seed') seed = el.value === '' ? -1 : Math.max(-1, Math.floor(Number(el.value) || -1));
  });
  v.on('input', '[data-param]', el => { el.previousElementSibling.querySelector('output').textContent = el.dataset.param === 'scale' ? Number(el.value).toFixed(1) : el.value; });
  v.on('change', '[data-param]', el => { api.saveDraw({params: {[el.dataset.param]: Number(el.value)}}); render(); });
  v.on('change', 'select[data-field]', el => { api.saveDraw({params: {[el.dataset.field]: el.value}}); render(); });
  v.on('change', 'input.switch[data-field]', el => {
    const key = el.dataset.field;
    if (key === 'variety') api.saveDraw({params: {variety: el.checked}});
    else api.saveDraw({[key]: el.checked});
    render();
  });
  v.on('click', '[data-action]', async el => {
    const index = Number(el.dataset.index);
    switch (el.dataset.action) {
      case 'tab': tab = el.dataset.tab; render(); break;
      case 'size': { const [, , width, height] = SIZES.find(s => s[0] === el.dataset.size); api.saveDraw({params: {width, height}}); render(); break; }
      case 'dice': seed = Math.floor(Math.random() * 4294967295); render(); break;
      case 'thumb': current = index; render(); break;
      case 'reuse-seed': seed = results[current].seed; tab = 'params'; render(); ctx.notify('已填入这张图的种子'); break;
      case 'go-key': ctx.open('engines'); ctx.editEngine?.('nai'); break;
      case 'open-presets': ctx.open('presets'); ctx.showPresetKind?.('draw'); break;
      case 'position': characters[index].position = Number(el.dataset.position); render(); break;
      case 'remove-char': characters.splice(index, 1); render(); break;
      case 'add-custom': characters.push({name: '角色', prompt: '', position: -1}); render(); break;
      case 'add-char': pickCharacter(); break;
      case 'suggest':
        await v.busy(el, async () => {
          el.innerHTML = icon('spin') + '正在读剧情…';
          prompt = await api.suggestPrompt();
          render();
          ctx.notify('已根据最近的剧情写好提示词，可以再改');
        });
        break;
      case 'pick-style': pickStyle(); break;
      case 'save-style': {
        if (!styleDraft) { ctx.notify('画风没有改动'); break; }
        api.saveStyle(styleDraft);
        styleDraft = null;
        render();
        ctx.notify('画风已保存');
        break;
      }
      case 'generate': await generate(); break;
      case 'insert': insert(); break;
      case 'wallpaper': await api.savePhone({wallpaper: {kind: 'photo', photoId: results[current].photoId}}); ctx.notify('已设为壁纸'); break;
    }
  });

  async function generate() {
    const s = styleDraft || style(), q = quote();
    let allowPaid = false;
    if (q.free === false) {
      if (!await ctx.confirm('这张图会扣 Anlas', `按当前参数和订阅，这次生成要消耗 Anlas${subscription ? `（现有 ${subscription.anlas}）` : ''}。实际扣多少以 NovelAI 结算为准。`)) return;
      allowPaid = true;
    }
    busy = true;
    render();
    try {
      const result = await api.generateImage({
        prompt: [s.artist, s.positive, prompt].map(x => (x || '').trim()).filter(Boolean).join(', '),
        negative: [s.negative, negative].map(x => (x || '').trim()).filter(Boolean).join(', '),
        characters: characters.filter(c => c.prompt.trim()).map(c => ({prompt: c.prompt, position: c.position})),
        params: {...state().params, seed}, allowPaid, name: 'NovelAI'
      });
      results.unshift(result);
      results = results.slice(0, 6);
      current = 0;
      if (allowPaid) refreshSubscription(true);
    } catch (error) { ctx.notify(error.message); }
    busy = false;
    render();
  }

  function pickCharacter() {
    const routes = api.getState().routes;
    const d = ctx.dialog('从角色里添加', routes.length
      ? `<div class="group">${routes.map(r => `<button class="list-row" data-pick="${esc(r.id)}">${avatar(r.name, r.voice ? r.engine : 'none', 36)}<span><strong>${esc(r.name)}</strong><small>${esc(r.appearance?.trim() || '还没有填写外貌 tag')}</small></span>${icon('add')}</button>`).join('')}</div>`
      : '<p class="hint">还没有角色。可以先在角色 App 里新增，并填写外貌 tag。</p>');
    d.body.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      const r = routes.find(x => x.id === b.dataset.pick);
      characters.push({name: r.name, prompt: r.appearance || '', position: -1});
      d.close();
      render();
    });
  }

  function pickStyle() {
    const d0 = state();
    const d = ctx.dialog('画风预设', `<div class="group">${d0.styles.map(s => `<button class="list-row" data-style="${esc(s.id)}"><span><strong>${esc(s.name)}</strong><small class="mono">${esc(s.artist || '没有画师串')}</small></span>${s.id === d0.activeStyle ? plate('使用中') : icon('next')}</button>`).join('')}</div>
      <div class="actions">${btn('new-style', icon('add') + '新建画风', 'secondary')}${d0.styles.length > 1 ? btn('delete-style', icon('trash') + '删除当前', 'danger') : ''}</div>`);
    d.body.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      try {
        if (b.dataset.style) { api.saveDraw({activeStyle: b.dataset.style}); styleDraft = null; d.close(); render(); }
        if (b.dataset.action === 'new-style') {
          const created = api.saveStyle({name: '新画风 ' + (d0.styles.length + 1), artist: '', positive: style().positive, negative: style().negative});
          api.saveDraw({activeStyle: created.id});
          styleDraft = null; d.close(); render();
          ctx.notify('已新建画风，在下面填写画师串');
        }
        if (b.dataset.action === 'delete-style') {
          d.close();
          if (await ctx.confirm('删除当前画风？', `「${style().name}」会被删除，其他画风保留。`)) { api.deleteStyle(state().activeStyle); styleDraft = null; render(); }
        }
      } catch (error) { ctx.notify(error.message); }
    });
  }

  function insert() {
    const shown = results[current];
    let rows;
    try { rows = api.recentMessages(); } catch (error) { ctx.notify(error.message); return; }
    const d = ctx.dialog('插入到哪条消息？', rows.length
      ? `<div class="group">${rows.map(r => `<button class="list-row" data-message="${r.id}"><span class="mono muted" style="width:40px;flex:0 0 40px">#${r.id}</span><span><strong>${esc(r.name)}</strong><small>${esc(r.preview || '（空消息）')}</small></span>${icon('next')}</button>`).join('')}</div><p class="hint">图片会上传到酒馆，挂在这条消息上。</p>`
      : '<p class="hint">当前聊天还没有消息。</p>');
    d.body.addEventListener('click', async e => {
      const b = e.target.closest('[data-message]');
      if (!b) return;
      b.disabled = true;
      try { await api.insertImage(Number(b.dataset.message), shown.photoId); d.close(); ctx.notify('已插入到 #' + b.dataset.message); }
      catch (error) { b.disabled = false; ctx.notify(error.message); }
    });
  }

  render();
  refreshSubscription();
  return v;
}
