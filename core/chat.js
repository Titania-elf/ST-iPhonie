// Chat app logic without DOM or network: chat presets, manual contacts, the reply prompt, the reply parser,
// and the text that carries a phone chat into the next story reply ("带进剧情").
//
// A chat preset holds the rules the model follows when it answers in the phone, how many recent story messages
// and chat messages it sees, and the template used when a chat is brought into the story.
import {parseDialogue, isPlaceholderRole} from './protocol.js';

export const CHAT_LIMITS = Object.freeze({contacts: 200, persona: 4000, story: 40, history: 200});

export const DEFAULT_CHAT_ENTRIES = Object.freeze([
  {id: 'style', title: '短信口吻', text: '你在一个手机聊天软件里，以联系人本人的身份回复{{用户}}。像真的在发手机消息：口语、简短，一次发一到三条，每条一两句话。可以用语气词和颜文字，不写动作、旁白和心理描写，不加引号。'},
  {id: 'persona', title: '守住人设', text: '严格按每个联系人的人设、和{{用户}}的关系、说话习惯来回复。最近的剧情只作背景：可以提到发生过的事，但不要复述剧情，也不要替{{用户}}说话。'},
  {id: 'group', title: '群聊', text: '群聊里每次由一到三位成员接话，谁接话看话题和各自性格，成员之间也可以互相回应、吐槽。'},
  {id: 'voice', title: '语音消息', text: '情绪强烈、不方便打字，或者想让对方听到声音时，可以发语音消息，偶尔发就好。语音消息整条写成：{{语音格式}}\n能发语音的人和各自的语音语言：{{可发语音}}'}
]);
export const DEFAULT_BRING = '以下是{{用户}}刚才在手机上和{{对象}}的聊天记录。接下来的正文可以自然地承接、提到或回应这段聊天，不要原样复述：\n{{聊天记录}}';
const DEFAULT_INJECTION = {position: 'in_chat', depth: 1, role: 'system'};
const DEFAULT_PRESET = {id: 'default', name: '日常短信', context: 6, history: 30, bring: DEFAULT_BRING, injection: DEFAULT_INJECTION, entries: DEFAULT_CHAT_ENTRIES.map(e => ({...e, enabled: true}))};

export function defaultChat() {
  return {presets: [structuredClone(DEFAULT_PRESET)], activePreset: 'default', contacts: []};
}

const text = (value, max) => String(value ?? '').slice(0, max);
const count = (value, min, max, fallback) => { const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };

export function normalizeChatPreset(p = {}) {
  return {
    id: String(p.id || crypto.randomUUID()), name: text(p.name, 60) || '聊天预设',
    context: count(p.context, 0, CHAT_LIMITS.story, DEFAULT_PRESET.context),
    history: count(p.history, 2, CHAT_LIMITS.history, DEFAULT_PRESET.history),
    bring: text(p.bring ?? DEFAULT_BRING, 4000),
    injection: {...DEFAULT_INJECTION, ...p.injection, depth: count(p.injection?.depth, 0, 10000, DEFAULT_INJECTION.depth)},
    entries: (Array.isArray(p.entries) ? p.entries : []).map(e => ({id: String(e.id || crypto.randomUUID()), title: text(e.title, 80), enabled: e.enabled !== false, text: text(e.text, 20000)}))
  };
}

export function normalizeContact(c = {}) {
  return {id: String(c.id || crypto.randomUUID()), name: text(c.name, 40).trim(), persona: text(c.persona, CHAT_LIMITS.persona)};
}

export function normalizeChat(value) {
  const base = defaultChat();
  if (!value || typeof value !== 'object') return base;
  const presets = (Array.isArray(value.presets) && value.presets.length ? value.presets : base.presets).map(normalizeChatPreset);
  const contacts = (Array.isArray(value.contacts) ? value.contacts : []).slice(0, CHAT_LIMITS.contacts).map(normalizeContact).filter(c => c.name);
  return {presets, activePreset: presets.some(p => p.id === value.activePreset) ? value.activePreset : presets[0].id, contacts};
}

export function validateChatPreset(p) {
  if (!p?.name?.trim()) throw Error('请填写聊天预设名称');
  const i = p.injection;
  if (!['in_chat', 'in_prompt', 'before_prompt'].includes(i?.position) || !['system', 'user', 'assistant'].includes(i?.role)) throw Error('插入位置或身份无效');
  if (!p.entries.some(e => e.enabled && e.text.trim())) throw Error('至少启用一条聊天规则');
  if (!p.bring.includes('{{聊天记录}}')) throw Error('带进剧情的模板需要包含 {{聊天记录}}');
  return p;
}

export function validateContact(c, routes = []) {
  if (!c.name || isPlaceholderRole(c.name)) throw Error('请填写联系人名字');
  if (routes.some(r => r.name === c.name)) throw Error('角色 App 里已经有这个名字，直接从角色里选就好');
  return c;
}

export const activeChatPreset = chat => chat.presets.find(p => p.id === chat.activePreset) || chat.presets[0];

/** Everyone the user can message: story roles (角色 App) first, then manual contacts. */
export function chatContacts(settings) {
  const roles = settings.routes.filter(r => !isPlaceholderRole(r.name)).map(r => ({name: r.name, source: 'role', voice: !!r.voice, engine: r.voice ? r.engine : 'none', language: r.language || settings.general.defaultLanguage, persona: ''}));
  const manual = settings.chat.contacts.filter(c => !roles.some(r => r.name === c.name)).map(c => ({name: c.name, source: 'manual', id: c.id, voice: false, engine: 'none', language: '', persona: c.persona}));
  return [...roles, ...manual];
}

/** How a chat message reads in a transcript. */
export function messageLine(m, user) {
  const who = m.from === 'me' ? user : m.from;
  if (m.kind === 'voice') return `${who}：[语音] ${m.translation || m.text}`;
  if (m.kind === 'photo') return `${who}：[图片]${m.text ? ' ' + m.text : ''}`;
  if (m.kind === 'system') return '';
  return `${who}：${m.text}`;
}

const fill = (template, values) => Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), template);

/**
 * Chat-style request for one reply turn.
 * members: [{name, persona, card, voice, language}] (card: the tavern character card text, when there is one)
 * story: [{name, text}] recent story messages, oldest first.
 */
export function buildChatRequest({preset, thread, members, story = [], user = '我', userPersona = '', voiceFormat}) {
  const group = thread.type === 'group';
  const partner = group ? thread.name : members[0]?.name || thread.name;
  const speakers = members.filter(m => m.voice);
  const values = {
    '用户': user, '对象': partner,
    '语音格式': voiceFormat,
    '可发语音': speakers.length ? speakers.map(m => `${m.name}（${m.language || '中文'}）`).join('、') : '（暂时没有人能发语音，只发文字）'
  };
  const rules = preset.entries.filter(e => e.enabled && e.text.trim()).filter(e => group || e.id !== 'group').filter(e => speakers.length || e.id !== 'voice').map(e => fill(e.text, values));
  const people = members.map(m => `- ${m.name}：${(m.persona || m.card || '').trim() || '（没有资料，按剧情里的表现来）'}`).join('\n');
  const names = members.map(m => m.name).join('、');
  const system = [
    rules.join('\n\n'),
    `【聊天对象】\n${people}`,
    userPersona.trim() ? `【${user}】\n${userPersona.trim()}` : '',
    story.length ? `【最近的剧情】（只作背景参考）\n${story.map(s => `${s.name}：${s.text}`).join('\n')}` : '',
    ['【输出格式】',
      `只输出新消息，每条消息单独一行，写成「名字：消息内容」。名字只能是：${names}。`,
      `不要写${user}的消息，不要写时间、编号、引号或任何解释。`,
      speakers.length ? `语音消息的整行写成「名字：${voiceFormat}」，标签里的角色填同一个名字。` : ''].filter(Boolean).join('\n')
  ].filter(Boolean).join('\n\n');
  const history = thread.messages.filter(m => m.kind !== 'system').slice(-preset.history);
  const last = history.at(-1);
  const turn = !history.length ? `（聊天刚开始：${group ? '群里有人' : partner}主动给${user}发消息。）`
    : last.from === 'me' ? `（现在轮到${group ? '群里的成员' : partner}回复${user}。）`
    : `（${group ? '群里' : partner}可以继续说，或者换个话题。）`;
  const transcript = history.length ? `【${group ? thread.name + '（群聊）' : '和' + partner}的聊天记录】\n${history.map(m => messageLine(m, user)).filter(Boolean).join('\n')}\n\n` : '';
  return [{role: 'system', content: system}, {role: 'user', content: transcript + turn}];
}

const NAME_LINE = /^\s*(?:\*\*)?[[【]?([^\]】:：\n]{1,40}?)[\]】]?(?:\*\*)?\s*[:：]\s*(.*)$/;
const unquote = s => s.trim().replace(/^[「“"『](.*)[」”"』]$/s, '$1').trim();

/**
 * Turns the model's reply into chat messages. Lines look like 「名字：内容」; a voice line holds a voice tag
 * in `voiceFormat`. Voice from someone without a voice becomes a text message with the translation.
 */
export function parseChatReply(reply, {members, user = '我', voiceFormat, voiceNames = []}) {
  const names = members.map(m => m.name), out = [];
  const body = String(reply || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```[a-z]*\n?|```/g, '');
  for (const raw of body.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const m = raw.match(NAME_LINE);
    let from = null, content = raw;
    if (m && names.includes(m[1].trim())) { from = m[1].trim(); content = m[2]; }
    else if (m && (m[1].trim() === user || m[1].trim() === '我')) continue;
    else if (names.length === 1) from = names[0];
    else if (out.length) from = out.at(-1).from;
    if (!from || !content.trim()) continue;
    const voice = voiceFormat ? parseDialogue(content, voiceFormat)[0] : null;
    if (voice) {
      if (voiceNames.includes(from)) out.push({from, kind: 'voice', text: voice.text.trim(), translation: voice.translation.trim(), emotion: voice.emotion});
      else out.push({from, kind: 'text', text: voice.translation.trim()});
      continue;
    }
    const plain = unquote(content.replace(/<[^>]+>/g, ''));
    if (plain) out.push({from, kind: 'text', text: plain.slice(0, 4000)});
    if (out.length >= 12) break;
  }
  return out;
}

/** The text injected into the next story reply when the user brings chat messages into the story. */
export function bringText(preset, {thread, messages, user = '我'}) {
  const partner = thread.type === 'group' ? thread.name : thread.members[0] || thread.name;
  const lines = messages.map(m => messageLine(m, user)).filter(Boolean).join('\n');
  return fill(preset.bring, {'用户': user, '对象': partner, '聊天记录': lines});
}

/** Removes voice/picture tags and markup from a story message, for the chat prompt. */
export function plainStory(textValue) {
  return String(textValue || '')
    .replace(/<tts\b[^>]*>[\s\S]*?<\/tts\s*>/gi, '')
    .replace(/<img\b[^>]*>[^<]*<\/img\s*>|<img\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
