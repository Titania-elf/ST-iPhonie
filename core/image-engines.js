// Drawing engines besides NovelAI: GPT image models (the OpenAI images API, or a relay that speaks it) and a ComfyUI
// the user runs. Everything that calls for a picture (正文出图, 朋友圈, 查手机, the 绘图 App) goes through
// backend.generateImage, which picks the engine set in 绘图 → 用哪个画; this file turns the same picture (scene tags,
// one caption per person, NovelAI-sized params) into each engine's request.
//   GPT: called from the browser with the user's key (api.openai.com allows cross-origin calls; so do most relays).
//   ComfyUI: through the tavern's own ComfyUI proxy (/api/sd/comfy/…), so neither CORS nor a phone that cannot reach
//   the computer's 127.0.0.1 gets in the way: the tavern server talks to ComfyUI. Workflows use the tavern's
//   placeholders ("%prompt%", "%width%" …), so a workflow made for the tavern's image generation works here too.

export const DRAW_ENGINES = ['nai', 'gpt', 'comfy'];
export const DRAW_ENGINE_NAMES = {nai: 'NovelAI', gpt: 'GPT 生图', comfy: 'ComfyUI'};

// ---------- GPT ----------
export const OPENAI_BASE = 'https://api.openai.com/v1';
export const GPT_IMAGE_MODELS = ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini', 'dall-e-3'];
export const GPT_QUALITIES = ['auto', 'low', 'medium', 'high'];
export const GPT_ORIENTATIONS = ['portrait', 'landscape', 'square'];
export const defaultGpt = () => ({url: '', model: 'gpt-image-1', quality: 'auto', orientation: 'portrait', ask: true, style: ''});

/** A GPT address: '' for OpenAI itself; a relay's address ends at /v1 (a pasted …/images/generations is cut off). */
export function gptBase(value, pageProtocol = globalThis.location?.protocol) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  let url; try { url = new URL(raw); } catch { throw Error('接口地址格式不对，要以 https:// 开头'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('接口地址格式不对：以 https:// 开头，不带 ? 和 #');
  if (url.protocol === 'http:' && pageProtocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('酒馆是用 HTTPS 打开的，浏览器不允许连 http:// 的接口，请换成 HTTPS 地址');
  let path = url.pathname.replace(/\/+$/, '').replace(/\/images\/(generations|edits)$/i, '');
  if (!/\/v\d+$/i.test(path)) path += '/v1';
  return url.origin + path;
}
export function normalizeGpt(value) {
  const base = defaultGpt(), g = value && typeof value === 'object' ? value : {};
  const model = String(g.model ?? base.model).trim().slice(0, 80);
  return {
    url: (() => { try { return gptBase(g.url, ''); } catch { return ''; } })(),
    model: /^[\w.:/-]{1,80}$/.test(model) ? model : base.model,
    quality: GPT_QUALITIES.includes(g.quality) ? g.quality : base.quality,
    orientation: GPT_ORIENTATIONS.includes(g.orientation) ? g.orientation : base.orientation,
    ask: g.ask !== false,
    style: typeof g.style === 'string' ? g.style.slice(0, 64) : ''
  };
}
const dalle = model => /^dall-e/i.test(model);
/** The size GPT is asked for: its models take only a few. */
export function gptSize(model, orientation) {
  if (dalle(model)) return {portrait: '1024x1792', landscape: '1792x1024', square: '1024x1024'}[orientation] || '1024x1024';
  return {portrait: '1024x1536', landscape: '1536x1024', square: '1024x1024'}[orientation] || '1024x1024';
}
/** portrait / landscape / square of a width and height. */
export const orientationOf = (width, height) => !(width > 0 && height > 0) ? '' : width === height ? 'square' : width < height ? 'portrait' : 'landscape';

/** NovelAI tag syntax ({strong}, [weak], 1.2::tag::, artist:name) taken out: GPT reads plain words. Artist tags are
 *  dropped; GPT does not know them by those names and may refuse a living artist's style. */
export function plainTags(text) {
  return String(text || '')
    .replace(/\b(?:source|target|mutual)#/gi, '')
    .replace(/-?\d+(?:\.\d+)?::/g, '').replace(/::/g, ',')
    .replace(/[{}[\]]/g, '')
    .split(',').map(t => t.trim()).filter(t => t && !/^artist\s*:/i.test(t)).join(', ');
}
function place(position) {
  if (!(position >= 0)) return '';
  const column = position % 5, row = Math.floor(position / 5);
  const x = ['far left', 'left', 'center', 'right', 'far right'][column], y = row < 2 ? 'upper part' : row > 2 ? 'lower part' : '';
  return y ? `${x}, ${y} of the picture` : `${x} of the picture`;
}
/** One English request for GPT from the picture: scene tags, then each person's tags and place in the frame. */
export function gptPrompt({prompt = '', characters = []} = {}) {
  const scene = plainTags(prompt), people = characters.map(c => ({tags: plainTags(c.prompt), where: place(c.position)})).filter(c => c.tags);
  const lines = ['Draw one illustration described by the Danbooru-style tags and short phrases below. Follow them closely; do not add text or captions to the picture.'];
  if (scene) lines.push('Scene and style: ' + scene + '.');
  people.forEach((c, i) => lines.push(`Character ${i + 1}${c.where ? ` (${c.where})` : ''}: ${c.tags}.`));
  if (people.length > 1) lines.push(`Exactly ${people.length} distinct characters; keep each one's features separate.`);
  return lines.join('\n');
}

/** Readable GPT error; status kept so the queue can retry a 429. */
export function gptFailure(status, text, relay = false) {
  let detail = '';
  try { const data = JSON.parse(text); detail = String(data?.error?.message || data?.message || data?.error || ''); } catch { detail = String(text || '').trim(); }
  detail = detail.replace(/\s+/g, ' ').slice(0, 240);
  const who = relay ? '中转' : 'OpenAI';
  const blocked = /moderation|safety|content policy|not allowed|rejected/i.test(detail);
  const message = status === 401 ? `${who}拒绝了密钥（401）：请检查 GPT 生图的密钥`
    : status === 403 ? `${who}不允许这次请求（403）${detail ? '：' + detail : ''}。新账号用 gpt-image 可能要先在 OpenAI 后台完成组织验证`
    : status === 404 ? `${who}返回 404：地址不对，或者没有这个模型（${detail || '没有说明'}）`
    : status === 429 ? `${who}说请求太多或额度用完了（429）${detail ? '：' + detail : ''}`
    : status === 400 && blocked ? 'GPT 拒绝画这张（内容审核）：' + detail
    : status === 400 ? 'GPT 拒绝了这次请求：' + (detail || '参数无效')
    : `${who}暂时不可用（${status}）${detail ? '：' + detail : ''}`;
  return Object.assign(Error(message), {status});
}

const base64Blob = (data, type = 'image/png') => {
  const bin = atob(data), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], {type});
};
const imageType = format => ({jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', png: 'image/png'})[String(format || 'png').toLowerCase()] || 'image/png';

/** Draws one picture with a GPT image model. Returns a Blob. */
export async function gptGenerate({fetch = globalThis.fetch, settings, key, prompt, size, signal}) {
  if (!key) throw Error('还没有填写 GPT 生图的密钥');
  const base = settings.url || OPENAI_BASE, relay = !!settings.url;
  const body = {model: settings.model, prompt, n: 1, size};
  if (dalle(settings.model)) { body.response_format = 'b64_json'; if (/dall-e-3/i.test(settings.model)) body.quality = settings.quality === 'high' ? 'hd' : 'standard'; }
  else if (settings.quality !== 'auto') body.quality = settings.quality;
  let response;
  try { response = await fetch(base + '/images/generations', {method: 'POST', headers: {Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'}, body: JSON.stringify(body), signal}); }
  catch (error) { if (error?.name === 'AbortError') throw error; throw Error(relay ? '连不上中转：请确认地址正确、中转允许跨域（CORS）' : '连不上 OpenAI，请检查网络'); }
  const text = await response.text().catch(() => '');
  if (!response.ok) throw gptFailure(response.status, text, relay);
  let data; try { data = JSON.parse(text); } catch { throw Error((relay ? '中转' : 'OpenAI') + '返回的内容不是图片数据'); }
  const item = data?.data?.[0];
  if (item?.b64_json) return base64Blob(item.b64_json, imageType(data.output_format));
  if (item?.url) {
    // Some relays answer with a link: fetched here (a link the browser may not open says so).
    if (/^data:image\//.test(item.url)) return base64Blob(item.url.split(',')[1] || '', item.url.slice(5, item.url.indexOf(';')));
    let picture;
    try { picture = await fetch(item.url, {signal}); } catch (error) { if (error?.name === 'AbortError') throw error; throw Error('中转给的是图片链接，但浏览器打不开它（链接不允许跨域）'); }
    if (!picture.ok) throw Error(`中转给的图片链接打不开（${picture.status}）`);
    return await picture.blob();
  }
  throw Error((relay ? '中转' : 'OpenAI') + '没有返回图片' + (data?.error?.message ? '：' + data.error.message : ''));
}

// ---------- ComfyUI ----------
/** The tavern's default workflow (SD 1.5 / SDXL checkpoint, one KSampler). */
export const DEFAULT_COMFY_WORKFLOW = JSON.stringify({
  3: {class_type: 'KSampler', inputs: {cfg: '%scale%', denoise: 1, latent_image: ['5', 0], model: ['4', 0], negative: ['7', 0], positive: ['6', 0], sampler_name: '%sampler%', scheduler: '%scheduler%', seed: '%seed%', steps: '%steps%'}},
  4: {class_type: 'CheckpointLoaderSimple', inputs: {ckpt_name: '%model%'}},
  5: {class_type: 'EmptyLatentImage', inputs: {batch_size: 1, height: '%height%', width: '%width%'}},
  6: {class_type: 'CLIPTextEncode', inputs: {clip: ['4', 1], text: '%prompt%'}},
  7: {class_type: 'CLIPTextEncode', inputs: {clip: ['4', 1], text: '%negative_prompt%'}},
  8: {class_type: 'VAEDecode', inputs: {samples: ['3', 0], vae: ['4', 2]}},
  9: {class_type: 'SaveImage', inputs: {filename_prefix: 'ST-iPhonie', images: ['8', 0]}}
}, null, 2);
export const COMFY_LIMITS = {workflow: 300000};
export const defaultComfy = () => ({url: 'http://127.0.0.1:8188', workflow: '', model: '', vae: '', sampler: 'euler_ancestral', scheduler: 'normal', steps: 28, scale: 6, width: 832, height: 1216, clipSkip: 2, style: '', loras: [], stages: {}});

export function comfyUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw Error('请填写 ComfyUI 地址，例如 http://127.0.0.1:8188');
  let url; try { url = new URL(/^https?:\/\//i.test(raw) ? raw : 'http://' + raw); } catch { throw Error('ComfyUI 地址格式不对，例如 http://127.0.0.1:8188'); }
  if (url.search || url.hash) throw Error('ComfyUI 地址不要带 ? 和 #');
  return (url.origin + url.pathname).replace(/\/+$/, '');
}
/** The placeholders a workflow uses ("%prompt%" → prompt). */
export const workflowPlaceholders = text => [...new Set([...String(text).matchAll(/"%([a-z_]+)%"/g)].map(m => m[1]))];
/** Checks a pasted workflow: API format (File → Export (API)), with "%prompt%" somewhere. */
export function checkWorkflow(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return '';
  if (raw.length > COMFY_LIMITS.workflow) throw Error('工作流太大了（超过 300 KB）');
  let data; try { data = JSON.parse(raw); } catch { throw Error('工作流不是有效的 JSON'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('工作流格式不对');
  if (Array.isArray(data.nodes) && data.links) throw Error('这是界面格式的工作流：请在 ComfyUI 里用「导出 (API)」（Export (API)）重新导出');
  if (!Object.values(data).some(n => n && typeof n === 'object' && typeof n.class_type === 'string')) throw Error('工作流里没有节点（需要 API 格式）');
  if (!workflowPlaceholders(raw).includes('prompt')) throw Error('工作流里没有 "%prompt%"：点「自动标记占位符」让插件顺着连线找出来标好，或手动把正面提示词那一栏的文字换成 "%prompt%"（带引号）');
  return raw;
}
export function normalizeComfy(value) {
  const base = defaultComfy(), c = value && typeof value === 'object' ? value : {};
  const n = (v, min, max, fallback, step = 1) => { const x = Number(v); return Number.isFinite(x) ? Math.min(max, Math.max(min, Math.round(x / step) * step)) : fallback; };
  const word = (v, fallback) => { const s = String(v ?? '').trim(); return s.length <= 300 ? s : fallback; };
  // LoRA strengths move in steps of 0.05; each stack is capped and deduped by file name.
  const strength = v => { const x = Number(v); return Number.isFinite(x) ? Math.round(Math.min(3, Math.max(0, x)) * 20) / 20 : 1; };
  const stack = value => (Array.isArray(value) ? value : []).slice(0, LORA_MAX).map(l => ({
    id: /^[\w-]{1,64}$/.test(String(l?.id || '')) ? String(l.id) : crypto.randomUUID(),
    name: word(l?.name, ''),
    on: l?.on !== false,
    model: strength(l?.model), clip: strength(l?.clip),
    trigger: String(l?.trigger ?? '').slice(0, 300)
  })).filter(l => l.name).filter((l, i, all) => all.findIndex(x => x.name.toLowerCase() === l.name.toLowerCase()) === i);
  // The extra stages, keyed by the node they are written into. An empty array is kept: it means "this stage was
  // cleared", which must not be confused with "this stage was never touched" (that one seeds from the workflow).
  const stages = {};
  if (c.stages && typeof c.stages === 'object' && !Array.isArray(c.stages)) {
    for (const [key, list] of Object.entries(c.stages).slice(0, LORA_STAGES_MAX)) if (/^(?:node:\d+|inject)$/.test(key)) stages[key] = stack(list);
  }
  return {
    url: (() => { try { return comfyUrl(c.url ?? base.url); } catch { return base.url; } })(),
    workflow: (() => { try { return checkWorkflow(c.workflow); } catch { return ''; } })(),
    model: word(c.model, ''), vae: word(c.vae, ''), sampler: word(c.sampler, base.sampler) || base.sampler, scheduler: word(c.scheduler, base.scheduler) || base.scheduler,
    steps: n(c.steps, 1, 150, base.steps), scale: n(c.scale, 0, 30, base.scale, .1),
    width: n(c.width, 64, 4096, base.width, 8), height: n(c.height, 64, 4096, base.height, 8), clipSkip: n(c.clipSkip, 1, 12, base.clipSkip),
    style: typeof c.style === 'string' ? c.style.slice(0, 64) : '',
    loras: stack(c.loras), stages
  };
}
/** ComfyUI size for a picture's orientation: the configured size, turned or squared to match. */
export function comfySize(c, orientation) {
  const long = Math.max(c.width, c.height), short = Math.min(c.width, c.height);
  if (orientation === 'portrait') return {width: short, height: long};
  if (orientation === 'landscape') return {width: long, height: short};
  if (orientation === 'square') { const side = Math.max(64, Math.round(Math.sqrt(c.width * c.height) / 8) * 8); return {width: side, height: side}; }
  return {width: c.width, height: c.height};
}

/** NovelAI weights to the ComfyUI / A1111 form: {tag} → (tag:1.05), [tag] → (tag:0.95), 1.3::tag:: → (tag:1.3);
 *  brackets that are part of a tag (character (series)) are escaped so they are not read as weights. */
export function comfyTags(text) {
  // source#/target#/mutual# are NovelAI's own: the action stays, the mark goes.
  let s = String(text || '').replace(/\b(?:source|target|mutual)#/gi, '').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  s = s.replace(/(-?\d+(?:\.\d+)?)::([^:]+?)::/g, (m, w, t) => `(${t.trim()}:${+Number(w).toFixed(2)})`);
  s = s.replace(/(-?\d+(?:\.\d+)?)::([^,]+)/g, (m, w, t) => `(${t.trim()}:${+Number(w).toFixed(2)})`);
  for (let guard = 0; guard < 20 && /\{[^{}]*\}|\[[^[\]]*\]/.test(s); guard++) {
    s = s.replace(/(\{+)([^{}]*)(\}+)/g, (m, open, t, close) => { const depth = Math.min(open.length, close.length); return '{'.repeat(open.length - depth) + `(${t.trim()}:${+(1.05 ** depth).toFixed(2)})` + '}'.repeat(close.length - depth); });
    s = s.replace(/(\[+)([^[\]]*)(\]+)/g, (m, open, t, close) => { const depth = Math.min(open.length, close.length); return '['.repeat(open.length - depth) + `(${t.trim()}:${+(1 / 1.05 ** depth).toFixed(2)})` + ']'.repeat(close.length - depth); });
  }
  return s.replace(/::/g, ',').split(',').map(t => t.trim()).filter(Boolean).join(', ');
}
/** One prompt for ComfyUI: the scene, then every person's caption (ComfyUI has no per-character captions). */
export function comfyPrompt({prompt = '', negative = '', characters = []} = {}) {
  const people = characters.map(c => comfyTags(c.prompt)).filter(Boolean);
  const negatives = [negative, ...characters.map(c => c.negative)].map(comfyTags).filter(Boolean);
  return {prompt: [comfyTags(prompt), ...people].filter(Boolean).join(', '), negative: [...new Set(negatives.join(', ').split(', ').filter(Boolean))].join(', ')};
}

/** The workflow with every placeholder filled; a placeholder left over is named so the user can fix the workflow. */
export function fillWorkflow(text, values) {
  let out = String(text || DEFAULT_COMFY_WORKFLOW);
  for (const [name, value] of Object.entries(values)) out = out.replaceAll(`"%${name}%"`, JSON.stringify(value));
  const left = workflowPlaceholders(out);
  if (left.length) throw Error('工作流里有插件不认识的占位符：' + left.map(x => `%${x}%`).join('、') + '。请在 ComfyUI 里把它们换成具体的值');
  return out;
}
export function comfyValues(c, {prompt, negative, width, height, seed}) {
  if (!c.model && (!c.workflow || workflowPlaceholders(c.workflow).includes('model'))) throw Error('还没有选 ComfyUI 的模型：在引擎卡包的 ComfyUI 里读取模型列表再选一个');
  return {prompt, negative_prompt: negative, seed, steps: c.steps, scale: c.scale, width, height, sampler: c.sampler, scheduler: c.scheduler, model: c.model, vae: c.vae, denoise: 1, clip_skip: -c.clipSkip};
}

/** Calls the tavern's ComfyUI proxy. headers: the tavern's request headers (CSRF token). */
async function tavern(fetch, headers, path, body, signal) {
  let response;
  try { response = await fetch('/api/sd/comfy/' + path, {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body), signal}); }
  catch (error) { if (error?.name === 'AbortError') throw error; throw Error('连不上酒馆服务器'); }
  return response;
}
const comfyDown = url => `酒馆连不上 ComfyUI（${url}）：请确认 ComfyUI 开着、地址填的是酒馆所在电脑能打开的地址`;
export async function comfyGenerate({fetch = globalThis.fetch, headers = {}, url, workflow, signal}) {
  const response = await tavern(fetch, headers, 'generate', {url, prompt: `{"prompt": ${workflow}}`}, signal);
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    if (response.status === 404) throw Error('这个酒馆没有 ComfyUI 转发接口（/api/sd/comfy），请更新酒馆');
    if (response.status === 403) throw Error('酒馆拒绝了请求（403），请刷新酒馆页面再试');
    const reason = text.replace(/\s+/g, ' ').trim().slice(0, 300);
    throw Object.assign(Error(/fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(reason) || !reason ? comfyDown(url) : 'ComfyUI 没画成：' + reason), {status: response.status === 429 ? 429 : 0});
  }
  let data; try { data = JSON.parse(text); } catch { throw Error('ComfyUI 返回的内容不是图片'); }
  if (!data?.data) throw Error('ComfyUI 没有返回图片（工作流里要有保存图片的节点）');
  return base64Blob(data.data, imageType(data.format));
}
/** Checks the connection and reads what the workflow can use: {models, samplers, schedulers}. */
export async function comfyCatalog({fetch = globalThis.fetch, headers = {}, url}) {
  const ping = await tavern(fetch, headers, 'ping', {url});
  if (ping.status === 404) throw Error('这个酒馆没有 ComfyUI 转发接口（/api/sd/comfy），请更新酒馆');
  if (!ping.ok) throw Error(comfyDown(url));
  const read = async path => { const r = await tavern(fetch, headers, path, {url}); if (!r.ok) return []; try { return await r.json(); } catch { return []; } };
  const [models, samplers, schedulers] = await Promise.all([read('models'), read('samplers'), read('schedulers')]);
  return {models: (Array.isArray(models) ? models : []).map(m => typeof m === 'string' ? {value: m, text: m} : {value: String(m.value), text: String(m.text || m.value)}),
    samplers: (Array.isArray(samplers) ? samplers : []).map(String), schedulers: (Array.isArray(schedulers) ? schedulers : []).map(String)};
}
/** The workflows saved in the tavern (its image generation settings): names, and one's text. */
export async function tavernWorkflows({fetch = globalThis.fetch, headers = {}}) {
  const r = await tavern(fetch, headers, 'workflows', {});
  if (!r.ok) throw Error('读不到酒馆里的工作流');
  const list = await r.json().catch(() => []);
  return (Array.isArray(list) ? list : []).map(String);
}
export async function tavernWorkflow({fetch = globalThis.fetch, headers = {}, name}) {
  const r = await tavern(fetch, headers, 'workflow', {file_name: name});
  if (!r.ok) throw Error('读不到这个工作流');
  const text = await r.json();
  return typeof text === 'string' ? text : JSON.stringify(text);
}

// ---------- LoRA ----------
// The stacks live in the settings (draw.comfy.loras for the first stage, draw.comfy.stages for the rest) and are edited
// live in the drawing app. A workflow can offer more than one place to put them: a two-pass workflow usually carries one
// Lora Loader (LoraManager) per pass, each holding its own loras. So the plugin keeps one stack per such node instead of
// one pile shared by everything, and writes each stack into its node at request time. The workflow saved in the settings
// is never modified, and neither is any node the user wired up by hand.
export const LORA_MAX = 10;
/** Stacks one workflow may use, so a pathological graph cannot fill the settings file. */
export const LORA_STAGES_MAX = 6;
/** Model loaders an injected chain can hook onto: class_type → [MODEL output index, CLIP output index (-1 = unet only)]. */
const MODEL_LOADERS = {
  CheckpointLoaderSimple: [0, 1], CheckpointLoader: [0, 1], ImageOnlyCheckpointLoader: [0, 2],
  UNETLoader: [0, -1], UnetLoaderGGUF: [0, -1], UnetLoaderGGUFAdvanced: [0, -1]
};
const clampStrength = v => { const x = Number(v); return Number.isFinite(x) ? Math.round(Math.min(3, Math.max(0, x)) * 20) / 20 : 1; };

// Only Lora Manager's loader holds a whole stack and has both a MODEL and a CLIP output, so it is the one node the
// plugin writes into. LoraLoader / LoraLoaderModelOnly hold a single lora each: nodeLoras reads them for the plan's
// report, but they are never written, because one node cannot express a stack.
const STACK_NODE = 'Lora Loader (LoraManager)';
const SAMPLER_NODES = new Set(['KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'SamplerCustomAdvanced']);
const isSampler = type => SAMPLER_NODES.has(type) || /^KSampler(?![a-z])/i.test(type) || /^SamplerCustom/.test(type);
const MODEL_EXTS = ['.safetensors', '.ckpt', '.pt', '.bin'];

/** A stack node's own LoRAs as {name, model, clip}. Lora Manager keeps them in its widget, the built-ins in fields. */
export function nodeLoras(node) {
  const inputs = node?.inputs;
  if (!inputs || typeof inputs !== 'object') return [];
  if (node.class_type === STACK_NODE) {
    const list = Array.isArray(inputs.loras?.__value__) ? inputs.loras.__value__ : Array.isArray(inputs.loras) ? inputs.loras : [];
    return list.filter(e => e && typeof e === 'object' && e.active !== false && typeof e.name === 'string' && e.name.trim())
      .map(e => ({name: e.name.trim(), model: clampStrength(e.strength), clip: clampStrength(e.clipStrength ?? e.strength)}));
  }
  const name = typeof inputs.lora_name === 'string' ? inputs.lora_name.trim() : '';
  if (!name || name.includes('%')) return [];
  if (node.class_type === 'LoraLoader') return [{name, model: clampStrength(inputs.strength_model), clip: clampStrength(inputs.strength_clip)}];
  if (node.class_type === 'LoraLoaderModelOnly') return [{name, model: clampStrength(inputs.strength_model), clip: 0}];
  return [];
}

/** Whether any node's input reads output `out` of node `id` (connections are ["4", 0] pairs). */
const readsFrom = (data, id, out) => Object.entries(data).some(([, n]) => n && typeof n === 'object' && Object.values(n.inputs || {}).some(v => Array.isArray(v) && String(v[0]) === String(id) && v[1] === out));

// ---------- The workflow's stacks ----------
// Where a workflow puts its loras is the workflow's business: a two-pass graph may route the first pass through one
// Lora Loader (LoraManager) and the second through another, so that each pass gets its own set. The plugin reads that
// structure and offers one stack per node, rather than injecting a single pile that every pass has to share.

/** The nodes feeding a node's `model` input, nearest first. */
function modelChain(data, id) {
  const out = [], seen = new Set([String(id)]);
  let link = data[id]?.inputs?.model;
  while (Array.isArray(link) && !seen.has(String(link[0]))) {
    seen.add(String(link[0]));
    const node = data[link[0]];
    if (!node || typeof node !== 'object') break;
    out.push({id: String(link[0]), node});
    link = node.inputs?.model;
  }
  return out;
}

/** How many samplers this one samples after (0 = the first pass): its latent is walked back through upscales. */
function sampleOrder(data, id) {
  const seen = new Set([String(id)]);
  let count = 0, link = data[id]?.inputs?.latent_image;
  while (Array.isArray(link) && !seen.has(String(link[0]))) {
    seen.add(String(link[0]));
    const node = data[link[0]];
    if (!node || typeof node !== 'object') break;
    if (isSampler(node.class_type)) count++;
    // LatentUpscale and the like forward a latent through `samples` instead of `latent_image`.
    link = node.inputs?.latent_image ?? node.inputs?.samples;
  }
  return count;
}

/**
 * Reads the sampling structure out of a workflow: the passes (samplers, in the order they run) and the stacks the
 * plugin can write. A stage is one Lora Loader (LoraManager) node, and it lists every pass that runs through it — a
 * node upstream of a later pass feeds that pass too, which is exactly how 双采 graphs stack a shared style lora under
 * a per-pass detailer. With no such node in the graph the plugin falls back to one injected chain at the model loader,
 * which is what it always did.
 */
export function loraPlan(text) {
  // A workflow that cannot be read still offers the injected chain, so LoRA keeps working the way it always did — and
  // a stack that cannot be drawn in still says so loudly at draw time rather than silently going missing.
  const blind = {key: 'inject', kind: 'inject', nodeId: '', classType: '', stack: [], feeds: [], upstream: []};
  const nothing = {passes: [], stages: [blind], uncovered: []};
  let data; try { data = JSON.parse(String(text || '')); } catch { return nothing; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return nothing;

  const passes = Object.keys(data)
    .filter(id => isSampler(data[id]?.class_type) && Array.isArray(data[id]?.inputs?.model))
    .map(id => ({id, denoise: Number(data[id].inputs.denoise), order: sampleOrder(data, id)}))
    .sort((a, b) => a.order - b.order || Number(a.id) - Number(b.id))
    .map((p, i) => ({id: p.id, index: i, denoise: Number.isFinite(p.denoise) ? p.denoise : 1}));
  const chains = new Map(passes.map(p => [p.id, modelChain(data, p.id)]));
  const stacks = new Map(), uncovered = [];
  for (const pass of passes) {
    const anchor = chains.get(pass.id).find(x => x.node.class_type === STACK_NODE);
    if (!anchor) { uncovered.push(pass.index); continue; }
    if (stacks.has(anchor.id)) continue;
    stacks.set(anchor.id, {key: `node:${anchor.id}`, kind: 'node', nodeId: anchor.id, classType: anchor.node.class_type, stack: nodeLoras(anchor.node)});
  }
  // No stack node reaches a sampler: one chain at the loader for all of them, as before.
  if (!stacks.size) {
    return {passes, uncovered: [], stages: [{key: 'inject', kind: 'inject', nodeId: '', classType: '', stack: [], feeds: passes.map(p => p.index), upstream: []}]};
  }

  const stages = [...stacks.values()].map(stage => {
    const depth = modelChain(data, stage.nodeId);
    return {
      ...stage,
      // Every pass it feeds, not only the one anchored here: it sits upstream of the rest.
      feeds: passes.filter(p => chains.get(p.id).some(x => x.id === stage.nodeId)).map(p => p.index),
      // The stages nearer the loader, whose loras are already applied by the time this one runs.
      upstream: depth.filter(x => stacks.has(x.id) && x.id !== stage.nodeId).map(x => `node:${x.id}`),
      depth: depth.length
    };
  }).sort((a, b) => a.depth - b.depth || Number(a.nodeId) - Number(b.nodeId))
    .map(({depth, ...stage}) => stage); // nearest the loader first: stage one is where the plugin's original stack belongs
  return {passes, stages, uncovered};
}

/** A lora name the way Lora Manager stores it in its widget: forward slashes, no extension. */
const stackName = name => {
  const s = String(name ?? '').trim().replace(/\\/g, '/'), low = s.toLowerCase();
  for (const ext of MODEL_EXTS) if (low.endsWith(ext)) return s.slice(0, -ext.length);
  return s;
};

/**
 * Writes each stage's stack into its stack node. Only that node's own two widgets are replaced — every other node,
 * including the ones the user wired up by hand, comes back exactly as it went in.
 */
export function writeStages(text, plan, stacks) {
  const anchored = (plan?.stages || []).filter(s => s.kind === 'node');
  if (!anchored.length) return text;
  let data; try { data = JSON.parse(String(text || '')); } catch { return text; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return text;
  for (const stage of anchored) {
    const node = data[stage.nodeId];
    if (!node || node.class_type !== STACK_NODE || !node.inputs || typeof node.inputs !== 'object') continue;
    const list = (Array.isArray(stacks?.[stage.key]) ? stacks[stage.key] : []).filter(l => l && stackName(l.name)).slice(0, LORA_MAX);
    node.inputs.loras = {__value__: list.map(l => ({name: stackName(l.name), strength: clampStrength(l.model), active: l.on !== false, expanded: false, clipStrength: clampStrength(l.clip), selected: false, locked: false}))};
    // The text widget is a mirror Lora Manager keeps for its own UI — its node ignores it while running — so it is
    // written the way that UI writes it: the active loras only, with the clip strength when it differs from the model's.
    node.inputs.text = list.filter(l => l.on !== false).map(l => {
      const model = clampStrength(l.model), clip = clampStrength(l.clip);
      return clip === model ? `<lora:${stackName(l.name)}:${model}>` : `<lora:${stackName(l.name)}:${model}:${clip}>`;
    }).join(' ');
  }
  return JSON.stringify(data);
}

/** The whole plan into a filled workflow: an injected chain where there is no stack node, widget writes where there is. */
export function applyLoras(text, plan, stacks) {
  let out = text;
  for (const stage of plan?.stages || []) if (stage.kind === 'inject') out = injectLoras(out, stacks?.[stage.key] || []);
  return writeStages(out, plan, stacks);
}

/**
 * For a loader with no CLIP output of its own (UNETLoader and friends, where a separate CLIPLoader feeds the graph):
 * the one CLIP source the loader's consumers all run on, and the nodes holding that link, so the injected chain can
 * carry CLIP too and be hung in front of them. The CLIP is found either on the consumer itself (a Lora Manager node
 * takes model and clip side by side) or one hop away on its text encoders (a KSampler takes CLIP through positive and
 * negative). Returns null when the consumers disagree, when one of them runs on no CLIP, or when nothing reads the
 * loader — the chain can then only carry the model.
 */
function clipRoute(data, loaderId, modelOut) {
  let clip = null;
  const holders = new Set();
  for (const [id, node] of Object.entries(data)) {
    if (!node || typeof node !== 'object') continue;
    const consumesModel = Object.values(node.inputs || {}).some(v => Array.isArray(v) && String(v[0]) === String(loaderId) && v[1] === modelOut);
    if (!consumesModel) continue;
    const links = [];
    if (Array.isArray(node.inputs?.clip)) links.push([id, node.inputs.clip]);
    for (const link of Object.values(node.inputs || {})) {
      if (!Array.isArray(link)) continue;
      const source = data[link[0]];
      if (source && Array.isArray(source.inputs?.clip)) links.push([String(link[0]), source.inputs.clip]);
    }
    if (!links.length) return null;
    for (const [holderId, link] of links) {
      if (String(link[0]) === String(loaderId)) return null;
      if (clip && (String(link[0]) !== String(clip[0]) || link[1] !== clip[1])) return null;
      clip = [String(link[0]), link[1]];
      holders.add(holderId);
    }
  }
  return clip ? {clip, holders} : null;
}

/**
 * Draws the LoRA stack into a workflow at request time: after every model loader whose MODEL output something
 * reads, a LoraLoader chain is inserted (LoraLoaderModelOnly for unet-only loaders, e.g. GGUF), and every
 * connection that read the loader's MODEL (or CLIP) output now reads the chain's tail. Throws when the workflow
 * offers nothing to hook onto, so the user is told to wire loras in ComfyUI instead.
 */
export function injectLoras(text, loras) {
  const stack = (Array.isArray(loras) ? loras : []).filter(l => l && typeof l.name === 'string' && l.name && l.on !== false).slice(0, LORA_MAX);
  if (!stack.length) return text;
  let data; try { data = JSON.parse(String(text || '')); } catch { throw Error('工作流不是有效的 JSON'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('工作流格式不对');
  const loaders = Object.entries(data).filter(([id, n]) => MODEL_LOADERS[n?.class_type] && readsFrom(data, id, MODEL_LOADERS[n.class_type][0]));
  if (!loaders.length) throw Error('工作流里找不到接了线的底模节点（CheckpointLoaderSimple 一类），插件没法自动插 LoRA：请在 ComfyUI 里自己接 LoraLoader 节点，或换用带底模加载的工作流');
  let next = Object.keys(data).reduce((m, k) => { const x = Number(k); return Number.isInteger(x) && x >= 0 ? Math.max(m, x) : m; }, -1) + 1;
  for (const [sid, loader] of loaders) {
    const [modelOut, clipOut] = MODEL_LOADERS[loader.class_type];
    // A unet-only loader still gets a CLIP side when its consumers all take CLIP from one place: the chain then
    // carries CLIP too, which is what these graphs (UNET + a separate CLIPLoader) expect. A model-only chain would
    // leave the prompt untouched by the loras, which is not what the workflow's own lora nodes do.
    const route = clipOut >= 0 ? null : clipRoute(data, sid, modelOut);
    const withClip = clipOut >= 0 || !!route;
    const added = new Set();
    let prev = sid, prevOut = modelOut, prevClip = clipOut >= 0 ? [sid, clipOut] : route ? route.clip : null, last = '';
    for (const lora of stack) {
      const id = String(next++);
      if (withClip) data[id] = {class_type: 'LoraLoader', inputs: {lora_name: lora.name, strength_model: clampStrength(lora.model), strength_clip: clampStrength(lora.clip), model: [prev, prevOut], clip: [...prevClip]}};
      else data[id] = {class_type: 'LoraLoaderModelOnly', inputs: {lora_name: lora.name, strength_model: clampStrength(lora.model), model: [prev, prevOut]}};
      added.add(id); prev = id; prevOut = 0; last = id;
      if (withClip) prevClip = [id, 1];
    }
    const clipHolders = route ? route.holders : null;
    for (const [nid, n] of Object.entries(data)) {
      if (added.has(nid) || !n || typeof n !== 'object') continue;
      for (const [key, v] of Object.entries(n.inputs || {})) {
        if (!Array.isArray(v)) continue;
        if (String(v[0]) === String(sid) && v[1] === modelOut) n.inputs[key] = [last, 0];
        else if (clipOut >= 0 && String(v[0]) === String(sid) && v[1] === clipOut) n.inputs[key] = [last, 1];
      }
      // Only the text encoders whose CLIP was checked move onto the chain; anything else reading that CLIPLoader keeps
      // reading it directly, so nothing outside this loader's fan-out changes behaviour.
      if (clipHolders?.has(nid) && Array.isArray(n.inputs?.clip) && String(n.inputs.clip[0]) === route.clip[0] && n.inputs.clip[1] === route.clip[1]) n.inputs.clip = [last, 1];
    }
  }
  return JSON.stringify(data);
}

/** The enabled loras' trigger words, deduped and prepended to the positive prompt (whole-word tags, case-insensitive). */
export function loraTriggers(prompt, loras) {
  const words = (Array.isArray(loras) ? loras : []).flatMap(l => l && l.on !== false ? String(l.trigger || '').split(',') : []).map(t => t.trim()).filter(Boolean);
  if (!words.length) return prompt;
  const seen = new Set(String(prompt || '').split(',').map(t => t.trim().toLowerCase()));
  const fresh = [];
  for (const word of words) { const key = word.toLowerCase(); if (!seen.has(key)) { seen.add(key); fresh.push(word); } }
  return [...fresh, String(prompt || '').trim()].filter(Boolean).join(', ');
}

// The LoRA list and its trigger words live in core/lora-manager.js: the browser (or the tavern's LoRA bridge) reads
// ComfyUI and ComfyUI-Lora-Manager straight, so nothing here has to hash a file or call Civitai any more.

// ---------- Auto placeholders ----------
// A fresh API export has no placeholders: this walks the graph from the samplers and marks the spots the plugin
// obviously owns (prompts, seed, size, model …). Anything ambiguous stays untouched and is reported, so the worst
// case for a workflow the plugin cannot fully understand is the old manual flow, never a broken one.
// (SAMPLER_NODES, the samplers it walks the graph from, is declared with the LoRA stages above and shared here.)
const TEXT_ENCODERS = {CLIPTextEncode: ['text'], 'smZ CLIPTextEncode': ['text'], CLIPTextEncodeSDXL: ['text_g', 'text_l'], CLIPTextEncodeSDXLRefiner: ['text']};
const COND_PASSTHROUGH = new Set(['ConditioningSetTimestepRange', 'ConditioningSetMask', 'ConditioningSetArea', 'ConditioningSetAreaStrength', 'ConditioningSetAreaPercentage']);
const COND_COMBINE = new Set(['ConditioningCombine', 'ConditioningConcat', 'ConditioningAverage']);
const MODEL_LOADER_FIELDS = {CheckpointLoaderSimple: 'ckpt_name', CheckpointLoader: 'ckpt_name', UNETLoader: 'unet_name', UnetLoaderGGUF: 'unet_name', UnetLoaderGGUFAdvanced: 'unet_name'};
const PLACEHOLDER_NAMES = {prompt: '正面提示词', negative_prompt: '负面提示词', seed: '种子', steps: '步数', scale: 'CFG', sampler: '采样器', scheduler: '噪声调度', width: '宽度', height: '高度', model: '底模', clip_skip: 'CLIP 跳层'};

/**
 * Marks an imported workflow with the plugin's placeholders. Returns {workflow, marked, notes, model}: marked lines
 * say what went where, notes say what was left alone and why, model is the checkpoint the workflow shipped with when
 * %model% was just marked (the caller makes it the plugin's model choice so the two never disagree).
 */
export function autoPlaceholders(text) {
  let data; try { data = JSON.parse(String(text || '')); } catch { throw Error('工作流不是有效的 JSON'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('工作流格式不对');
  if (Array.isArray(data.nodes) && data.links) throw Error('这是界面格式的工作流：请在 ComfyUI 里用「导出 (API)」（Export (API)）重新导出');
  const marked = [], notes = [];
  let model = '';
  const label = id => `节点 ${id}（${data[String(id)]?.class_type || '?'}）`;
  // A widget worth marking is a number or a string (empty counts: a fresh export often leaves the negative blank);
  // a connection ([id, out]) is left alone, and so is any text that already carries a placeholder or a % of any kind.
  const markable = value => typeof value === 'number' || (typeof value === 'string' && !value.includes('%'));
  const put = (id, field, name) => {
    const value = data[String(id)]?.inputs?.[field];
    if (!markable(value)) return false;
    data[String(id)].inputs[field] = `%${name}%`;
    marked.push(`${PLACEHOLDER_NAMES[name] || name} → ${label(id)}`);
    return true;
  };
  const isRef = value => Array.isArray(value) && value.length >= 2;
  // The prompt that reaches a sampler may sit behind conditioning helpers; walk down to the text encoder. A chain
  // that merges several prompts is not guessed.
  const traceCond = (ref, name, depth = 0) => {
    if (!isRef(ref) || depth > 8) return;
    const n = data[String(ref[0])];
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(TEXT_ENCODERS[n.class_type])) { for (const field of TEXT_ENCODERS[n.class_type]) put(ref[0], field, name); return; }
    if (n.class_type === 'ConditioningZeroOut') { notes.push(`${label(ref[0])} 是从另一路提示词推导的（ConditioningZeroOut），不用标`); return; }
    if (COND_COMBINE.has(n.class_type)) { notes.push(`${label(ref[0])} 合并了多路提示词，插件不猜：把要用的那一路的文字手动改成 %${name}%`); return; }
    if (COND_PASSTHROUGH.has(n.class_type)) { traceCond(n.inputs?.conditioning, name, depth + 1); return; }
    notes.push(`${label(ref[0])} 不是认识的提示词节点，没有动它；需要的话把它的文字栏手动改成 %${name}%`);
  };
  for (const id of Object.keys(data).filter(id => SAMPLER_NODES.has(data[id]?.class_type))) {
    const inputs = data[id].inputs || {};
    if ('positive' in inputs) traceCond(inputs.positive, 'prompt');
    if ('negative' in inputs) traceCond(inputs.negative, 'negative_prompt');
    if ('seed' in inputs) put(id, 'seed', 'seed');
    if ('noise_seed' in inputs) put(id, 'noise_seed', 'seed');
    if ('cfg' in inputs) put(id, 'cfg', 'scale');
    if ('steps' in inputs) put(id, 'steps', 'steps');
    if ('sampler_name' in inputs) put(id, 'sampler_name', 'sampler');
    if ('scheduler' in inputs) put(id, 'scheduler', 'scheduler');
    // SamplerCustom keeps the sampler name and the scheduler in helper nodes.
    if (isRef(inputs.sampler) && data[String(inputs.sampler[0])]?.class_type === 'KSamplerSelect') put(inputs.sampler[0], 'sampler_name', 'sampler');
    if (isRef(inputs.sigmas) && /Scheduler$/.test(String(data[String(inputs.sigmas[0])]?.class_type))) { put(inputs.sigmas[0], 'steps', 'steps'); put(inputs.sigmas[0], 'scheduler', 'scheduler'); }
  }
  for (const [id, n] of Object.entries(data)) {
    if (typeof n?.class_type === 'string' && n.class_type.startsWith('Empty') && n.inputs && 'width' in n.inputs && 'height' in n.inputs) { put(id, 'width', 'width'); put(id, 'height', 'height'); }
    if (n?.class_type === 'CLIPSetLastLayer') put(id, 'stop_at_clip_layer', 'clip_skip');
  }
  // The checkpoint: only when there is exactly one loader, so a refine-the-output workflow keeps its second model.
  const loaders = Object.entries(data).filter(([, n]) => MODEL_LOADER_FIELDS[n?.class_type]);
  if (loaders.length === 1) {
    const [id, n] = loaders[0], field = MODEL_LOADER_FIELDS[n.class_type];
    if (markable(n.inputs?.[field])) {
      model = String(n.inputs[field]);
      n.inputs[field] = '%model%';
      marked.push(`底模 → ${label(id)}`);
    }
  } else if (loaders.length > 1) {
    notes.push(`有 ${loaders.length} 个底模节点，怕标错没有动：把主底模的文件名手动改成 %model%，其余保持写死`);
  }
  return {workflow: JSON.stringify(data), marked: [...new Set(marked)], notes: [...new Set(notes)], model};
}
