// Chat app logic without DOM or network: chat presets, manual contacts, the reply prompt, the reply parser,
// and the text that carries a phone chat into the next story reply ("带进剧情").
//
// A chat preset holds the rules the model follows when it answers in the phone, how many recent story messages
// and chat messages it sees, and the template used when a chat is brought into the story.
import {parseDialogue, isPlaceholderRole} from './protocol.js';
import {money} from './chats.js';

export const CHAT_LIMITS = Object.freeze({contacts: 200, persona: 4000, story: 40, history: 200});

export const DEFAULT_CHAT_ENTRIES = Object.freeze([
  {id: 'style', title: '短信口吻', text: '你在一个手机聊天软件里，以联系人本人的身份回复{{用户}}。像真的在发手机消息：口语、简短，一次发一到三条，每条一两句话。可以用语气词和颜文字，不写动作、旁白和心理描写，不加引号。'},
  {id: 'persona', title: '守住人设', text: '严格按每个联系人的人设、和{{用户}}的关系、说话习惯来回复。最近的剧情只作背景：可以提到发生过的事，但不要复述剧情，也不要替{{用户}}说话。'},
  {id: 'group', title: '群聊', text: '群聊里每次由一到三位成员接话，谁接话看话题和各自性格，成员之间也可以互相回应、吐槽。'},
  {id: 'features', title: '手机功能', text: '你们是在手机上聊天，可以像真人一样用手机功能，但要有理由、看场合，大多数时候还是发文字：\n- 照片：分享正在看的东西、自拍、吃的、窗外的景色，或者{{用户}}问起时。写成「名字：[图片] 一句话描述照片里拍到的画面」，写清楚看得见的东西。\n- 位置：约见面、说自己在哪、让{{用户}}来找时。写成「名字：[位置] 地点」。\n- 红包：节日、道谢、道歉、哄人、庆祝、开玩笑时，金额和身份、关系相称。写成「名字：[红包 ¥金额] 祝福语」。\n- 转账：还钱、付账、给零花钱这类真的涉及钱的事，只在私聊里用。写成「名字：[转账 ¥金额] 备注」。\n- 拍一拍：想引起注意、撒娇、打招呼，或者{{用户}}很久没回时。写成「名字：[拍一拍]」。\n- {{用户}}发来的红包和转账，收不收按人设来：客气的人可能先推辞，嘴硬的人嘴上说不要，正直的人会退还不该收的钱。收下红包写「名字：[领取红包]」，收下转账写「名字：[收款]」，退还转账写「名字：[退还]」，通常再跟一句话。\n- {{用户}}撤回消息、拍了拍谁、掷骰子、发来照片或位置时，可以自然地接话。\n一轮回复里最多用一次这些功能，不要连着几轮都发红包或照片。'},
  {id: 'voice', title: '语音消息', text: '情绪强烈、不方便打字，或者想让对方听到声音时，可以发语音消息，偶尔发就好。语音消息整条写成：{{语音格式}}\n能发语音的人和各自的语音语言：{{可发语音}}'}
]);
export const DEFAULT_BRING = '以下是{{用户}}刚才在手机上和{{对象}}的聊天记录。接下来的正文可以自然地承接、提到或回应这段聊天，不要原样复述：\n{{聊天记录}}';
const DEFAULT_INJECTION = {position: 'in_chat', depth: 1, role: 'system'};
// rev 2 (0.6): presets made earlier get the 手机功能 entry once; deleting it afterwards sticks.
const PRESET_REV = 2;
const DEFAULT_PRESET = {id: 'default', name: '日常短信', rev: PRESET_REV, context: 6, history: 30, bring: DEFAULT_BRING, injection: DEFAULT_INJECTION, entries: DEFAULT_CHAT_ENTRIES.map(e => ({...e, enabled: true}))};

export function defaultChat() {
  return {presets: [structuredClone(DEFAULT_PRESET)], activePreset: 'default', contacts: []};
}

const text = (value, max) => String(value ?? '').slice(0, max);
const count = (value, min, max, fallback) => { const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };

export function normalizeChatPreset(p = {}) {
  let entries = Array.isArray(p.entries) ? p.entries : [];
  if (!(Number(p.rev) >= 2) && entries.length && !entries.some(e => e.id === 'features')) {
    const at = entries.findIndex(e => e.id === 'voice');
    const added = {...DEFAULT_CHAT_ENTRIES.find(e => e.id === 'features'), enabled: true};
    entries = at < 0 ? [...entries, added] : [...entries.slice(0, at), added, ...entries.slice(at)];
  }
  return {
    id: String(p.id || crypto.randomUUID()), name: text(p.name, 60) || '聊天预设', rev: PRESET_REV,
    context: count(p.context, 0, CHAT_LIMITS.story, DEFAULT_PRESET.context),
    history: count(p.history, 2, CHAT_LIMITS.history, DEFAULT_PRESET.history),
    bring: text(p.bring ?? DEFAULT_BRING, 4000),
    injection: {...DEFAULT_INJECTION, ...p.injection, depth: count(p.injection?.depth, 0, 10000, DEFAULT_INJECTION.depth)},
    entries: entries.map(e => ({id: String(e.id || crypto.randomUUID()), title: text(e.title, 80), enabled: e.enabled !== false, text: text(e.text, 20000)}))
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

const nameOf = (who, me) => who === 'me' ? me : who;
export const DEFAULT_BLESSING = '恭喜发财，大吉大利';
const TRANSFER_STATE = {sent: '待收款', accepted: '已收款', returned: '已退还'};
/** 「X 领取了 Y 的红包」-style lines; `me` is how the user is called (你 on screen, the user's name in prompts). */
export const noticeText = (m, me) => nameOf(m.from, me) + String(m.text).replaceAll('{对方}', nameOf(m.target, me));
export const patText = (m, me) => `${nameOf(m.from, me)}拍了拍${nameOf(m.target, me)}`;

/** How a chat message reads in a transcript. */
export function messageLine(m, user) {
  const who = nameOf(m.from, user), quote = m.quote ? `「回复 ${nameOf(m.quote.from, user)}：${m.quote.text}」` : '';
  switch (m.kind) {
    case 'system': return '';
    case 'voice': return `${who}：${quote}[语音] ${m.translation || m.text}`;
    case 'photo': return `${who}：[图片]${m.text ? ' ' + m.text : ''}`;
    case 'redpacket': return `${who}：[红包 ¥${m.amount}] ${m.text || DEFAULT_BLESSING}（${m.state === 'opened' ? nameOf(m.openedBy, user) + '已领取' : '还没领取'}）`;
    case 'transfer': return `${who}：[转账 ¥${m.amount}]${m.text ? ' ' + m.text : ''}（${TRANSFER_STATE[m.state] || '待收款'}）`;
    case 'location': return `${who}：[位置] ${m.text}${m.detail ? '（' + m.detail + '）' : ''}`;
    case 'pat': return `（${patText(m, user)}）`;
    case 'dice': return `${who}：[骰子] ${m.text} 点`;
    case 'notice': return `（${noticeText(m, user)}）`;
    case 'recall': return `（${who}撤回了一条消息）`;
    default: return `${who}：${quote}${m.text}`;
  }
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
      speakers.length ? `语音消息的整行写成「名字：${voiceFormat}」，标签里的角色填同一个名字。` : '',
      `需要时也可以像真人一样用手机功能，每种单独一行，偶尔用，别每轮都用：「名字：[图片] 一句话描述拍的照片」「名字：[位置] 地点」「名字：[红包 ¥金额] 祝福语」「名字：[转账 ¥金额] 备注」「名字：[拍一拍]」（拍一拍${user}）。`,
      `${user}发来红包或转账时，收下红包单独写一行「名字：[领取红包]」，收下转账写「名字：[收款]」，退还转账写「名字：[退还]」；收不收按人设决定。`].filter(Boolean).join('\n')
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
const SPECIAL = /^\s*[[【]\s*(图片|照片|位置|定位|红包|转账|拍一拍|领取红包|领取|收下|收款|退还|退回)\s*([^\]】]*)[\]】]\s*(.*)$/;
const LUCKY = ['6.66', '8.88', '5.20', '13.14', '16.80', '1.88'];
/**
 * A phone-feature line (「[红包 ¥8.88] 祝福」 and the like) as a message; {kind:'claim', action} for taking or returning
 * the user's red packet or transfer. null when the line is ordinary text.
 */
function special(from, content, {names, user}) {
  const m = content.match(SPECIAL);
  if (!m) return null;
  const [, what, arg, rest] = m, text = unquote(rest || '').replace(/<[^>]+>/g, '');
  switch (what) {
    case '图片': case '照片': return text || arg.trim() ? {from, kind: 'photo', text: (text || arg.trim()).slice(0, 500)} : null;
    case '位置': case '定位': { const place = arg.trim() || text; return place ? {from, kind: 'location', text: place.slice(0, 100)} : null; }
    case '红包': return {from, kind: 'redpacket', amount: money(arg) || LUCKY[[...from + text].length % LUCKY.length], text: text.slice(0, 40) || DEFAULT_BLESSING, state: 'sent'};
    case '转账': { const amount = money(arg); return amount ? {from, kind: 'transfer', amount, text: text.slice(0, 40), state: 'sent'} : null; }
    case '拍一拍': { const target = arg.trim(); return {from, kind: 'pat', target: target && target !== from && target !== user && names.includes(target) ? target : 'me'}; }
    case '退还': case '退回': return {from, kind: 'claim', action: 'return'};
    default: return {from, kind: 'claim', action: 'accept', what: what === '领取红包' ? 'redpacket' : what === '收款' ? 'transfer' : ''};
  }
}

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
    const feature = special(from, content, {names, user});
    if (feature) { out.push(feature); if (out.length >= 12) break; continue; }
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
