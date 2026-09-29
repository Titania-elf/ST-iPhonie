// Drawing settings, the LLM-facing drawing preset, and <img>…</img> picture tags in chat text.
//
// Two kinds of preset live here:
//   styles  - "画风预设" edited in the drawing app: artist tags, fixed positive and fixed negative tags for NovelAI.
//   presets - "绘图预设" edited in the preset app: rules injected into the chat request so the model writes <img> tags.
import {defaultDrawParams, normalizeDrawParams, guardParams} from './novelai.js';
import {escapeHTML, isPlaceholderRole} from './protocol.js';

// Plain paired tag without attributes, so plugins that exclude <tag></tag> blocks can drop it: <img>prompt|characters</img>.
export const PIC_TAG_FORMAT = '<img>英文画面 tag，逗号分隔|画面里的角色名，逗号分隔</img>';
export const DEFAULT_DRAW_RULE = [
  '在这条回复里挑出 {{出图数量}} 个最有画面感的时刻（换了场景、重要动作、角色登场、情绪到了高点），在每个时刻那一段正文后面单独写一个出图标签，格式：',
  '{{出图格式}}',
  '竖线前用英文 danbooru tag 描述这一刻的画面：人数（1girl、2girls、1boy 等）、动作、表情、服装、场景、光线、镜头构图，用英文逗号分隔。不要写画师名和质量词，也不要写角色固定的外貌特征，这些会自动补上。',
  '竖线后写画面里出现的角色名，用逗号分隔，只写这些名字：{{角色列表}}。画面里没有这些角色时，连同竖线一起省略。',
  '不要解释这些标签，也不要放进代码块。'
].join('\n');
export const DRAW_COUNT_MAX = 10;
/** Appended after the preset's own rules, so every preset asks for exactly its picture count. */
export const drawContract = count => [
  '【出图硬性规则】',
  `这条回复必须正好写 ${count} 个出图标签，不能多也不能少，也不能省略。`,
  count > 1 ? '标签分开放在正文里不同的位置，各自描述不同的画面，每个标签单独占一行。' : '标签单独占一行，放在最有画面感的那一段后面。',
  '标签严格照这个格式写并闭合：{{出图格式}}',
  '竖线后的角色名只能从这些名字里选，写法一字不差：{{角色列表}}。画面里有谁就写谁，用逗号分隔；插件靠这些名字补上角色外貌。',
  '写完正文后自己数一遍标签数量，不对就补上或删掉，再输出。不输出核对过程。'
].join('\n');
// The rule text written for the earlier <img prompt="…"> tag. Saved presets that still hold it word for word are updated on load.
const LEGACY_DRAW_RULE = [
  '画面有明显变化时（换了场景、重要动作、角色登场、情绪到了高点），在那一段正文后面单独写一个出图标签，格式：',
  '{{出图格式}}',
  'prompt 用英文 danbooru tag 描述这一刻的画面：人数（1girl、2girls、1boy 等）、动作、表情、服装、场景、光线、镜头构图，用英文逗号分隔。不要写画师名和质量词，也不要写角色固定的外貌特征，这些会自动补上。',
  'characters 写画面里出现的角色名，用逗号分隔，只写这些名字：{{角色列表}}。',
  '每条回复最多写一个出图标签。不要解释这个标签，也不要放进代码块。'
].join('\n');
const DEFAULT_STYLE = {id: 'default', name: '默认画风', artist: '', positive: 'masterpiece, best quality, very aesthetic, absurdres', negative: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digits, cropped, worst quality, jpeg artifacts, signature, watermark, blurry'};
const DEFAULT_PRESET = {id: 'default', name: '默认出图规则', count: 1, injection: {position: 'in_chat', depth: 1, role: 'system'}, entries: [{id: 'rule', title: '出图规则', enabled: true, text: DEFAULT_DRAW_RULE}]};

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
    count: Math.min(DRAW_COUNT_MAX, Math.max(1, Math.round(Number(p.count)) || 1)),
    injection: {...DEFAULT_PRESET.injection, ...p.injection},
    entries: (Array.isArray(p.entries) ? p.entries : []).map(e => ({id: String(e.id || crypto.randomUUID()), title: text(e.title, 80), enabled: e.enabled !== false, text: e.text === LEGACY_DRAW_RULE ? DEFAULT_DRAW_RULE : text(e.text, 20000), ...(e.injection ? {injection: {...DEFAULT_PRESET.injection, ...e.injection}} : {})}))
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
  if (!body.includes('{{出图格式}}') && !/<img[\s>]/i.test(body)) throw Error('出图规则里需要包含 {{出图格式}}，让模型知道标签怎么写');
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
  const count = Math.min(DRAW_COUNT_MAX, Math.max(1, Math.round(Number(p.count)) || 1));
  const fill = t => t.replaceAll('{{出图格式}}', PIC_TAG_FORMAT).replaceAll('{{角色列表}}', list).replaceAll('{{出图数量}}', String(count));
  const entries = p.entries.filter(e => e.enabled && e.text.trim());
  return entries.map((e, index) => {
    const i = e.injection || p.injection;
    return {
      key: 'sttts.entry.draw.' + String(index).padStart(4, '0'),
      text: fill(e.text) + (index === entries.length - 1 ? '\n\n' + fill(drawContract(count)) : ''),
      position: {in_chat: 1, in_prompt: 0, before_prompt: 2}[i.position],
      depth: i.position === 'in_chat' ? Number(i.depth) : 0,
      role: i.position === 'in_chat' ? {system: 0, user: 1, assistant: 2}[i.role] : 0
    };
  });
}

// ---------- <img> tags in chat text ----------
// Current form: <img>prompt|characters</img>. Earlier form: <img prompt="…" characters="…"> (still read, so old replies keep their pictures).
const PAIRED = /<img\b([^<>]*)>([^<]*)<\/img\s*>/gi;
const SINGLE = /<img\b([^<>]*?)\/?>/gi;
const attribute = (source, name) => {
  const m = source.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|“([^”]*)”)`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3] ?? '').trim() : null;
};
export function hashText(value) {
  let h = 0x811c9dc5;
  for (const ch of value) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** Finds model-written picture tags: <img>prompt|characters</img>, or the older <img prompt="…">. Images with src are left alone. */
export function parsePictures(message) {
  message = String(message);
  const tags = [];
  for (const m of message.matchAll(PAIRED)) {
    if (/\bsrc\s*=/i.test(m[1])) continue;
    const [body, ...who] = m[2].split(/[|｜]/);
    tags.push({start: m.index, end: m.index + m[0].length, prompt: attribute(m[1], 'prompt') ?? body.trim(), who: attribute(m[1], 'characters') ?? who.join(',')});
  }
  for (const m of message.matchAll(SINGLE)) {
    if (tags.some(t => t.start <= m.index && m.index < t.end) || /\bsrc\s*=/i.test(m[1])) continue;
    tags.push({start: m.index, end: m.index + m[0].length, prompt: attribute(m[1], 'prompt'), who: attribute(m[1], 'characters') || ''});
  }
  const found = [];
  for (const tag of tags.sort((a, b) => a.start - b.start)) {
    if (!tag.prompt) continue;
    const characters = tag.who.split(/[,，、]/).map(x => x.trim()).filter(Boolean), index = found.length;
    found.push({index, start: tag.start, end: tag.end, prompt: tag.prompt.slice(0, 4000), characters, hash: hashText(index + '|' + tag.prompt + '|' + characters.join(','))});
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

// ---------- Characters in a picture ----------
// Names are compared loosely: case, spaces, dots and bracketed notes are ignored, and one name may contain the other
// (the model may write 澄音（Sumine） or "Sumine" for a role named 澄音 Sumine).
const loose = name => String(name || '').toLowerCase().replace(/[（(【\[「『][^）)】\]」』]*[）)】\]」』]/g, '').replace(/[\s·・．.\-_'"“”]/g, '');
function sameName(a, b) {
  const x = loose(a), y = loose(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 2 && (x.includes(y) || y.includes(x)));
}
/** How many people the prompt asks for (1girl, 2boys, 3others …); 0 when it does not say. */
export function peopleCount(prompt) {
  let n = 0;
  for (const m of String(prompt).matchAll(/(?:^|[,\s(])(\d+)\+?\s*(?:girls?|boys?|others?)\b/gi)) n += Number(m[1]);
  return n;
}
/**
 * Roles whose appearance goes into the picture. Names in the tag come first; when the tag names nobody we know,
 * the roles mentioned in the story text just before the tag are used, up to the number of people in the prompt.
 */
export function pictureRoles(settings, tag, text = '') {
  const roles = settings.routes.filter(r => r.appearance?.trim() && !isPlaceholderRole(r.name));
  const named = [];
  for (const name of tag.characters) {
    const role = roles.find(r => sameName(r.name, name));
    if (role && !named.includes(role)) named.push(role);
  }
  if (named.length || !text) return named;
  const before = String(text).slice(Math.max(0, (tag.start ?? 0) - 600), tag.start ?? undefined).toLowerCase();
  const seen = roles.map(r => [r, before.lastIndexOf(r.name.toLowerCase())]).filter(([, at]) => at >= 0).sort((a, b) => b[1] - a[1]).map(([r]) => r);
  return seen.slice(0, peopleCount(tag.prompt) || 1);
}

/** Final NovelAI inputs for a picture tag: active style + tag prompt, character appearances as V4 character captions.
 *  names: the roles whose appearance was added. text: the message, used when the tag names no known role. */
export function pictureInputs(settings, tag, text = '') {
  const draw = settings.draw, style = activeStyle(draw), roles = pictureRoles(settings, tag, text);
  return {
    prompt: [style.artist, style.positive, tag.prompt].map(x => (x || '').trim()).filter(Boolean).join(', '),
    negative: style.negative.trim(),
    characters: roles.map(r => ({prompt: r.appearance.trim(), negative: '', position: -1})),
    names: roles.map(r => r.name),
    params: draw.guard ? guardParams(draw.params) : draw.params
  };
}
