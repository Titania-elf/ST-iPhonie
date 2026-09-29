// Drawing settings, the LLM-facing drawing preset, and <img prompt="…"> tags in chat text.
//
// Two kinds of preset live here:
//   styles  - "画风预设" edited in the drawing app: artist tags, fixed positive and fixed negative tags for NovelAI.
//   presets - "绘图预设" edited in the preset app: rules injected into the chat request so the model writes <img> tags.
import {defaultDrawParams, normalizeDrawParams, guardParams} from './novelai.js';
import {escapeHTML, isPlaceholderRole} from './protocol.js';

export const PIC_TAG_FORMAT = '<img prompt="英文画面 tag，逗号分隔" characters="画面里的角色名，逗号分隔">';
export const DEFAULT_DRAW_RULE = [
  '画面有明显变化时（换了场景、重要动作、角色登场、情绪到了高点），在那一段正文后面单独写一个出图标签，格式：',
  '{{出图格式}}',
  'prompt 用英文 danbooru tag 描述这一刻的画面：人数（1girl、2girls、1boy 等）、动作、表情、服装、场景、光线、镜头构图，用英文逗号分隔。不要写画师名和质量词，也不要写角色固定的外貌特征，这些会自动补上。',
  'characters 写画面里出现的角色名，用逗号分隔，只写这些名字：{{角色列表}}。',
  '每条回复最多写一个出图标签。不要解释这个标签，也不要放进代码块。'
].join('\n');
const DEFAULT_STYLE = {id: 'default', name: '默认画风', artist: '', positive: 'masterpiece, best quality, very aesthetic, absurdres', negative: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digits, cropped, worst quality, jpeg artifacts, signature, watermark, blurry'};
const DEFAULT_PRESET = {id: 'default', name: '默认出图规则', injection: {position: 'in_chat', depth: 1, role: 'system'}, entries: [{id: 'rule', title: '出图规则', enabled: true, text: DEFAULT_DRAW_RULE}]};

export function defaultDraw() {
  return {enabled: false, auto: true, guard: true, params: defaultDrawParams(), styles: [structuredClone(DEFAULT_STYLE)], activeStyle: 'default', presets: [structuredClone(DEFAULT_PRESET)], activePreset: 'default'};
}

const text = (value, max) => String(value ?? '').slice(0, max);
export function normalizeDraw(value) {
  const base = defaultDraw();
  if (!value || typeof value !== 'object') return base;
  const d = {...base, ...structuredClone(value)};
  d.enabled = !!d.enabled;
  d.auto = d.auto !== false;
  d.guard = d.guard !== false;
  d.params = normalizeDrawParams(d.params);
  d.styles = (Array.isArray(d.styles) && d.styles.length ? d.styles : base.styles).map(s => ({id: String(s.id || crypto.randomUUID()), name: text(s.name, 60) || '画风', artist: text(s.artist, 4000), positive: text(s.positive, 4000), negative: text(s.negative, 4000)}));
  d.activeStyle = d.styles.some(s => s.id === d.activeStyle) ? d.activeStyle : d.styles[0].id;
  d.presets = (Array.isArray(d.presets) && d.presets.length ? d.presets : base.presets).map(p => ({
    id: String(p.id || crypto.randomUUID()), name: text(p.name, 60) || '出图规则',
    injection: {...DEFAULT_PRESET.injection, ...p.injection},
    entries: (Array.isArray(p.entries) ? p.entries : []).map(e => ({id: String(e.id || crypto.randomUUID()), title: text(e.title, 80), enabled: e.enabled !== false, text: text(e.text, 20000), ...(e.injection ? {injection: {...DEFAULT_PRESET.injection, ...e.injection}} : {})}))
  }));
  d.activePreset = d.presets.some(p => p.id === d.activePreset) ? d.activePreset : d.presets[0].id;
  return d;
}

export function validateDrawPreset(p) {
  if (!p?.name?.trim()) throw Error('请填写绘图预设名称');
  for (const i of [p.injection, ...p.entries.map(e => e.injection).filter(Boolean)]) {
    if (!['in_chat', 'in_prompt', 'before_prompt'].includes(i.position) || !['system', 'user', 'assistant'].includes(i.role)) throw Error('插入位置或身份无效');
    if (!Number.isInteger(Number(i.depth)) || i.depth < 0 || i.depth > 10000) throw Error('插入深度需为 0–10000 的整数');
  }
  const body = p.entries.filter(e => e.enabled).map(e => e.text).join('\n');
  if (!body.trim()) throw Error('至少启用一条出图规则');
  if (!body.includes('{{出图格式}}') && !/<img\s/i.test(body)) throw Error('出图规则里需要包含 {{出图格式}}，让模型知道标签怎么写');
  return p;
}

export const activeStyle = draw => draw.styles.find(s => s.id === draw.activeStyle) || draw.styles[0];

/** Prompt entries injected with the chat request. Keys share the sttts.entry. prefix so they clear together. */
export function drawPromptPlan(settings, preset) {
  const draw = settings.draw;
  if (!draw?.enabled && !preset) return [];
  const p = preset || draw.presets.find(x => x.id === draw.activePreset);
  if (!p) return [];
  const names = settings.routes.filter(r => !isPlaceholderRole(r.name)).map(r => r.name);
  const list = names.length ? names.join('、') : '（还没有角色，按正文里的名字写）';
  return p.entries.filter(e => e.enabled && e.text.trim()).map((e, index) => {
    const i = e.injection || p.injection;
    return {
      key: 'sttts.entry.draw.' + String(index).padStart(4, '0'),
      text: e.text.replaceAll('{{出图格式}}', PIC_TAG_FORMAT).replaceAll('{{角色列表}}', list),
      position: {in_chat: 1, in_prompt: 0, before_prompt: 2}[i.position],
      depth: i.position === 'in_chat' ? Number(i.depth) : 0,
      role: i.position === 'in_chat' ? {system: 0, user: 1, assistant: 2}[i.role] : 0
    };
  });
}

// ---------- <img> tags in chat text ----------
const TAG = /<img\b([^<>]*?)\/?>/gi;
const attribute = (source, name) => {
  const m = source.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|“([^”]*)”)`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3] ?? '').trim() : null;
};
export function hashText(value) {
  let h = 0x811c9dc5;
  for (const ch of value) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** Finds model-written picture tags: only <img> tags with a prompt attribute and no src. */
export function parsePictures(message) {
  const found = [];
  for (const m of String(message).matchAll(TAG)) {
    const source = m[1];
    if (/\bsrc\s*=/i.test(source)) continue;
    const prompt = attribute(source, 'prompt');
    if (!prompt) continue;
    const characters = (attribute(source, 'characters') || '').split(/[,，、]/).map(x => x.trim()).filter(Boolean);
    const index = found.length;
    found.push({index, start: m.index, end: m.index + m[0].length, prompt: prompt.slice(0, 4000), characters, hash: hashText(index + '|' + prompt + '|' + characters.join(','))});
  }
  return found;
}

/** Replaces picture tags with placeholders that the host fills in after rendering. */
export function renderPictures(message, marker) {
  const tags = parsePictures(message);
  if (!tags.length) return message;
  let out = '', at = 0;
  for (const tag of tags) {
    out += message.slice(at, tag.start) + `<span class="sttts-pic" data-sttts-pic="${tag.index}" data-sttts-hash="${escapeHTML(tag.hash)}" data-sttts-token="${escapeHTML(marker)}"></span>`;
    at = tag.end;
  }
  return out + message.slice(at);
}

/** Final NovelAI inputs for a picture tag: active style + tag prompt, character appearances as V4 character captions. */
export function pictureInputs(settings, tag) {
  const draw = settings.draw, style = activeStyle(draw);
  const characters = tag.characters.map(name => settings.routes.find(r => r.name === name)).filter(r => r?.appearance?.trim()).map(r => ({prompt: r.appearance.trim(), negative: '', position: -1}));
  return {
    prompt: [style.artist, style.positive, tag.prompt].map(x => (x || '').trim()).filter(Boolean).join(', '),
    negative: style.negative.trim(),
    characters,
    params: draw.guard ? guardParams(draw.params) : draw.params
  };
}
