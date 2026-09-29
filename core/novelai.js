// NovelAI image client used directly from the browser (image.novelai.net allows cross-origin requests).
// The key stays in this browser; nothing here goes through the tavern server.

export const NAI_HOST = 'https://image.novelai.net';
export const NAI_MODELS = ['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'nai-diffusion-4-full', 'nai-diffusion-4-curated-preview', 'nai-diffusion-3'];
export const NAI_SAMPLERS = ['k_euler_ancestral', 'k_euler', 'k_dpmpp_2s_ancestral', 'k_dpmpp_2m_sde', 'k_dpmpp_2m', 'k_dpmpp_sde'];
export const NAI_SCHEDULES = ['karras', 'exponential', 'polyexponential'];
// Free for Opus subscribers: one image, at most 28 steps and 1024x1024 pixels.
export const FREE_STEPS = 28;
export const FREE_PIXELS = 1024 * 1024;
const REFERENCE_PIXELS = 832 * 1216;

export const isV4 = model => /^nai-diffusion-4/.test(model);

export function defaultDrawParams() {
  return {model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', schedule: 'karras', seed: -1, cfgRescale: 0, variety: false};
}

export function normalizeDrawParams(value = {}) {
  const base = defaultDrawParams(), p = {...base, ...value};
  const num = (v, min, max, fallback, step = 1) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n / step) * step)) : fallback; };
  p.model = NAI_MODELS.includes(p.model) ? p.model : base.model;
  p.sampler = NAI_SAMPLERS.includes(p.sampler) ? p.sampler : base.sampler;
  p.schedule = NAI_SCHEDULES.includes(p.schedule) ? p.schedule : base.schedule;
  p.width = num(p.width, 64, 1856, base.width, 64);
  p.height = num(p.height, 64, 1856, base.height, 64);
  p.steps = num(p.steps, 1, 50, base.steps);
  p.scale = num(p.scale, 0, 10, base.scale, .1);
  p.cfgRescale = num(p.cfgRescale, 0, 1, 0, .02);
  p.seed = num(p.seed, -1, 4294967295, -1);
  p.variety = !!p.variety;
  return p;
}

/** True only when the request is covered by an unlimited subscription; null when the subscription is unknown. */
export function isFree(params, subscription) {
  const small = params.steps <= FREE_STEPS && params.width * params.height <= FREE_PIXELS;
  if (!small) return false;
  if (!subscription) return null;
  return !!subscription.unlimited;
}

/** Clamps parameters into the free range while keeping the aspect ratio (multiples of 64). */
export function guardParams(params) {
  const p = {...params, steps: Math.min(params.steps, FREE_STEPS)};
  if (p.width * p.height > FREE_PIXELS) {
    const ratio = Math.sqrt(FREE_PIXELS / (p.width * p.height));
    p.width = Math.max(64, Math.floor(p.width * ratio / 64) * 64);
    p.height = Math.max(64, Math.floor(p.height * ratio / 64) * 64);
  }
  return p;
}

// 5x5 position grid (index 0..24, row-major) to NovelAI's 0..1 coordinates.
export const gridCenter = index => ({x: +(.1 + (index % 5) * .2).toFixed(1), y: +(.1 + Math.floor(index / 5) * .2).toFixed(1)});

/**
 * Builds the generate-image request body.
 * prompt/negative are final strings; characters: [{prompt, negative, position}] where position is a grid index or -1 (let the model place it).
 */
export function buildImageRequest({prompt, negative = '', characters = [], params}) {
  const p = normalizeDrawParams(params);
  const seed = p.seed >= 0 ? p.seed : Math.floor(Math.random() * 4294967295);
  const parameters = {
    params_version: 3, width: p.width, height: p.height, scale: p.scale, sampler: p.sampler, steps: p.steps, n_samples: 1, seed,
    ucPreset: 0, qualityToggle: false, dynamic_thresholding: false, controlnet_strength: 1, legacy: false, add_original_image: false,
    cfg_rescale: p.cfgRescale, noise_schedule: p.schedule, legacy_v3_extend: false, deliberate_euler_ancestral_bug: false, prefer_brownian: true,
    skip_cfg_above_sigma: p.variety ? Math.pow(p.width * p.height / REFERENCE_PIXELS, .5) * (p.model.includes('4-5') ? 58 : 19) : null,
    negative_prompt: negative
  };
  if (isV4(p.model)) {
    const chars = characters.filter(c => c.prompt?.trim());
    const useCoords = chars.some(c => c.position >= 0);
    const center = c => c.position >= 0 ? gridCenter(c.position) : {x: .5, y: .5};
    Object.assign(parameters, {
      use_coords: useCoords,
      characterPrompts: chars.map(c => ({prompt: c.prompt, uc: c.negative || '', center: center(c), enabled: true})),
      v4_prompt: {caption: {base_caption: prompt, char_captions: chars.map(c => ({char_caption: c.prompt, centers: [center(c)]}))}, use_coords: useCoords, use_order: true},
      v4_negative_prompt: {caption: {base_caption: negative, char_captions: chars.map(c => ({char_caption: c.negative || '', centers: [center(c)]}))}, legacy_uc: false}
    });
  } else {
    // V3 has no character captions: appearances are appended to the main prompt.
    const extra = characters.map(c => c.prompt).filter(Boolean).join(', ');
    prompt = [prompt, extra].filter(Boolean).join(', ');
    Object.assign(parameters, {sm: false, sm_dyn: false});
  }
  return {body: {input: prompt, model: p.model, action: 'generate', parameters}, seed, params: p};
}

// Reads the first PNG from a ZIP archive (stored or deflated) using the central directory.
export async function unzipFirstImage(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return new Blob([bytes], {type: 'image/png'});
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw Error('NovelAI 返回的内容无法识别');
  let at = view.getUint32(end + 16, true);
  const count = view.getUint16(end + 10, true);
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true), size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true), extraLength = view.getUint16(at + 30, true), commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (!/\.(png|webp|jpe?g)$/i.test(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    const type = /\.webp$/i.test(name) ? 'image/webp' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'image/png';
    if (method === 0) return new Blob([data], {type});
    if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Blob([await new Response(stream).arrayBuffer()], {type});
    }
    throw Error('NovelAI 返回的压缩格式不受支持');
  }
  throw Error('NovelAI 返回的压缩包里没有图片');
}

function failure(status, text) {
  if (status === 401) return Error('NovelAI 密钥无效或已过期，请在引擎卡包里重新填写');
  if (status === 402) return Error('Anlas 不足，或当前订阅不支持这次生成');
  if (status === 429) return Error('NovelAI 正在处理上一张图，请稍后再试');
  if (status === 400) return Error('NovelAI 拒绝了这次请求：' + (text || '参数无效').slice(0, 160));
  return Error(`NovelAI 暂时不可用（${status}）`);
}

export class NovelAIClient {
  constructor(fetcher = (...args) => globalThis.fetch(...args)) { this.fetch = fetcher; this.key = ''; }
  setKey(key) { this.key = String(key || '').trim(); }
  get configured() { return !!this.key; }
  headers() {
    if (!this.key) throw Error('还没有填写 NovelAI 密钥');
    return {Authorization: 'Bearer ' + this.key, 'Content-Type': 'application/json'};
  }
  async subscription(signal) {
    const response = await this.fetch(NAI_HOST + '/user/subscription', {headers: this.headers(), signal});
    if (!response.ok) throw failure(response.status, await response.text().catch(() => ''));
    const data = await response.json();
    const steps = data.trainingStepsLeft || {};
    return {tier: Number(data.tier) || 0, active: !!data.active, unlimited: !!data.perks?.unlimitedImageGeneration, anlas: (Number(steps.fixedTrainingStepsLeft) || 0) + (Number(steps.purchasedTrainingSteps) || 0), checkedAt: Date.now()};
  }
  async generate(body, signal) {
    const response = await this.fetch(NAI_HOST + '/ai/generate-image', {method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal});
    if (!response.ok) throw failure(response.status, await response.text().catch(() => ''));
    return unzipFirstImage(await response.arrayBuffer());
  }
}

export const TIER_NAMES = {0: '未订阅', 1: 'Tablet', 2: 'Scroll', 3: 'Opus'};
