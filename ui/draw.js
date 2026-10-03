import {createView, esc, btn, field, input, select, textArea, toggle, heading, help, groupTitle, plate, avatar, empty} from './common.js';
import {icon} from './icons.js';
import {filterLoraRows, sortLoraRows, loraFacets, loraKey, LORA_SORTS} from '../core/lora-manager.js';
import {openImageViewer} from '../image-viewer.js';
import {downloadAction} from '../download.js';
import {vibePanel} from './vibes.js';

const SIZES = [['portrait', '竖图', 832, 1216], ['landscape', '横图', 1216, 832], ['square', '方图', 1024, 1024], ['tall', '大竖图', 1024, 1536]];
/** Pictures kept in the column beside the canvas (this visit of the app; all of them are also in the album). */
const MAX_RESULTS = 30;
const TIERS = {0: '未订阅', 1: 'Tablet', 2: 'Scroll', 3: 'Opus'};
const POSITION = i => i < 0 ? '自动' : 'ABCDE'[i % 5] + (Math.floor(i / 5) + 1);

export function drawApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'draw'), urls = new Map();
  let tab = 'prompt', prompt = '', negative = '', characters = [], seed = -1, results = [], current = -1, newest = false, busy = false, subscription = null, styleDraft = null, epoch = 0;
  // ComfyUI: models, samplers and schedulers read from it (null until 读取 is pressed).
  let comfyInfo = null;
  // ComfyUI LoRA: the browsable list, kept between openings of the 添加 LoRA dialog ({error} when nothing could be
  // read; the backend caches the reads themselves, so 刷新 is the only thing that goes back to ComfyUI).
  let loraCat = null;
  const vibes = vibePanel({ctx, api, root: () => v.root, rerender: () => render()});
  let queue = api.drawQueue?.() || [], cloudError = api.cloudQueueError?.() || '', cloudNote = null;
  const jobState = j => j.state === 'running' ? '正在画' : j.state === 'busy' ? `账号正忙，稍后重试（第 ${j.attempt} 次）` : j.state === 'spacing' ? '马上开始'
    : j.state === 'remote' ? (j.cloud?.position > 0 ? `云端排队，前面 ${j.cloud.position} 位` : j.cloud?.cooldown > 5000 ? `大家一起等 ${Math.ceil(j.cloud.cooldown / 1000)} 秒` : '云端马上轮到') : `第 ${j.position + 1} 位`;
  const queueCard = () => (queue.length || cloudError) ? `<div class="group pad queue-card"><div class="row-heading"><strong style="flex:1">排队 · ${queue.length} 张</strong>${queue.length ? btn('cancel-all', '全部取消', 'text-button') : ''}</div>${cloudError && state().queue.cloud.enabled ? `<p class="hint error-copy" style="padding:0 0 6px">${esc(cloudError)}，这次按本机排队</p>` : ''}${queue.map(j => `<div class="setting-row"><span>${esc(j.label || '图片')}</span><small>${esc(jobState(j))}</small>${j.state === 'running' ? '' : btn('cancel-job', icon('close'), 'text-button', `data-key="${esc(j.key)}" aria-label="取消这张"`)}</div>`).join('')}</div>` : '';
  const state = () => api.getState().draw;
  const eng = () => state().engine, engineName = (e = eng()) => api.drawCatalog.engineNames?.[e] || 'NovelAI';
  // Cloud queue fields as typed; saved when an input changes or a button uses them.
  const cloudFields = () => {
    const saved = state().queue.cloud, field = key => v.root.querySelector(`[data-cloud=${key}]`)?.value;
    return {enabled: saved.enabled, kind: saved.kind, url: (field('url') ?? saved.url).trim(), room: (field('room') ?? saved.room).trim()};
  };
  // Each engine remembers its own 画风; GPT and ComfyUI use NovelAI's until one is picked for them.
  const styleId = () => { const d = state(); return (d.engine === 'nai' ? '' : d[d.engine]?.style) || d.activeStyle; };
  const style = () => { const d = state(); return d.styles.find(s => s.id === styleId()) || d.styles[0]; };
  // A result as a file: NovelAI_种子.png.
  const resultFile = async result => { const photo = await api.getPhoto(result.photoId); if (!photo) throw Error('这张图已经不在相册里了'); return {source: photo.blob, name: `${(api.drawCatalog.engineNames?.[result.engine] || 'NovelAI').replace(/\s+/g, '')}_${result.seed >= 0 ? result.seed : photo.name}`}; };
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
    return api.drawQuote(d.engine === 'nai' ? {...d.params, ...(seed >= 0 ? {seed} : {})} : seed >= 0 ? {seed} : {});
  }
  function costChip(q) {
    const e = eng();
    if (!api.drawReady()) return `<span class="chip" data-engine="none">${e === 'comfy' ? '未填地址' : '未填密钥'}</span>`;
    if (e === 'gpt') return `<span class="chip${q.free === false ? ' warn' : ''}">${icon('alert')}每张都要花钱${q.free === false ? '' : ' · 不先问'}</span>`;
    if (e === 'comfy') return `<span class="chip">${icon('lock')}自己的 ComfyUI · 不花钱</span>`;
    if (q.free === true) return `<span class="chip">${icon(q.guard ? 'lock' : 'unlock')}${q.v5 ? `V5 免费额度 ${q.usage.percent}%` : '免费档 · 0 Anlas'}</span>`;
    if (q.free === false) return `<span class="chip warn">${icon('alert')}${q.v5 && q.usage && q.params.steps <= 28 && q.params.width * q.params.height <= 1048576 ? 'V5 免费额度用完 · 会扣 Anlas' : '会扣 Anlas'}</span>`;
    return `<span class="chip" data-engine="none">${icon(q.guard ? 'lock' : 'unlock')}免费档内 · 订阅未确认</span>`;
  }

  async function render() {
    const ticket = ++epoch, d = state(), e = d.engine, s = styleDraft || style(), q = quote(), p = q.params, keyed = api.drawReady();
    if (e !== 'nai' && tab === 'vibe') tab = 'prompt';
    if (e !== 'comfy' && tab === 'lora') tab = 'prompt';
    const shown = results[current];
    const main = shown ? await urlFor(shown.photoId) : '';
    const thumbs = await Promise.all(results.map(r => urlFor(r.photoId)));
    if (v.disposed || ticket !== epoch) return;
    const size = SIZES.find(([, , w, h]) => w === d.params.width && h === d.params.height)?.[0] || 'custom';
    const tabs = [['prompt', '提示词'], ['chars', '角色'], ['params', '参数'], ...(e === 'comfy' ? [['lora', 'LoRA']] : []), ...(e === 'nai' ? [['vibe', 'Vibe']] : []), ['chat', '正文出图']];
    v.root.dataset.engine = e;
    let body = '';
    if (tab === 'prompt') body = `
      <div class="group pad">${field('这张图的提示词', textArea('prompt', prompt, 'rows="4" placeholder="英文 tag，逗号分隔，例如 2girls, rainy day, cafe window, sharing an umbrella"'), e === 'gpt' ? '会和画风的固定正面、每个角色的外貌一起整理成一段英文描述发给 GPT。画师串、权重括号和负面不会发给 GPT。' : e === 'comfy' ? '实际发送：画师串 + 固定正面 + 这里的提示词，后面接上每个角色的外貌；NovelAI 的权重写法会自动换成 ComfyUI 的。' : '实际发送：画师串 + 固定正面 + 这里的提示词。')}
        <div class="actions" style="margin-top:0">${btn('suggest', icon('wand') + '从剧情生成', 'secondary')}</div>
        ${e === 'gpt' ? '' : field('这张图额外的负面', textArea('negative', negative, 'rows="2" placeholder="可以留空，会和固定负面合在一起"'))}</div>`;
    if (tab === 'chars') body = (characters.length ? characters.map((c, i) => `
      <div class="group pad draw-char" data-engine="${ctx.engineOf(c.name)}"><div class="row-heading">${avatar(c.name, ctx.engineOf(c.name), 30)}<strong style="flex:1">${esc(c.name)}</strong><span class="chip">位置 ${POSITION(c.position)}</span>${btn('remove-char', icon('trash'), 'text-button', `data-index="${i}" aria-label="移除 ${esc(c.name)}"`)}</div>
        <div class="char-body">${textArea('char', c.prompt, `data-index="${i}" rows="3" aria-label="${esc(c.name)} 的提示词"`)}
          <div class="pos-grid" aria-label="画面位置">${Array.from({length: 25}, (_, k) => `<button data-action="position" data-index="${i}" data-position="${k}" aria-pressed="${c.position === k}" aria-label="位置 ${POSITION(k)}"></button>`).join('')}</div></div>
        ${btn('position', '让模型自己决定位置', 'text-button', `data-index="${i}" data-position="-1" aria-pressed="${c.position < 0}"`)}</div>`).join('') : empty('还没有加入角色', e === 'gpt' ? '每个角色的外貌和在画面里的位置，会写进给 GPT 的描述里。' : e === 'comfy' ? 'ComfyUI 没有分角色的提示词：每个人的外貌接在提示词后面，位置不起作用。' : 'V4 / 4.5 可以给每个角色单独写外貌，并指定在画面里的大致位置。', 'person'))
      + `<div class="actions">${btn('add-char', icon('add') + '从角色里添加', 'secondary')}${btn('add-custom', icon('add') + '手动添加', 'secondary')}</div>`;
    if (tab === 'params' && e === 'gpt') body = gptParams(d.gpt);
    if (tab === 'params' && e === 'comfy') body = comfyParams(d.comfy);
    if (tab === 'lora' && e === 'comfy') body = loraTab();
    if (tab === 'params' && e === 'nai') body = `
      <div class="group pad">
        ${field('模型', select('model', d.params.model, api.drawCatalog.models.map(m => [m, api.drawCatalog.modelNames[m] || m])), /^nai-diffusion-5/.test(d.params.model) ? 'V5 对 Opus 不是无限的：免费档内的图用一份会慢慢恢复的免费额度，用完后改扣 Anlas。V4.5 及更早的模型仍然无限。' : '')}
        <div class="field"><span>尺寸</span><div class="size-chips">${SIZES.map(([k, label, w, h]) => `<button data-action="size" data-size="${k}" aria-pressed="${size === k}" ${d.guard && w * h > 1048576 ? 'disabled' : ''}><i style="width:${w / 100}px;height:${h / 100}px"></i>${label}<small>${w}×${h}</small></button>`).join('')}</div></div>
        <div class="field"><div class="meter-label"><span>步数${d.guard ? ' · 免费档最多 28' : ''}</span><output>${d.params.steps}</output></div><input class="slider" type="range" data-param="steps" min="1" max="${d.guard ? 28 : 50}" value="${d.params.steps}" aria-label="步数"></div>
        <div class="field"><div class="meter-label"><span>提示词相关性 CFG</span><output>${d.params.scale.toFixed(1)}</output></div><input class="slider" type="range" data-param="scale" min="0" max="10" step="0.1" value="${d.params.scale}" aria-label="CFG"></div>
        ${field('采样器', select('sampler', d.params.sampler, api.drawCatalog.samplers.map(m => [m, m])))}
        ${field('噪声调度', select('schedule', d.params.schedule, api.drawCatalog.schedules.map(m => [m, m])))}
        <div class="field"><span>种子${help('填 -1 或留空表示每次随机。')}</span><div class="inline-row">${input('seed', seed >= 0 ? seed : '', 'number', 'min="-1" placeholder="随机"')}${btn('dice', icon('dice'), 'round-button', 'aria-label="随机一个种子"')}</div></div>
        ${/^nai-diffusion-5/.test(d.params.model) ? '' : toggle('variety', 'Variety+', d.params.variety, '让构图更多变，适合 V4 / 4.5。')}
      </div>
      <div class="group">${toggle('guard', '免费档守卫', d.guard, '开启时步数不超过 28、尺寸不超过 1024×1024，不会发出扣 Anlas 的请求。关闭后，会扣点的生成每次都先问你。')}</div>
      ${groupTitle('排队', help('一个 NovelAI 账号同一时间只能画一张。几个人共用账号时，同时请求会得到 429，太频繁还可能被风控。\n\n插件里所有出图都排成一队，一张画完再发下一张（同一个浏览器里开的几个酒馆页面也会互相等）；两张之间留出间隔；遇到 429 就等一会儿再试，等待时间一次比一次长。'))}
      <div class="group pad">
        <div class="field"><div class="meter-label"><span>两张图之间至少间隔</span><output>${d.queue.gap} 秒</output></div><input class="slider" type="range" data-queue="gap" min="0" max="60" value="${d.queue.gap}" aria-label="两张图之间的间隔秒数"></div>
        <div class="field"><div class="meter-label"><span>账号正忙（429）时重试</span><output>${d.queue.retries} 次</output></div><input class="slider" type="range" data-queue="retries" min="0" max="10" value="${d.queue.retries}" aria-label="429 重试次数"></div>
      </div>
      ${groupTitle('云端队列', help('几个人共用一个 NovelAI 账号时，让所有人排同一条队：前面有人在画就先等着。\n\n两种队列服务：\n· 按密钥排队：已经有的队列服务（比如智绘姬用的那个）。不用房间码，用同一个 NovelAI 密钥的人自动排进同一条队，也能和用智绘姬的朋友一起排。插件只发送密钥的 SHA-256 摘要（算不回密钥）、这台浏览器的随机编号和每张图的随机编号。\n· 房间码：自己在 Cloudflare 免费部署的队列（插件目录 cloud-queue/部署说明.md），大家填同一个地址和房间码；撞上 429 时全房间一起等。只发送房间码和排队号。\n\n两种都看不到密钥、提示词和图片。连不上时照常出图，只是退回本机排队。'))}
      <div class="group pad">
        ${toggle('cloud', '使用云端队列', d.queue.cloud.enabled)}
        <div class="field"><span>队列类型</span><div class="segmented" style="margin:0">${[['keyhash', '按密钥排队'], ['room', '房间码']].map(([k, l]) => `<button data-action="cloud-kind" data-kind="${k}" aria-pressed="${d.queue.cloud.kind === k}">${l}</button>`).join('')}</div></div>
        <div class="field"><span>队列地址</span><input data-cloud="url" type="url" value="${esc(d.queue.cloud.url)}" placeholder="${d.queue.cloud.kind === 'keyhash' ? 'https://……hf.space' : 'https://st-iphonie-queue.你的名字.workers.dev'}" autocomplete="off" aria-label="队列地址"></div>
        ${d.queue.cloud.kind === 'keyhash' ? '<p class="hint" style="padding:0">不用房间码：用同一个 NovelAI 密钥的人会自动排进同一条队。</p>' : `<div class="field"><span>房间码</span><div class="inline-row"><input data-cloud="room" value="${esc(d.queue.cloud.room)}" placeholder="16–64 位字母或数字" autocomplete="off" aria-label="房间码">${btn('new-room', '生成', 'chip-button')}</div></div>`}
        <div class="actions" style="margin-top:0">${btn('test-cloud', icon('refresh') + '测试连接', 'secondary')}</div>
        ${cloudNote ? `<p class="hint${cloudNote.ok ? '' : ' error-copy'}" style="padding:0">${esc(cloudNote.text)}</p>` : ''}
      </div>`;
    if (tab === 'vibe') body = vibes.html();
    if (tab === 'chat') body = `
      ${d.enabled ? '' : `<div class="banner">${icon('image')}<span>正文出图没有开启，在「设置 · 绘图」里打开。</span>${btn('go-settings', '去打开', 'chip-button')}</div>`}<div class="group">${toggle('auto', '新回复自动出图', d.auto, '只自动画不花钱的：NovelAI 免费档内的图、ComfyUI 的图；GPT 生图在「每张先问」关掉后也会自动画。其余的正文里会显示“点击生成”。')}${toggle('fold', '正文图片默认收起', d.fold, '收起后正文里只留一个小缩略图，点开再看，手机上不占地方。每张图也可以单独收起或展开。')}</div>
      <div class="field"><span>配图方式${help('单独配图：正文模型只管写故事；回复写完后，插件用同一个模型再单独请求一次，读这条回复、挑画面、写出图块，再把图插到对应的段落后面。出图规则不会挤占正文，张数和格式更稳，每条回复多一次请求。\n\n正文里顺手写：把出图规则加进正文请求，模型写故事时顺手写出图块。只要一次请求，但规则较长，偶尔会影响正文或漏写。')}</span><div class="segmented" style="margin:0">${[['separate', '回复后单独配图'], ['inline', '正文里顺手写']].map(([k, l]) => `<button data-action="mode" data-mode="${k}" aria-pressed="${d.mode === k}">${l}</button>`).join('')}</div></div>
      <div class="group">${toggle('strip', '发给模型时去掉旧出图块', d.strip, '出图块留在聊天记录里（图片靠它显示），但之后每次请求模型时会把它们去掉，省下上下文。')}</div>
      <div class="actions">${btn('plan-latest', icon('wand') + '给最新回复配图', 'secondary', api.planLatestPictures && d.enabled ? '' : 'disabled')}</div>
      <div class="group pad"><p class="hint" style="padding:6px 0">出图块长这样（一张图一块）：${help('场景和每个人分开写：人数、镜头、光线放场景；表情、视线、动作放各自的角色行。插件把画风固定串接在场景前面，把角色 App 里的固定外貌补进对应的角色行，再交给选中的绘图引擎（GPT 会整理成英文描述，ComfyUI 会合成一条提示词）。新角色第一次出现时，模型写的「新外貌」会自动存进角色 App。图片会上传到酒馆，并存进相册。')}</p><pre class="code-preview">${esc(api.picTagFormat)}</pre></div>
      <p class="hint">每条回复固定出 ${(d.presets.find(p => p.id === d.activePreset) || d.presets[0]).count} 张图，在出图规则里改张数。</p><div class="actions">${btn('open-presets', icon('edit') + '编辑出图规则', 'secondary')}</div>`;
    const loraOn = d.comfy.loras.filter(l => l.on !== false).length;
    const sub = e === 'gpt' ? d.gpt.model : e === 'comfy' ? (d.comfy.model || '还没选模型').replace(/\.[^.]*$/, '') + (loraOn ? ` · LoRA ${loraOn}` : '') : subscription ? `${TIERS[subscription.tier] || '订阅'} · ${subscription.anlas} Anlas` : keyed ? '读取中' : '';
    v.draw(heading('绘图', keyed ? `<span class="chip">${esc(sub)}</span>` : '', engineName(e))
      + `<div class="segmented draw-engines" role="group" aria-label="用哪个画">${api.drawCatalog.engines.map(k => `<button data-action="draw-engine" data-pick="${k}" aria-pressed="${k === e}">${esc(engineName(k))}</button>`).join('')}</div>`
      + (keyed ? '' : `<div class="banner">${icon('key')}<span>${esc(api.drawMissing())}。</span>${btn('go-key', '去填写', 'chip-button')}</div>`)
      + queueCard()
      + `<div class="draw-meta">${btn('pick-style', icon('layers') + esc(style().name) + icon('down'), 'chip-button')}${costChip(q)}</div>
        <div class="canvas-card"><div class="canvas-main${main ? '' : ' empty'}" style="aspect-ratio:${p.width}/${p.height}">${main ? `<button type="button" class="canvas-zoom" data-action="zoom" aria-label="放大查看"><img src="${esc(main)}" alt="生成的图片"></button>` : `<span>${p.width} × ${p.height}<br>还没有图</span>`}${busy ? `<span class="canvas-busy">${esc(engineName(e))} 正在画……</span>` : ''}</div>
          ${results.length ? `<div class="canvas-side" data-keep-scroll="results">${thumbs.map((url, i) => `<button class="thumb" data-action="thumb" data-index="${i}" aria-pressed="${i === current}" aria-label="第 ${i + 1} 张">${url ? `<img src="${esc(url)}" alt="">` : ''}</button>`).join('')}</div>` : ''}</div>
        ${shown ? `<p class="hint canvas-meta">${[shown.params.model, `${shown.params.width}×${shown.params.height}`, shown.params.steps ? shown.params.steps + ' 步' : '', shown.seed >= 0 ? '种子 ' + shown.seed : ''].filter(Boolean).map(esc).join(' · ')}</p>` : ''}
        <details data-group="style" class="style-card"><summary>${icon('paint')}画风 · ${esc(s.name)}<span class="save-state" data-style-state>${styleDraft ? '未保存' : ''}</span></summary><div>
          ${field('名字', input('name', s.name, 'text', 'data-style-field maxlength="40"'))}
          ${field('画师串', textArea('artist', s.artist, 'class="code" rows="2" data-style-field placeholder="例如 artist:wlop, artist:ciloranko"'))}
          ${field('固定正面', textArea('positive', s.positive, 'class="code" rows="2" data-style-field'))}
          ${field('固定负面', textArea('negative-fixed', s.negative, 'class="code" rows="2" data-style-field'))}
          <div class="actions" style="margin-top:0">${btn('save-style', '保存画风', 'primary')}</div>
          <p class="hint" style="padding:0">正文出图和这里单独生图都会带上这三栏。每个引擎记住自己用的画风，现在这个是 ${esc(engineName(e))} 用的${e === 'gpt' ? '；GPT 不读画师串和固定负面' : ''}。</p></div></details>
        <div class="segmented draw-tabs">${tabs.map(([k, l]) => `<button data-action="tab" data-tab="${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</div>
        ${body}
        <div class="savebar">${btn('generate', busy ? '正在画……' : q.free === false ? icon('alert') + (e === 'gpt' ? '生成（要花钱）' : '生成（会扣 Anlas）') : icon('paint') + '生成', 'primary', busy || !keyed ? 'disabled' : '')}</div>`);
    // A new picture goes on top of the column: show it.
    if (newest) { newest = false; const side = v.root.querySelector('.canvas-side'); if (side) side.scrollTop = 0; }
  }

  /** GPT: quality, default 画幅 (正文出图 follows each block's own) and whether to ask before every paid picture. */
  function gptParams(g) {
    const seg = (action, value, list) => `<div class="segmented" style="margin:0">${list.map(([k, l]) => `<button data-action="${action}" data-value="${k}" aria-pressed="${value === k}">${l}</button>`).join('')}</div>`;
    return `<div class="group pad">
        <div class="setting-row"><span>模型</span><small>${esc(g.model)}</small>${btn('go-key', '在引擎卡包里改', 'text-button')}</div>
        <div class="field"><span>画质${help('low 最便宜最快，high 最贵最细。auto 让 GPT 自己定。dall-e-3 只分普通和高清（high）。')}</span>${seg('gpt-quality', g.quality, [['auto', '自动'], ['low', '低'], ['medium', '中'], ['high', '高']])}</div>
        <div class="field"><span>画幅${help('这里单独生图用的画幅。正文出图按每个出图块写的画幅来。GPT 只能画 1024×1024、1024×1536、1536×1024 这几种（dall-e-3 是 1792 的）。')}</span>${seg('gpt-orientation', g.orientation, [['portrait', '竖图'], ['landscape', '横图'], ['square', '方图']])}</div>
      </div>
      <div class="group">${toggle('gptAsk', '每张先问', g.ask, 'GPT 生图每张都要花钱。打开时，每张图画之前都先问你，新回复也不会自动画（正文里显示“点击生成”）。关掉后不再问，新回复会自动画，费用自己留意。')}</div>`;
  }
  /** ComfyUI: model, size, steps, CFG, sampler, scheduler and seed (the workflow decides what it uses). */
  function comfyParams(c) {
    const info = comfyInfo, size = SIZES.find(([, , w, h]) => w === c.width && h === c.height)?.[0] || 'custom';
    const choose = (key, value, list, placeholder) => list?.length
      ? select(key, value, [...(list.includes(value) || !value ? [] : [[value, value]]), ...list.map(x => typeof x === 'string' ? [x, x] : [x.value, x.text])])
      : input(key, value, 'text', `autocomplete="off" spellcheck="false" placeholder="${placeholder}"`);
    return `<div class="group pad">
        ${field('模型', choose('comfy-model', c.model, info?.models, '点「读取」，或直接填文件名'))}
        <div class="actions" style="margin-top:0">${btn('comfy-read', icon('refresh') + '读取模型和采样器', 'secondary')}</div>
        ${info?.error ? `<p class="hint error-copy" style="padding:0">${esc(info.error)}</p>` : ''}
        <div class="field"><span>尺寸</span><div class="size-chips">${SIZES.map(([k, label, w, h]) => `<button data-action="comfy-size" data-size="${k}" aria-pressed="${size === k}"><i style="width:${w / 100}px;height:${h / 100}px"></i>${label}<small>${w}×${h}</small></button>`).join('')}</div></div>
        <div class="field"><div class="meter-label"><span>步数</span><output>${c.steps}</output></div><input class="slider" type="range" data-comfy="steps" min="1" max="80" value="${c.steps}" aria-label="步数"></div>
        <div class="field"><div class="meter-label"><span>提示词相关性 CFG</span><output>${c.scale.toFixed(1)}</output></div><input class="slider" type="range" data-comfy="scale" min="0" max="20" step="0.5" value="${c.scale}" aria-label="CFG"></div>
        ${field('采样器', choose('comfy-sampler', c.sampler, info?.samplers, 'euler_ancestral'))}
        ${field('噪声调度', choose('comfy-scheduler', c.scheduler, info?.schedulers, 'normal'))}
        <div class="field"><span>种子${help('填 -1 或留空表示每次随机。')}</span><div class="inline-row">${input('seed', seed >= 0 ? seed : '', 'number', 'min="-1" placeholder="随机"')}${btn('dice', icon('dice'), 'round-button', 'aria-label="随机一个种子"')}</div></div>
      </div>
      <p class="hint">这些值填进工作流的占位符（"%steps%"、"%scale%" 这些）；工作流里写死的值不受影响。地址和工作流在引擎卡包的 ComfyUI 里。</p>`;
  }
  async function readComfy() {
    try { comfyInfo = await api.comfyCatalog(); }
    catch (error) { comfyInfo = {error: error.message, models: [], samplers: [], schedulers: []}; }
    if (!v.disposed) render();
  }

  /**
   * The LoRA tab: one card per stack the workflow offers. A two-pass workflow usually carries one Lora Loader
   * (LoraManager) per pass, and each card is written into its own node at request time, so the first pass and the
   * second can run different loras instead of sharing one pile. A workflow with no such node gets one card, injected
   * at the model loader exactly as before.
   */
  function loraTab() {
    const {plan, stacks} = api.comfyStages();
    const passName = i => {
      const pass = plan.passes[i];
      if (!pass) return `第 ${i + 1} 遍`;
      return `第 ${i + 1} 遍${pass.denoise < 1 ? `（降噪 ${pass.denoise}）` : ''}`;
    };
    const row = (stageKey, l, i, count) => `
      <div class="group pad">
        <div class="row-heading"><input class="switch" type="checkbox" data-lora="on" data-stage="${esc(stageKey)}" data-index="${i}" aria-label="启用 ${esc(l.name)}" ${l.on !== false ? 'checked' : ''}><strong class="mono" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(l.name)}">${esc(l.name)}</strong>${i > 0 ? btn('lora-up', icon('up'), 'text-button', `data-stage="${esc(stageKey)}" data-index="${i}" aria-label="上移 ${esc(l.name)}"`) : ''}${i < count - 1 ? btn('lora-down', icon('down'), 'text-button', `data-stage="${esc(stageKey)}" data-index="${i}" aria-label="下移 ${esc(l.name)}"`) : ''}${btn('lora-remove', icon('trash'), 'text-button', `data-stage="${esc(stageKey)}" data-index="${i}" aria-label="移除 ${esc(l.name)}"`)}</div>
        <div class="field"><div class="meter-label"><span>模型权重</span><output>${Number(l.model).toFixed(2)}</output></div><input class="slider" type="range" data-lora="model" data-stage="${esc(stageKey)}" data-index="${i}" min="0" max="1.5" step="0.05" value="${Number(l.model)}" aria-label="模型权重"></div>
        <div class="field"><div class="meter-label"><span>文本权重</span><output>${Number(l.clip).toFixed(2)}</output></div><input class="slider" type="range" data-lora="clip" data-stage="${esc(stageKey)}" data-index="${i}" min="0" max="1.5" step="0.05" value="${Number(l.clip)}" aria-label="文本权重"></div>
        <div class="field"><span>触发词${help('LoRA 的触发词会自动拼进这张图正面提示词的最前面（重复的 tag 会去掉）。点右边的按钮从 ComfyUI 的 Lora Manager 读；没装或没记录就手动填，几个词用逗号隔开。不想要拼接就清空。')}</span><div class="inline-row"><input data-lora="trigger" data-stage="${esc(stageKey)}" data-index="${i}" value="${esc(l.trigger || '')}" placeholder="留空就不拼；可点右侧按钮自动获取" autocomplete="off" spellcheck="false" aria-label="触发词">${btn('lora-fetch', icon('wand'), 'chip-button', `data-stage="${esc(stageKey)}" data-index="${i}" aria-label="自动获取触发词"`)}</div></div>
      </div>`;
    const stageCard = stage => {
      const loras = stacks[stage.key] || [];
      const feeds = plan.passes.length <= 1 ? ''
        : stage.feeds.length === plan.passes.length ? '每一遍都用'
        : `只作用于 ${stage.feeds.map(passName).join('、')}`;
      const title = [stage.kind === 'inject' ? '插在底模后' : `节点 ${stage.nodeId} · Lora Loader (LoraManager)`, feeds].filter(Boolean).join(' · ');
      const inherits = stage.upstream.length ? `<p class="hint" style="padding:0">这份栈叠在 ${stage.upstream.map(k => '节点 ' + k.split(':')[1]).join('、')} 之上：那边写进去的 LoRA 在这里照样生效。</p>` : '';
      return `<div class="group pad">
        <div class="row-heading"><strong style="flex:1">${esc(title)}</strong>${loras.filter(l => l.on !== false).length ? plate(`${loras.filter(l => l.on !== false).length} 个启用`) : ''}</div>
        ${inherits}
        ${stage.kind === 'node' ? `<p class="hint" style="padding:0">出图时写进工作流的这个节点，工作流本身不会被改。</p>` : `<p class="hint" style="padding:0">工作流里没有能装一摞 LoRA 的 Lora Loader (LoraManager) 节点，插件只能自己插一串。想让每一遍用不同的 LoRA，在 ComfyUI 里给每一遍各接一个 Lora Loader (LoraManager)。</p>`}
      </div>
      ${loras.length ? loras.map((l, i) => row(stage.key, l, i, loras.length)).join('') : `<div class="group pad"><p class="hint" style="padding:0">这一份是空的。</p></div>`}
      <div class="actions">${btn('add-lora', icon('add') + '添加 LoRA', 'secondary', `data-stage="${esc(stage.key)}"`)}</div>`;
    };
    const uncovered = plan.uncovered.length ? `<div class="group pad"><p class="hint error-copy" style="padding:0">${esc(plan.uncovered.map(passName).join('、'))}走的路径上没有 Lora Loader (LoraManager) 节点，插件管不到那几遍。想管的话，在 ComfyUI 里给那几遍各接一个。</p></div>` : '';
    return `
      <div class="group pad"><p class="hint" style="padding:0">这里的 LoRA 随改随用：每次出图，插件把启用的 LoRA 按阶段写进当前工作流（保存的工作流不会被改动），并把触发词拼进提示词。出一张图后，换个 LoRA、拖一下权重，再点「生成」就是新效果；想公平对比就把种子固定住。</p></div>
      ${plan.stages.map(stageCard).join('')}
      ${uncovered}
      <div class="actions">${btn('lora-scan', icon('search') + '从当前工作流识别', 'secondary')}</div>`;
  }

  /**
   * The 添加 LoRA dialog. The rows are ComfyUI's own list of loadable files, so anything picked here will load;
   * covers, model names, base models and folders come from ComfyUI-Lora-Manager where it is installed. The whole
   * list is in memory, so searching, filtering and sorting never wait on the network — only 刷新 goes back out.
   */
  function openLoraDialog(stageKey) {
    let search = '', folder = '', baseModel = '', favoritesOnly = false, sort = 'name';
    // The bare controls below carry their key as the aria-label; name them the way field() does for labelled ones.
    const labeled = (html, label) => html.replace(/aria-label="[^"]*"/, `aria-label="${esc(label)}"`);
    const d = ctx.dialog('添加 LoRA', `
      <p class="hint">把 LoRA 加进这一份里，可以连加几个，按添加顺序叠加；加完点「完成」。</p>
      <p class="hint" data-lora-status style="padding:0 2px 8px">正在读 LoRA 列表…</p>
      <div class="group pad" data-lora-tools hidden>
        <div class="inline-row">${labeled(input('lora-search', '', 'text', 'autocomplete="off" spellcheck="false" placeholder="搜名字、文件夹、标签"'), '搜索 LoRA')}${labeled(select('lora-sort', 'name', LORA_SORTS), '排序')}</div>
      </div>
      <div class="filter-row" data-lora-filters hidden></div>
      <div class="group pick-list" data-lora-list hidden></div>
      <details data-group="lora-manual"><summary>手填文件名</summary><div class="group pad">
        ${field('文件名', input('lora-manual', '', 'text', 'autocomplete="off" spellcheck="false" placeholder="models/loras 下的文件名，如 myStyle.safetensors"'), '列表读不到时用：填 ComfyUI 的 models/loras 目录下的文件名；在子文件夹里的要带上子文件夹，如 style/xxx.safetensors。')}
        <div class="key-actions">${btn('lora-add-manual', '添加', 'primary')}</div>
      </div></details>
      <div class="actions">${btn('lora-done', '完成', 'primary')}${btn('lora-refresh', icon('refresh') + '刷新列表', 'secondary')}</div>`);

    const add = name => {
      name = String(name || '').trim();
      if (!name) { ctx.notify('请填写文件名'); return false; }
      const loras = structuredClone(api.comfyStages().stacks[stageKey] || []);
      if (loras.some(l => loraKey(l.name) === loraKey(name))) { ctx.notify('这一份里已经有它了'); return false; }
      if (loras.length >= 10) { ctx.notify('一份里最多 10 个 LoRA，先移除一些吧'); return false; }
      loras.push({id: crypto.randomUUID(), name, on: true, model: 1, clip: 1, trigger: ''});
      api.comfySaveStack(stageKey, loras);
      render();
      ctx.notify(`「${name}」已加进这一份`);
      // Trigger words come from the manager's own scan, so this is a local lookup; without a manager it just fails.
      api.loraTrigger(name).then(info => {
        if (!info.trigger) return;
        const now = structuredClone(api.comfyStages().stacks[stageKey] || []), at = now.findIndex(l => loraKey(l.name) === loraKey(name));
        if (at >= 0 && !now[at].trigger) { now[at].trigger = info.trigger; api.comfySaveStack(stageKey, now); render(); }
      }).catch(() => {});
      return true;
    };

    const statusLine = () => {
      if (!loraCat) return '正在读 LoRA 列表…';
      if (loraCat.error) return loraCat.error;
      const c = loraCat.catalog, bits = [`读到 ${c.total} 个 LoRA，点一个加进栈`];
      if (c.manager) bits.push(`Lora Manager ${c.manager}`);
      else bits.push('装上 ComfyUI-Lora-Manager 就能看到封面、底模和自动触发词');
      if (c.transport === 'plugin') bits.push('由酒馆代读');
      if (c.transport === 'legacy') bits.push('走的是旧补丁，可以删掉了');
      if (c.truncated) bits.push('太多了，只列了前面一部分');
      if (c.unmatched) bits.push(`${c.unmatched} 个 Lora Manager 里有、ComfyUI 读不到（已跳过）`);
      return bits.join(' · ');
    };

    const chip = (label, active, attrs) => `<button type="button" aria-pressed="${active}" ${attrs}>${esc(label)}</button>`;
    const showFilters = () => {
      const box = d.body.querySelector('[data-lora-filters]');
      if (!loraCat?.catalog) { box.hidden = true; return; }
      const {folders, baseModels, favorites} = loraFacets(loraCat.catalog.rows);
      const anyFilter = !!(folder || baseModel || favoritesOnly);
      const chips = [chip('全部', !anyFilter, 'data-lora-filter="all"')];
      if (favorites) chips.push(chip(`★ 收藏 ${favorites}`, favoritesOnly, 'data-lora-filter="fav"'));
      for (const b of baseModels) chips.push(chip(`${b.value} ${b.count}`, baseModel === b.value, `data-lora-filter="base" data-value="${esc(b.value)}"`));
      if (folders.length > 1) for (const f of folders) chips.push(chip(`${f.value || '根目录'} ${f.count}`, folder === f.value, `data-lora-filter="folder" data-value="${esc(f.value)}"`));
      box.hidden = chips.length < 2;
      box.innerHTML = chips.join('');
    };

    const showList = () => {
      const box = d.body.querySelector('[data-lora-list]'), status = d.body.querySelector('[data-lora-status]'), tools = d.body.querySelector('[data-lora-tools]');
      if (status) status.textContent = statusLine();
      const rows = loraCat?.catalog?.rows || [];
      if (tools) tools.hidden = rows.length < 8;
      if (!rows.length) { box.hidden = true; showFilters(); return; }
      const have = new Set((api.comfyStages().stacks[stageKey] || []).map(l => loraKey(l.name)));
      const shown = sortLoraRows(filterLoraRows(rows, {search, folder, baseModel, favoritesOnly}), sort);
      box.hidden = false;
      box.innerHTML = shown.length ? shown.map(r => {
        const meta = [r.baseModel, r.folder || '根目录', r.favorite ? '★ 收藏' : '', r.usage ? `用过 ${r.usage} 次` : ''].filter(Boolean).join(' · ');
        return `<button class="list-row lora-row" data-lora-pick="${esc(r.name)}">
          ${r.preview ? `<img class="lora-thumb" src="${esc(r.preview)}" alt="" loading="lazy" decoding="async">` : `<i class="lora-thumb"></i>`}
          <span><strong>${esc(r.display)}</strong><small class="mono">${esc(r.name)}</small>${meta ? `<small>${esc(meta)}</small>` : ''}</span>
          ${have.has(loraKey(r.name)) ? plate('已在栈里') : icon('add')}</button>`;
      }).join('') : `<p class="hint">没有匹配的 LoRA，换个词或点「全部」。</p>`;
      showFilters();
    };

    const read = async (force = false) => {
      try { loraCat = {catalog: await api.loraCatalog(force)}; }
      catch (error) { loraCat = {error: error.message}; }
      if (!d.body.isConnected) return;
      showList();
    };

    if (loraCat) showList(); // reopened: what was read last time is still on screen while this read confirms it
    d.body.addEventListener('input', e => {
      if (!e.target.matches('[data-field=lora-search]')) return;
      search = e.target.value.trim();
      showList();
    });
    d.body.addEventListener('change', e => {
      if (!e.target.matches('[data-field=lora-sort]')) return;
      sort = e.target.value;
      showList();
    });
    d.body.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      try {
        if (b.dataset.loraFilter) {
          const kind = b.dataset.loraFilter, value = b.dataset.value || '';
          if (kind === 'all') { folder = ''; baseModel = ''; favoritesOnly = false; }
          else if (kind === 'fav') favoritesOnly = !favoritesOnly;
          else if (kind === 'base') baseModel = baseModel === value ? '' : value;
          else if (kind === 'folder') folder = folder === value ? '' : value;
          showList();
        }
        else if (b.dataset.loraPick) {
          // Marking the one row keeps the list still: a full redraw would reflow and re-decode every cover.
          if (add(b.dataset.loraPick) && b.lastElementChild) b.lastElementChild.outerHTML = plate('已在栈里');
        }
        else if (b.dataset.action === 'lora-add-manual') {
          const box = d.body.querySelector('[data-field=lora-manual]');
          if (add(box?.value)) { if (box) box.value = ''; showList(); }
        }
        else if (b.dataset.action === 'lora-done') d.close();
        else if (b.dataset.action === 'lora-refresh') await v.busy(b, () => read(true));
      } catch (error) { ctx.notify(error.message, {error: true}); }
    });
    read();
  }


  async function refreshSubscription(force = false) {
    if (eng() !== 'nai' || !api.keyStatus('nai')) { subscription = null; return; }
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
  v.onDraw = event => {
    if (event.subscription) subscription = event.subscription;
    if (event.queue) { queue = event.queue; cloudError = event.cloud || ''; }
    if (event.subscription || event.queue || event.vibes && tab === 'vibe') render();
  };
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
  v.on('input', '[data-queue]', el => { el.previousElementSibling.querySelector('output').textContent = el.value + (el.dataset.queue === 'gap' ? ' 秒' : ' 次'); });
  v.on('change', '[data-queue]', el => { api.saveDraw({queue: {[el.dataset.queue]: Number(el.value)}}); });
  v.on('change', 'select[data-field]', el => { if (/^comfy-/.test(el.dataset.field)) return; api.saveDraw({params: {[el.dataset.field]: el.value}}); render(); });
  // ComfyUI fields: a select from 读取, or a typed name when nothing was read.
  v.on('change', '[data-field^=comfy-]', el => { api.saveDraw({comfy: {[el.dataset.field.slice(6)]: el.value.trim()}}); render(); });
  v.on('input', '[data-comfy]', el => { el.previousElementSibling.querySelector('output').textContent = el.dataset.comfy === 'scale' ? Number(el.value).toFixed(1) : el.value; });
  v.on('change', '[data-comfy]', el => { api.saveDraw({comfy: {[el.dataset.comfy]: Number(el.value)}}); render(); });
  // LoRA stack rows: switches and sliders redraw, the trigger word saves quietly on blur. Every row names the stage
  // it belongs to, since a workflow can carry more than one stack.
  v.on('input', '[data-lora]', el => {
    if (el.dataset.lora === 'model' || el.dataset.lora === 'clip') { const out = el.previousElementSibling?.querySelector('output'); if (out) out.textContent = Number(el.value).toFixed(2); }
  });
  v.on('change', '[data-lora]', el => {
    const stage = el.dataset.stage, loras = structuredClone(api.comfyStages().stacks[stage] || []);
    const l = loras[Number(el.dataset.index)], key = el.dataset.lora;
    if (!l) return;
    if (key === 'on') l.on = el.checked;
    else if (key === 'model' || key === 'clip') l[key] = Number(el.value);
    else if (key === 'trigger') l.trigger = el.value.trim();
    else return;
    api.comfySaveStack(stage, loras);
    if (key !== 'trigger') render();
  });
  v.on('change', '[data-cloud]', () => { api.saveDraw({queue: {cloud: cloudFields()}}); cloudNote = null; });
  v.on('change', 'input.switch[data-field]', el => {
    const key = el.dataset.field;
    if (key === 'variety') api.saveDraw({params: {variety: el.checked}});
    else if (key === 'vibeEnabled') api.saveDraw({vibe: {enabled: el.checked}});
    else if (key === 'cloud') api.saveDraw({queue: {cloud: {...cloudFields(), enabled: el.checked}}});
    else if (key === 'gptAsk') api.saveDraw({gpt: {ask: el.checked}});
    else api.saveDraw({[key]: el.checked});
    render();
  });
  v.on('input', '[data-vibe-search]', el => vibes.search(el.value));
  v.on('change', '[data-vibe-file]', async el => { const files = [...el.files]; el.value = ''; await vibes.importFiles(files); });
  v.on('click', '[data-action]', async el => {
    if (el.dataset.action?.startsWith('vibe-') && await vibes.click(el)) return;
    const index = Number(el.dataset.index);
    switch (el.dataset.action) {
      case 'tab': tab = el.dataset.tab; render(); break;
      case 'draw-engine': api.saveDraw({engine: el.dataset.pick}); styleDraft = null; render(); refreshSubscription(); break;
      case 'gpt-quality': api.saveDraw({gpt: {quality: el.dataset.value}}); render(); break;
      case 'gpt-orientation': api.saveDraw({gpt: {orientation: el.dataset.value}}); render(); break;
      case 'comfy-size': { const [, , width, height] = SIZES.find(s => s[0] === el.dataset.size); api.saveDraw({comfy: {width, height}}); render(); break; }
      case 'comfy-read': await v.busy(el, readComfy); break;
      case 'add-lora': openLoraDialog(el.dataset.stage); break;
      case 'lora-scan': {
        // Fills the stages that are still empty from the workflow's own LoRA nodes; a stage the user has already
        // filled is left alone, so pressing this can never wipe a stack that is only written at request time.
        const {plan, stacks} = api.comfyStages();
        let filled = 0, kept = 0;
        for (const stage of plan.stages) {
          if (!stage.stack.length) continue;
          if ((stacks[stage.key] || []).length) { kept++; continue; }
          api.comfySaveStack(stage.key, stage.stack.map(l => ({...l, id: crypto.randomUUID(), on: true, trigger: ''})));
          filled++;
        }
        render();
        if (!plan.stages.some(s => s.stack.length)) ctx.notify(plan.stages.length > 1 ? '工作流里的 LoRA 节点都是空的' : '当前工作流里没有现成的 LoRA 节点');
        else ctx.notify(`从工作流收了 ${filled} 份${kept ? `；另有 ${kept} 份插件里已经有了，没动` : ''}`);
        break;
      }
      case 'lora-fetch': {
        const stage = el.dataset.stage, before = structuredClone(api.comfyStages().stacks[stage] || []);
        const i = Number(el.dataset.index), l = before[i];
        if (!l) break;
        await v.busy(el, async () => {
          const info = await api.loraTrigger(l.name);
          const now = structuredClone(api.comfyStages().stacks[stage] || []);
          if (now[i]?.name === l.name) {
            if (info.trigger) { now[i].trigger = info.trigger; api.comfySaveStack(stage, now); }
            render();
            ctx.notify(info.trigger ? `触发词已填好：${info.trigger}` : 'Lora Manager 里没记它的触发词（自制的 LoRA 多半没有），手动填吧');
          }
        });
        break;
      }
      case 'lora-remove': {
        const stage = el.dataset.stage, loras = structuredClone(api.comfyStages().stacks[stage] || []);
        loras.splice(Number(el.dataset.index), 1);
        api.comfySaveStack(stage, loras);
        render();
        break;
      }
      case 'lora-up': case 'lora-down': {
        const stage = el.dataset.stage, loras = structuredClone(api.comfyStages().stacks[stage] || []);
        const i = Number(el.dataset.index), j = el.dataset.action === 'lora-up' ? i - 1 : i + 1;
        if (!loras[i] || !loras[j]) break;
        [loras[i], loras[j]] = [loras[j], loras[i]];
        api.comfySaveStack(stage, loras);
        render();
        break;
      }
      case 'size': { const [, , width, height] = SIZES.find(s => s[0] === el.dataset.size); api.saveDraw({params: {width, height}}); render(); break; }
      case 'dice': seed = Math.floor(Math.random() * 4294967295); render(); break;
      case 'thumb': current = index; render(); break;
      case 'cancel-job': api.cancelDraw(el.dataset.key); break;
      case 'mode': api.saveDraw({mode: el.dataset.mode}); render(); break;
      case 'cloud-kind': api.saveDraw({queue: {cloud: {...cloudFields(), kind: el.dataset.kind}}}); cloudNote = null; render(); break;
      case 'plan-latest': await v.busy(el, () => api.planLatestPictures()); break;
      case 'new-room': { const room = api.newRoomCode(); v.root.querySelector('[data-cloud=room]').value = room; api.saveDraw({queue: {cloud: cloudFields()}}); cloudNote = {ok: true, text: '已生成房间码。把队列地址和房间码发给共用账号的朋友。'}; render(); break; }
      case 'test-cloud': {
        api.saveDraw({queue: {cloud: cloudFields()}});
        cloudNote = {ok: true, text: '正在连接……'}; render();
        const r = await api.testCloudQueue(cloudFields());
        cloudNote = r.ok ? {ok: true, text: `连接正常。队里现在 ${r.length} 张${r.holder ? `，${r.holder} 正在画` : ''}。`} : {ok: false, text: r.message};
        render();
        break;
      }
      case 'cancel-all': if (await ctx.confirm('取消所有排队的图？', '正在画的那一张也会停下。')) api.cancelAllDraws(); break;
      case 'go-settings': ctx.open('settings'); break;
      case 'go-key': ctx.open('engines'); ctx.editEngine?.(eng()); break;
      case 'open-presets': ctx.open('presets'); ctx.showPresetKind?.('draw'); break;
      case 'position': characters[index].position = Number(el.dataset.position); render(); break;
      case 'remove-char': characters.splice(index, 1); render(); break;
      case 'add-custom': characters.push({name: '角色', prompt: '', position: -1}); render(); break;
      case 'add-char': pickCharacter(); break;
      case 'zoom': { const img = el.querySelector('img'), shown = results[current]; if (img) openImageViewer({doc: ctx.doc, src: img.src, alt: '生成的图片', from: img, actions: shown ? [downloadAction(ctx.doc, () => resultFile(shown), ctx.notify)] : []}); break; }
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
        if (!styleDraft.name.trim()) { ctx.notify('请填写画风名字'); break; }
        api.saveStyle(styleDraft);
        styleDraft = null;
        render();
        ctx.notify('画风已保存');
        break;
      }
      case 'generate': await generate(); break;
    }
  });

  async function generate() {
    const s = styleDraft || style(), q = quote();
    let allowPaid = false;
    if (q.free === false && eng() === 'gpt') {
      const ask = api.paidPrompt();
      if (!await ctx.confirm(ask.title, ask.text)) return;
      allowPaid = true;
    } else if (q.free === false) {
      const vibeNote = q.vibeAnlas ? `其中 Vibe 约 ${q.vibeAnlas} Anlas（${[q.vibes.encode && `${q.vibes.encode} 个第一次用要编码`, q.vibes.extra && `超过 4 个多了 ${q.vibes.extra} 个`].filter(Boolean).join('，')}）。` : '';
      if (!await ctx.confirm('这张图会扣 Anlas', `按当前参数和订阅，这次生成要消耗 Anlas${subscription ? `（现有 ${subscription.anlas}）` : ''}。${vibeNote}实际扣多少以 NovelAI 结算为准。`)) return;
      allowPaid = true;
    }
    busy = true;
    render();
    try {
      const result = await api.generateImage({
        prompt: [s.artist, s.positive, prompt].map(x => (x || '').trim()).filter(Boolean).join(', '),
        negative: [s.negative, negative].map(x => (x || '').trim()).filter(Boolean).join(', '),
        characters: characters.filter(c => c.prompt.trim()).map(c => ({prompt: c.prompt, position: c.position})),
        params: eng() === 'nai' ? {...state().params, seed} : {seed}, allowPaid, name: engineName().replace(/\s+/g, ''), label: '绘图 App · ' + (prompt.trim().slice(0, 24) || s.name)
      });
      results.unshift(result);
      results = results.slice(0, MAX_RESULTS);
      current = 0;
      newest = true;
      if (allowPaid && eng() === 'nai') refreshSubscription(true);
    } catch (error) { if (!error.cancelled) ctx.notify(error.message); }
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
    const d0 = state(), using = styleId();
    const d = ctx.dialog('画风预设', `<div class="group">${d0.styles.map(s => `<button class="list-row" data-style="${esc(s.id)}"><span><strong>${esc(s.name)}</strong><small class="mono">${esc(s.artist || '没有画师串')}</small></span>${s.id === using ? plate('使用中') : icon('next')}</button>`).join('')}</div>
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
          ctx.notify('已新建画风，在下面改名字、填写画师串');
        }
        if (b.dataset.action === 'delete-style') {
          d.close();
          if (await ctx.confirm('删除当前画风？', `「${style().name}」会被删除，其他画风保留。`)) { api.deleteStyle(style().id); styleDraft = null; render(); }
        }
      } catch (error) { ctx.notify(error.message); }
    });
  }


  render();
  refreshSubscription();
  return v;
}
