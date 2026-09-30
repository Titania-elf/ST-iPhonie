import {createView, esc, btn, field, input, textArea, heading, groupTitle, avatar, empty} from './common.js';
import {icon} from './icons.js';
import {openImageViewer} from '../image-viewer.js';
import {saveFile, downloadAction} from '../download.js';

// Chat app: conversation list, private and group chats, voice messages, manual contacts,
// and "带进剧情" (carry selected messages into the next story reply).
// The + button next to the message box opens the phone features: photos, emoji, red packets, transfers,
// locations, 拍一拍, dice and "let them talk". Long-press (right-click) a message to quote, recall or delete it.
// Sending only puts a message in the chat, so the user can send several in a row. With the box empty, the send button
// turns into 让对方回复 and asks the model. Replies come from the host (api.chatReply); outside the tavern the app still
// stores and shows chats.

const clock = at => new Date(at).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', hour12: false});
function stamp(at) {
  const d = new Date(at), now = new Date();
  if (d.toDateString() === now.toDateString()) return clock(at);
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
const dayLabel = at => { const s = stamp(at); return s.includes(':') ? '今天' : s; };
const BLESSING = '恭喜发财，大吉大利';
const you = who => who === 'me' ? '你' : who;
const patText = m => `${you(m.from)} 拍了拍 ${you(m.target)}`;
const noticeText = m => you(m.from) + String(m.text).replaceAll('{对方}', you(m.target));
// Messages drawn as a centred line instead of a bubble.
const LINE_KINDS = ['system', 'pat', 'notice', 'recall'];
function preview(m) {
  if (!m) return '还没有消息';
  switch (m.kind) {
    case 'voice': return `[语音] ${seconds(m)}″`;
    case 'photo': return '[图片]';
    case 'redpacket': return '[红包] ' + (m.text || BLESSING);
    case 'transfer': return '[转账] ¥' + m.amount;
    case 'location': return '[位置] ' + m.text;
    case 'dice': return '[骰子]';
    case 'pat': return patText(m);
    case 'notice': return noticeText(m);
    case 'recall': return you(m.from) + ' 撤回了一条消息';
    default: return m.text;
  }
}
const quotable = m => ['text', 'voice', 'photo', 'location'].includes(m.kind);
const quoteText = m => m.kind === 'voice' ? m.translation || m.text : m.kind === 'photo' ? '[图片]' + (m.text ? ' ' + m.text : '') : m.kind === 'location' ? '[位置] ' + m.text : m.text;
const seconds = m => Math.max(1, Math.min(60, Math.round((m.text || '').length / 5)));
const lineOf = m => ({role: m.from, emotion: m.emotion || 'calm', text: m.text, translation: m.translation || ''});
const WAVE_HEIGHTS = [6, 12, 18, 10, 16, 22, 14, 8, 16, 20, 12, 7, 14, 10];
// Dice pips on a 3×3 grid, by face.
const PIPS = {1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8]};
const EMOJI = ['😀', '😂', '🥹', '😭', '😊', '🥰', '😘', '😳', '🤔', '😴', '😡', '🙄', '😏', '🤗', '🥺', '😱', '👍', '👌', '🙏', '👏', '💪', '❤️', '💔', '✨', '🎉', '🌸', '☕', '🌙', '🍰', '🐱', '🐶', '🌧️'];
const KAOMOJI = ['(｡•̀ᴗ-)✧', '(╥﹏╥)', '(๑•̀ㅂ•́)و✧', 'ヾ(≧▽≦*)o', '(〃▽〃)', '(｀へ´)', '( ˘ω˘ )zzZ', '(ﾉ>ω<)ﾉ', '(・∀・)', 'Σ(っ °Д °;)っ', '(*/ω＼*)', '(^_−)☆'];

export function chatApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'chat');
  let mode = 'list', filter = 'all', threadId = null, thread = null, selecting = null, contactDraft = null, epoch = 0, stick = false;
  let panel = null, quote = null;
  const drafts = new Map(), live = typeof api.chatReply === 'function';
  const photoURLs = new Map(), recalled = new Map(), transcribed = new Set();
  let press = null, pressedAt = 0;
  const voiceText = () => api.getState().chat.voiceText || {mode: 'translation', auto: false};
  /** 转文字 for a voice message: the translation, the original line, or both (original first). */
  function transcriptHTML(m) {
    const mode = voiceText().mode, original = m.text || '', translation = m.translation || '';
    if (mode === 'original' || !translation) return `<span class="v-text">${esc(original)}</span>`;
    if (mode === 'both' && original && original !== translation) return `<span class="v-text both"><span class="v-orig">${esc(original)}</span><span>${esc(translation)}</span></span>`;
    return `<span class="v-text">${esc(translation)}</span>`;
  }

  const engine = name => ctx.engineOf(name);
  const groupAvatar = (members, size) => `<span class="group-av" style="--s:${size}px">${members.slice(0, 3).map(m => `<i data-engine="${engine(m)}">${esc(m.slice(0, 1))}</i>`).join('')}</span>`;
  const threadAvatar = (t, size = 48) => t.type === 'group' ? groupAvatar(t.members, size) : avatar(t.members[0], engine(t.members[0]), size);
  const pendingBring = () => api.chatPendingBring?.() || null;
  const typing = () => !!threadId && !!api.chatTyping?.(threadId);
  const partner = () => thread.type === 'group' ? '群里' : thread.members[0];

  // ---------- List ----------
  async function renderList(ticket) {
    const threads = await api.listThreads();
    if (v.disposed || ticket !== epoch) return;
    const shown = threads.filter(t => filter === 'all' || t.type === filter);
    const bring = pendingBring();
    v.draw(heading('聊天', btn('contacts', icon('person'), 'round-button', 'aria-label="联系人"') + btn('new-chat', icon('add'), 'round-button', 'aria-label="新建聊天"'), 'Messages')
      + (bring ? `<div class="banner bring-banner">${icon('book')}<span>和${esc(bring.name)}的 ${bring.count} 条消息会带进下一次正文</span>${btn('cancel-bring', '取消', 'chip-button')}</div>` : '')
      + (live ? '' : '<div class="banner">' + icon('alert') + '<span>在酒馆里打开小手机时，联系人才会回复。</span></div>')
      + `<div class="segmented">${[['all', '全部'], ['dm', '私聊'], ['group', '群聊']].map(([k, l]) => `<button data-action="filter" data-filter="${k}" aria-pressed="${filter === k}">${l}</button>`).join('')}</div>`
      + (shown.length ? `<div class="group conv-list">${shown.map(t => {
        const last = t.last, line = last && LINE_KINDS.includes(last.kind);
        const who = line || !last ? '' : last.from === 'me' ? '我：' : t.type === 'group' ? last.from + '：' : '';
        return `<button class="conv" data-action="open" data-id="${esc(t.id)}">${threadAvatar(t)}<span class="grow"><span class="conv-top"><strong>${esc(t.name)}</strong>${t.type === 'group' ? `<span class="tag-s">${t.members.length} 人</span>` : ''}<span class="conv-time">${t.last ? stamp(t.last.at) : ''}</span></span><span class="conv-bot"><span class="pv">${esc(who + preview(last))}</span>${t.unread ? `<span class="badge">${t.unread > 99 ? '99+' : t.unread}</span>` : ''}</span></span></button>`;
      }).join('')}</div>` : empty(threads.length ? '这里还没有聊天' : '还没有聊天', '点右上角的加号，和角色私聊，或者拉一个群。联系人来自角色 App，也可以手动添加。', 'chat')));
  }

  // ---------- Thread ----------
  function bodyHTML(m) {
    const mid = `data-mid="${esc(m.id)}"`;
    switch (m.kind) {
      case 'voice': return `<button class="voice-msg" data-action="voice" ${mid} data-state="ungenerated" aria-label="播放 ${esc(m.from)} 的语音"><span class="v-ico">${icon('play', true)}</span><span class="v-wave">${WAVE_HEIGHTS.map(h => `<i style="height:${h}px"></i>`).join('')}</span><span class="v-sec">${seconds(m)}″</span></button>${voiceText().auto || transcribed.has(m.id) ? transcriptHTML(m) : ''}`;
      case 'photo': return m.photoId
        ? `<button class="chat-photo" data-action="photo" ${mid} aria-label="查看照片"><img data-chat-photo="${esc(m.photoId)}" alt="${esc(m.text || '照片')}"></button>${m.text ? `<span class="v-text">${esc(m.text)}</span>` : ''}`
        : `<button class="chat-photo described" data-action="message" ${mid}><span class="ph-art">${icon('image')}</span><span class="ph-cap">${esc(m.text)}</span></button>`;
      case 'redpacket': {
        const opened = m.state === 'opened';
        return `<button class="packet${opened ? ' done' : ''}" data-action="packet" ${mid}><span class="pk-main"><span class="pk-ico" aria-hidden="true"></span><span class="pk-text"><strong>${esc(m.text || BLESSING)}</strong>${opened ? `<small>${m.openedBy === 'me' ? '你已领取' : esc(you(m.openedBy)) + ' 已领取'}</small>` : ''}</span></span><span class="pk-foot">红包</span></button>`;
      }
      case 'transfer': {
        const state = {sent: m.from === 'me' ? '等对方收款' : '请收款', accepted: '已收款', returned: '已退还'}[m.state] || '';
        return `<button class="packet transfer${m.state !== 'sent' ? ' done' : ''}" data-action="transfer" ${mid}><span class="pk-main"><span class="pk-ico" aria-hidden="true">${icon(m.state === 'returned' ? 'undo' : m.state === 'accepted' ? 'check' : 'swap')}</span><span class="pk-text"><strong>¥${esc(m.amount)}</strong><small>${esc(m.text || state)}</small></span></span><span class="pk-foot">转账${m.text ? ' · ' + esc(state) : ''}</span></button>`;
      }
      case 'location': return `<button class="loc-card" data-action="message" ${mid}><span class="loc-text"><strong>${esc(m.text)}</strong>${m.detail ? `<small>${esc(m.detail)}</small>` : ''}</span><span class="loc-map" aria-hidden="true">${icon('pin')}</span></button>`;
      case 'dice': {
        const fresh = Date.now() - m.at < 1500;
        return `<button class="dice-msg${fresh ? ' rolling' : ''}" data-action="message" ${mid} data-face="${esc(m.text)}" aria-label="骰子 ${esc(m.text)} 点">${Array.from({length: 9}, (_, i) => `<i${PIPS[m.text]?.includes(i) ? ' class="on"' : ''}></i>`).join('')}</button>`;
      }
      default: return `<button class="chat-bubble" data-action="message" ${mid}>${esc(m.text)}</button>`;
    }
  }
  function lineHTML(m) {
    const mid = `data-mid="${esc(m.id)}"`;
    if (m.kind === 'system') return `<div class="sys">${icon('book')}${esc(m.text)}</div>`;
    if (m.kind === 'pat') return `<div class="note-line" ${mid}>${esc(patText(m))}</div>`;
    if (m.kind === 'notice') return `<div class="note-line" ${mid}>${/红包/.test(m.text) ? '<span class="pk-dot" aria-hidden="true"></span>' : ''}${esc(noticeText(m))}</div>`;
    const again = m.from === 'me' && recalled.has(m.id) ? btn('re-edit', '重新编辑', 'text-button', mid) : '';
    return `<div class="note-line" ${mid}>${esc(you(m.from))} 撤回了一条消息${again}</div>`;
  }
  function messageHTML(m, i, list) {
    const day = i === 0 || new Date(list[i - 1].at).toDateString() !== new Date(m.at).toDateString() ? `<div class="day">${dayLabel(m.at)}</div>` : '';
    if (LINE_KINDS.includes(m.kind)) return day + lineHTML(m);
    const me = m.from === 'me', group = thread.type === 'group', picked = selecting?.has(m.id);
    const quoted = m.quote ? `<span class="m-quote">${esc(you(m.quote.from))}：${esc(m.quote.text)}</span>` : '';
    return day + `<div class="msg${me ? ' me' : ''}" data-engine="${me ? 'none' : engine(m.from)}" data-kind="${m.kind}" data-mid="${esc(m.id)}"${picked ? ' data-picked' : ''}>${selecting ? '<span class="pick" aria-hidden="true"></span>' : ''}${me ? '' : `<span class="pat-target" data-pat="${esc(m.from)}" title="双击拍一拍">${avatar(m.from, engine(m.from), 34)}</span>`}<div class="m-body">${group && !me ? `<span class="m-name">${esc(m.from)}</span>` : ''}${bodyHTML(m)}${quoted}</div></div>`;
  }
  function toolsHTML() {
    const group = thread.type === 'group';
    const tools = [['photo', 'image', '照片'], ['emoji', 'smile', '表情'], ['redpacket', 'packet', '红包'], ...(group ? [] : [['transfer', 'swap', '转账']]),
      ['location', 'pin', '位置'], ['pat', 'hand', '拍一拍'], ['dice', 'dice', '骰子'], ['nudge', 'reply', group ? '让大家说' : '让TA说']];
    if (panel === 'emoji') return `<div class="chat-panel emoji-panel" role="group" aria-label="表情">
      <div class="emoji-grid">${EMOJI.map(e => `<button data-action="emoji-pick" data-emoji="${e}" aria-label="${e}">${e}</button>`).join('')}</div>
      <div class="kao-row">${KAOMOJI.map(e => `<button data-action="emoji-pick" data-emoji="${esc(e)}">${esc(e)}</button>`).join('')}</div>
      <div class="panel-foot">${btn('panel-tools', icon('back') + '更多功能', 'text-button')}${btn('emoji-del', icon('backspace'), 'round-button', 'aria-label="删除一个字"')}</div></div>`;
    return `<div class="chat-panel" role="group" aria-label="更多功能"><div class="tool-grid">${tools.map(([action, glyph, label]) =>
      `<button class="tool" data-action="tool-${action}" ${action === 'nudge' && !live ? 'disabled' : ''}><span class="tool-ico" data-tool="${action}">${icon(glyph)}</span><span>${label}</span></button>`).join('')}</div></div>`;
  }
  function composerHTML() {
    const group = thread.type === 'group';
    return `<div class="composer-wrap">
      ${quote ? `<div class="quote-bar"><span>回复 ${esc(you(quote.from))}：${esc(quote.text)}</span>${btn('quote-off', icon('close'), 'round-button', 'aria-label="取消引用"')}</div>` : ''}
      <div class="composer">${btn('panel', icon('add'), 'round-button plus', `aria-label="更多功能" aria-expanded="${!!panel}"`)}<input class="field-in" data-field="draft" value="${esc(drafts.get(threadId) || '')}" placeholder="${group ? '发到群聊…' : '发消息…'}" enterkeyhint="send" autocomplete="off" aria-label="消息">${sendButton()}</div>
      ${panel ? toolsHTML() : ''}</div>`;
  }
  async function renderThread(ticket) {
    thread = await api.getThread(threadId);
    if (v.disposed || ticket !== epoch) return;
    if (!thread) { mode = 'list'; threadId = null; return render(); }
    if (thread.unread) api.markThreadRead(threadId).catch(() => {});
    const group = thread.type === 'group', contacts = api.chatContacts();
    const voiced = thread.members.filter(n => contacts.find(c => c.name === n)?.voice).length;
    const sub = group ? `${thread.members.length} 人 · ${voiced} 人能发语音` : contacts.find(c => c.name === thread.members[0])?.source === 'manual' ? '手动联系人' : voiced ? '能发语音消息' : '还没有配音 · 只发文字';
    const bring = pendingBring(), scroller = v.root.querySelector('.msgs'), atBottom = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    const focused = ctx.doc.activeElement?.dataset?.field === 'draft' && v.root.contains(ctx.doc.activeElement);
    const list = thread.messages;
    v.draw(`<div class="chat-thread${selecting ? ' selecting' : ''}">
      <div class="th-head" data-engine="${group ? 'none' : engine(thread.members[0])}">${threadAvatar(thread, 38)}<div class="th-title"><strong>${esc(thread.name)}</strong><small>${esc(sub)}</small></div>
        ${btn('bring', selecting ? '取消' : icon('book') + '带进剧情', 'chip-button')}${btn('thread-menu', icon('more'), 'round-button', 'aria-label="更多"')}</div>
      <div class="msgs" role="log" aria-live="polite">${list.length ? list.map((m, i) => messageHTML(m, i, list)).join('') : `<p class="chat-empty">${live ? '发几条消息都行，发完点右下角的气泡按钮让对方回复；输入框空着时发送键就会变成它。也可以直接点它，让对方先开口。' : '在酒馆里打开小手机时，联系人才会回复。'}</p>`}
        ${bring?.threadId === threadId ? `<div class="sys">${icon('book')}${bring.count} 条消息会带进下一次正文 ${btn('cancel-bring', '取消', 'text-button')}</div>` : ''}
        ${typing() ? `<div class="msg" data-engine="${group ? 'none' : engine(thread.members[0])}">${avatar(group ? '…' : thread.members[0], group ? 'none' : engine(thread.members[0]), 34)}<div class="m-body"><div class="chat-bubble typing" aria-label="对方正在输入"><i></i><i></i><i></i></div></div></div>` : ''}</div>
      ${selecting
        ? `<div class="bring-bar"><span>${selecting.size ? `已选 ${selecting.size} 条` : '点消息来选择'}</span>${btn('bring-go', '带进下一次正文', 'primary', selecting.size ? '' : 'disabled')}</div>`
        : composerHTML()}
    </div>`);
    const msgs = v.root.querySelector('.msgs');
    if (atBottom || stick) msgs.scrollTop = msgs.scrollHeight;
    stick = false;
    if (focused) v.root.querySelector('[data-field=draft]')?.focus({preventScroll: true});
    paintVoices();
    paintPhotos();
  }
  // Opens or closes the + panel in place, so the message box keeps its text and focus.
  function syncPanel() {
    const wrap = v.root.querySelector('.composer-wrap');
    if (!wrap) return;
    const msgs = v.root.querySelector('.msgs'), atBottom = msgs && msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80;
    const old = wrap.querySelector('.chat-panel');
    old?.remove();
    if (panel) {
      wrap.insertAdjacentHTML('beforeend', toolsHTML());
      if (!old) wrap.querySelector('.chat-panel').classList.add('enter');
    }
    wrap.querySelector('[data-action=panel]')?.setAttribute('aria-expanded', String(!!panel));
    if (msgs && atBottom) msgs.scrollTop = msgs.scrollHeight;
  }
  async function paintVoices() {
    const status = api.status();
    for (const el of v.root.querySelectorAll('.voice-msg[data-mid]')) {
      const m = thread?.messages.find(x => x.id === el.dataset.mid);
      if (!m) continue;
      const on = ['playing', 'paused', 'generating'].includes(status.phase) && status.line?.text === m.text && status.line?.role === m.from;
      const state = on ? (status.phase === 'generating' ? 'generating' : 'playing') : await api.lineState(lineOf(m));
      if (!el.isConnected) continue;
      el.dataset.state = state;
      el.querySelector('.v-ico').innerHTML = state === 'generating' ? icon('spin') : icon(state === 'playing' ? 'pause' : 'play', true);
    }
  }
  // Album photos sent in the chat; each picture is read once and kept while the app is open.
  async function photoURL(id) {
    if (!photoURLs.has(id)) {
      const photo = await api.getPhoto(id);
      photoURLs.set(id, photo ? ctx.win.URL.createObjectURL(photo.blob) : '');
    }
    return photoURLs.get(id);
  }
  async function paintPhotos() {
    for (const img of v.root.querySelectorAll('img[data-chat-photo]')) {
      const url = await photoURL(img.dataset.chatPhoto);
      if (!img.isConnected) continue;
      if (url) img.src = url; else img.closest('.chat-photo')?.classList.add('missing');
    }
  }

  // ---------- Contacts ----------
  function renderContacts() {
    const contacts = api.chatContacts(), roles = contacts.filter(c => c.source === 'role'), manual = api.getState().chat.contacts;
    if (contactDraft) {
      v.draw(heading(contactDraft.id ? '编辑联系人' : '新联系人', '', 'Contact')
        + `<div class="group pad">${field('名字', input('contact-name', contactDraft.name, 'text', 'maxlength="40"'))}${field('人设', textArea('contact-persona', contactDraft.persona, 'rows="6" placeholder="性格、身份、和你的关系、说话习惯……"'), '写给模型看的资料。角色 App 里的角色会自动读取酒馆角色卡，不用在这里填。')}</div>
        <div class="savebar">${btn('contact-cancel', '取消', 'secondary')}${btn('contact-save', '保存', 'primary')}</div>
        ${contactDraft.id ? `<div class="actions">${btn('contact-delete', '删除联系人', 'danger')}</div>` : ''}`);
      return;
    }
    v.draw(heading('联系人', btn('contact-add', icon('add'), 'round-button', 'aria-label="手动添加联系人"'), 'Contacts')
      + groupTitle('来自角色 App')
      + (roles.length ? `<div class="group">${roles.map(c => `<div class="list-row">${avatar(c.name, c.engine, 40)}<span><strong>${esc(c.name)}</strong><small>${c.voice ? '能发语音消息' : '还没有配音 · 只发文字'} · 人设来自酒馆角色卡</small></span></div>`).join('')}</div>` : '<p class="hint">角色 App 里还没有角色。</p>')
      + groupTitle('手动添加')
      + (manual.length ? `<div class="group">${manual.map(c => `<button class="list-row" data-action="contact-edit" data-id="${esc(c.id)}">${avatar(c.name, 'none', 40)}<span><strong>${esc(c.name)}</strong><small>${esc((c.persona || '还没有写人设').slice(0, 40))}</small></span>${icon('next')}</button>`).join('')}</div>` : '<p class="hint">剧情之外的人（同学、店员、网友……）可以手动添加，写上人设就能聊。</p>'));
  }

  function render() {
    const ticket = ++epoch;
    v.root.classList.toggle('chat-mode', mode === 'thread');
    if (mode === 'thread') return renderThread(ticket);
    if (mode === 'contacts') return renderContacts();
    return renderList(ticket);
  }
  function open(id) {
    threadId = id; mode = 'thread'; selecting = null; stick = true; panel = null; quote = null;
    return render();
  }

  // ---------- Sending ----------
  /** Puts the user's messages in the chat. Nothing goes to the model until the user asks for a reply. */
  async function post(messages) {
    stick = true;
    await api.appendChat(threadId, messages, {read: true});
  }
  async function send() {
    const el = v.root.querySelector('[data-field=draft]'), text = el?.value.trim();
    // An empty box asks the other side to reply to everything sent so far.
    if (!text) { if (live && el) requestReply(); return; }
    el.value = '';
    drafts.delete(threadId);
    syncSend();
    const q = quote;
    quote = null;
    await post([{from: 'me', kind: 'text', text, ...(q ? {quote: q} : {})}]);
  }
  /** Paper plane while there is text; 让对方回复 when the box is empty. */
  const sendButton = () => {
    const empty = !(drafts.get(threadId) || '').trim(), group = thread?.type === 'group';
    return empty
      ? btn('send', icon('bubble'), 'round-button send ask', `aria-label="让${group ? '群里' : '对方'}回复" title="让${group ? '群里' : '对方'}回复" ${live ? '' : 'disabled'}`)
      : btn('send', icon('send'), 'round-button send', 'aria-label="发送" title="发送"');
  };
  function syncSend() {
    const old = v.root.querySelector('.composer [data-action=send]');
    if (!old) return;
    const empty = !(drafts.get(threadId) || '').trim();
    if (old.classList.contains('ask') === empty) return;
    old.insertAdjacentHTML('afterend', sendButton());
    old.remove();
  }
  function requestReply(id = threadId) {
    if (!live || !id) return;
    const job = api.chatReply(id);
    if (mode === 'thread' && id === threadId) render();
    job.catch(error => ctx.notify(error.message));
  }
  /** Runs a sheet's buttons: `handlers[action](button)`; errors become notices. */
  function sheet(title, html, handlers) {
    const d = ctx.dialog(title, html);
    d.body.addEventListener('click', e => {
      const b = e.target.closest('[data-action]');
      if (!b || !handlers[b.dataset.action]) return;
      e.preventDefault();
      ctx.win.Promise.resolve().then(() => handlers[b.dataset.action](b)).catch(error => ctx.notify(error.message));
    });
    return d;
  }
  const value = (d, key) => d.body.querySelector(`[data-field=${key}]`)?.value.trim() || '';
  const amountOf = text => {
    const n = Math.round(Number(String(text).replace(/[¥￥,，\s元]/g, '')) * 100) / 100;
    if (!Number.isFinite(n) || n < 0.01 || n > 200000) throw Error('请填写 0.01 到 200000 之间的金额');
    return n.toFixed(2);
  };

  async function sendPhoto() {
    const rows = await api.listPhotos(), local = [];
    let chosen = null;
    const d = sheet('发送照片', `<div class="photo-grid pick-photos">${rows.map(r => `<button data-action="pick-photo" data-id="${esc(r.id)}" aria-pressed="false" aria-label="选择 ${esc(r.name)}"><img data-photo="${esc(r.id)}" alt="${esc(r.name)}"></button>`).join('')}</div>
      ${rows.length ? '' : '<p class="help-copy">相册里还没有照片，可以直接从本地选一张。</p>'}
      <div class="actions"><label class="secondary file-button">${icon('import')}从本地选<input type="file" data-chat-file accept="image/png,image/jpeg,image/webp,image/avif,image/gif" aria-label="从本地选照片"></label></div>
      ${field('照片说明', input('caption', '', 'text', 'maxlength="200" placeholder="比如：下班路上的晚霞"'), '对方看不到图片本身，只看得到这句说明。写清楚照片里有什么，对方才好接话。')}
      <div class="actions">${btn('photo-send', icon('send') + '发送', 'primary', 'disabled')}</div>`, {
      'pick-photo': b => {
        chosen = b.dataset.id;
        for (const x of d.body.querySelectorAll('[data-action=pick-photo]')) x.setAttribute('aria-pressed', String(x === b));
        d.body.querySelector('[data-action=photo-send]').disabled = false;
      },
      'photo-send': async () => {
        if (!chosen) return;
        const caption = value(d, 'caption');
        d.close();
        await post([{from: 'me', kind: 'photo', photoId: chosen, text: caption}]);
      }
    });
    d.onClose(() => { for (const url of local) ctx.win.URL.revokeObjectURL(url); });
    d.body.addEventListener('change', e => {
      const file = e.target.closest('[data-chat-file]')?.files?.[0];
      if (!file) return;
      api.addPhoto({name: file.name, blob: file}).then(async photo => {
        const caption = value(d, 'caption');
        d.close();
        await post([{from: 'me', kind: 'photo', photoId: photo.id, text: caption}]);
      }).catch(error => ctx.notify(error.message));
    });
    for (const row of rows) {
      const photo = await api.getPhoto(row.id);
      if (!d.live) return;
      const img = [...d.body.querySelectorAll('img[data-photo]')].find(x => x.dataset.photo === row.id);
      if (photo && img) { const url = ctx.win.URL.createObjectURL(photo.blob); local.push(url); img.src = url; }
    }
  }
  function sendPacket() {
    const d = sheet('发红包', `<div class="packet-sheet">${field('金额', input('amount', '6.66', 'text', 'inputmode="decimal" maxlength="9"'))}${field('祝福语', input('blessing', '', 'text', `maxlength="40" placeholder="${BLESSING}"`))}</div>
      <div class="actions">${btn('packet-send', '塞钱进红包', 'primary packet-go')}</div>`, {
      'packet-send': async () => {
        const amount = amountOf(value(d, 'amount')), text = value(d, 'blessing') || BLESSING;
        d.close();
        await post([{from: 'me', kind: 'redpacket', amount, text, state: 'sent'}]);
      }
    });
  }
  function sendTransfer() {
    const d = sheet(`转账给${thread.members[0]}`, `${field('金额', input('amount', '', 'text', 'inputmode="decimal" maxlength="9" placeholder="0.00"'))}${field('备注', input('note', '', 'text', 'maxlength="40" placeholder="可以不填"'))}
      <div class="actions">${btn('transfer-send', '转账', 'primary')}</div>`, {
      'transfer-send': async () => {
        const amount = amountOf(value(d, 'amount')), text = value(d, 'note');
        d.close();
        await post([{from: 'me', kind: 'transfer', amount, text, state: 'sent'}]);
      }
    });
  }
  function sendLocation() {
    const d = sheet('发送位置', `${field('地点', input('place', '', 'text', 'maxlength="100" placeholder="比如：学校后门的便利店"'))}${field('详细地址', input('detail', '', 'text', 'maxlength="200" placeholder="可以不填"'))}
      <div class="actions">${btn('location-send', icon('pin') + '发送', 'primary')}</div>`, {
      'location-send': async () => {
        const text = value(d, 'place');
        if (!text) throw Error('请填写地点');
        const detail = value(d, 'detail');
        d.close();
        await post([{from: 'me', kind: 'location', text, detail}]);
      }
    });
  }
  const pat = name => post([{from: 'me', kind: 'pat', target: name}]);
  function choosePat() {
    if (thread.type !== 'group') return pat(thread.members[0]);
    const d = sheet('拍一拍', `<div class="pick-list">${thread.members.map(n => `<button class="list-row" data-action="pat-one" data-name="${esc(n)}">${avatar(n, engine(n), 36)}<span><strong>${esc(n)}</strong></span>${icon('hand')}</button>`).join('')}</div>`, {
      'pat-one': async b => { d.close(); await pat(b.dataset.name); }
    });
  }
  const rollDice = () => post([{from: 'me', kind: 'dice', text: String(1 + Math.floor(Math.random() * 6))}]);
  function insertText(text) {
    const el = v.root.querySelector('[data-field=draft]');
    if (!el) return;
    const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    drafts.set(threadId, el.value);
    syncSend();
  }
  function deleteChar() {
    const el = v.root.querySelector('[data-field=draft]');
    if (!el?.value) return;
    el.value = [...el.value].slice(0, -1).join('');
    drafts.set(threadId, el.value);
    syncSend();
  }

  // ---------- Red packets and transfers ----------
  function openPacket(m) {
    const mine = m.from === 'me', opened = m.state === 'opened';
    const status = opened ? (m.openedBy === 'me' ? '已存入零钱' : `${esc(you(m.openedBy))} 已领取`) : mine ? '等对方领取' : '';
    const d = sheet(`${you(m.from)}的红包`, `<div class="packet-open${opened || mine ? ' shown' : ''}">${avatar(m.from === 'me' ? '我' : m.from, mine ? 'none' : engine(m.from), 54)}
      <p class="po-from">${esc(mine ? '你发出的红包' : m.from + ' 发出的红包')}</p><p class="po-wish">${esc(m.text || BLESSING)}</p>
      ${opened || mine ? `<p class="po-amount">¥${esc(m.amount)}</p><p class="po-state">${status}</p>` : btn('packet-open', '開', 'packet-coin', 'aria-label="拆开红包"')}</div>`, {
      'packet-open': async () => {
        d.close();
        await api.updateChatMessage(threadId, m.id, {state: 'opened', openedBy: 'me'});
        await api.appendChat(threadId, [{from: 'me', kind: 'notice', target: m.from, text: '领取了{对方}的红包'}], {read: true});
        ctx.notify(`领到 ¥${m.amount}`);
      }
    });
  }
  function openTransfer(m) {
    const mine = m.from === 'me', waiting = m.state === 'sent';
    const state = {sent: mine ? '等对方收款' : '待你收款', accepted: mine ? '对方已收款' : '你已收款', returned: mine ? '对方已退还' : '你已退还'}[m.state];
    const settle = (next, text) => async () => {
      d.close();
      await api.updateChatMessage(threadId, m.id, {state: next, openedBy: 'me'});
      await api.appendChat(threadId, [{from: 'me', kind: 'notice', target: m.from, text}], {read: true});
    };
    const d = sheet(mine ? '转账' : `${m.from}的转账`, `<div class="transfer-open"><span class="to-ico">${icon(waiting ? 'swap' : m.state === 'accepted' ? 'check' : 'undo')}</span><p class="po-state">${esc(state)}</p><p class="po-amount">¥${esc(m.amount)}</p>${m.text ? `<p class="po-wish">${esc(m.text)}</p>` : ''}</div>
      ${!mine && waiting ? `<div class="actions">${btn('transfer-accept', '收款', 'primary')}</div><div class="actions">${btn('transfer-return', '退还', 'text-button')}</div>` : ''}`, {
      'transfer-accept': settle('accepted', '收下了{对方}的转账'),
      'transfer-return': settle('returned', '退还了{对方}的转账')
    });
  }

  // ---------- Menus ----------
  function messageMenu(m) {
    const contact = m.from !== 'me', last = contact && thread.messages.at(-1)?.id === m.id;
    const copyable = ['text', 'voice', 'location', 'photo'].includes(m.kind) && quoteText(m);
    const canRecall = !contact && !['redpacket', 'transfer'].includes(m.kind);
    const shown = m.kind === 'voice' ? (m.translation || m.text) : m.kind === 'dice' ? `骰子 ${m.text} 点` : ['redpacket', 'transfer'].includes(m.kind) ? preview(m) : quoteText(m);
    const voice = m.kind === 'voice', open = voice && (voiceText().auto || transcribed.has(m.id));
    const d = sheet('消息', `${voice ? '' : `<p class="help-copy">${esc(shown)}</p>`}
      ${voice ? `<div class="actions">${btn('transcribe', icon('book') + (open ? '收起文字' : '转文字'), 'primary')}${btn('download', icon('download') + '下载语音', 'secondary')}</div>` : ''}
      <div class="actions">${quotable(m) ? btn('quote', icon('reply') + '引用', 'secondary') : ''}${copyable ? btn('copy', icon('copy') + '复制', 'secondary') : ''}</div>
      <div class="actions">${canRecall ? btn('recall', icon('undo') + '撤回', 'secondary') : ''}${btn('delete', icon('trash') + '删除', 'danger')}</div>
      ${last && live ? `<div class="actions">${btn('reroll', icon('refresh') + '重新回复这一轮', 'secondary')}</div>` : ''}`, {
      transcribe: () => {
        d.close();
        if (open && voiceText().auto) { ctx.notify('语音自动转文字开着，可以在右上角「⋯ → 语音消息」里关掉'); return; }
        if (open) transcribed.delete(m.id); else transcribed.add(m.id);
        render();
      },
      download: async () => { d.close(); const {blob, name} = await api.audioFile({line: lineOf(m)}); ctx.notify('已下载 ' + await saveFile(ctx.doc, blob, name)); },
      quote: () => { d.close(); quote = {from: m.from, text: quoteText(m).slice(0, 200)}; panel = null; render(); },
      copy: async () => { d.close(); await ctx.win.navigator.clipboard?.writeText(m.kind === 'voice' ? m.text : quoteText(m)); ctx.notify('已复制'); },
      recall: async () => {
        d.close();
        if (m.kind === 'text') recalled.set(m.id, m.text);
        await api.updateChatMessage(threadId, m.id, {recall: true});
      },
      delete: async () => { d.close(); await api.deleteChatMessages(threadId, [m.id]); },
      reroll: async () => { d.close(); await reroll(); }
    });
  }
  // Removes the contacts' latest messages (after the user's last one) and asks again.
  async function reroll() {
    const list = thread.messages, cut = list.findLastIndex(m => m.from === 'me' && m.kind !== 'system');
    const drop = list.slice(cut + 1).filter(m => m.from !== 'me').map(m => m.id);
    if (drop.length) await api.deleteChatMessages(threadId, drop);
    requestReply();
  }
  function newChat() {
    const contacts = api.chatContacts();
    const d = ctx.dialog('新建聊天', contacts.length
      ? `${groupTitle('私聊')}<div class="pick-list">${contacts.map(c => `<button class="list-row" data-new-dm="${esc(c.name)}">${avatar(c.name, c.engine, 36)}<span><strong>${esc(c.name)}</strong><small>${c.source === 'role' ? (c.voice ? '角色 · 能发语音' : '角色 · 只发文字') : '手动联系人'}</small></span>${icon('next')}</button>`).join('')}</div>
        ${contacts.length > 1 ? `${groupTitle('群聊')}<div class="pick-list">${contacts.map(c => `<label class="setting-row"><span>${avatar(c.name, c.engine, 28)}${esc(c.name)}</span><input class="switch" type="checkbox" data-member="${esc(c.name)}" aria-label="拉 ${esc(c.name)} 进群"></label>`).join('')}</div>
          ${field('群名', input('group-name', '', 'text', 'maxlength="40" placeholder="可以不填"'))}<div class="actions">${btn('create-group', icon('group') + '建群', 'primary')}</div>` : ''}
        <div class="actions">${btn('manage-contacts', icon('person') + '管理联系人', 'text-button')}</div>`
      : `<p class="help-copy">还没有联系人。在角色 App 里新增角色，或者手动添加一个联系人。</p><div class="actions">${btn('manage-contacts', icon('add') + '添加联系人', 'primary')}</div>`);
    d.body.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      ctx.win.Promise.resolve().then(async () => {
        if (b.dataset.newDm) {
          const existing = (await api.listThreads()).find(t => t.type === 'dm' && t.members[0] === b.dataset.newDm);
          const t = existing || await api.createThread({type: 'dm', members: [b.dataset.newDm]});
          d.close(); open(t.id);
        }
        if (b.dataset.action === 'create-group') {
          const members = [...d.body.querySelectorAll('[data-member]:checked')].map(x => x.dataset.member);
          const t = await api.createThread({type: 'group', members, name: d.body.querySelector('[data-field=group-name]').value});
          d.close(); open(t.id);
        }
        if (b.dataset.action === 'manage-contacts') { d.close(); mode = 'contacts'; contactDraft = null; render(); }
      }).catch(error => ctx.notify(error.message));
    });
  }
  /** Options for voice messages in every chat: what 转文字 shows, and whether it happens by itself. */
  function voiceTextSheet() {
    const draw = () => {
      const o = voiceText();
      return `<p class="help-copy">语音消息平时只显示语音条，长按（电脑上右键）选「转文字」才显示文字。</p>
        <div class="field"><span>转文字显示</span><div class="segmented" style="margin:0">${[['translation', '中文译文'], ['original', '原文'], ['both', '原文和译文']].map(([k, l]) => `<button data-action="vt-mode" data-mode="${k}" aria-pressed="${o.mode === k}">${l}</button>`).join('')}</div></div>
        <div class="setting-row"><span>新旧语音都自动转文字</span><input class="switch" type="checkbox" data-field="vt-auto" aria-label="语音自动转文字" ${o.auto ? 'checked' : ''}></div>`;
    };
    const d = sheet('语音消息', `<div class="vt-body">${draw()}</div>`, {
      'vt-mode': b => { api.saveChatOptions({voiceText: {mode: b.dataset.mode}}); d.body.querySelector('.vt-body').innerHTML = draw(); render(); }
    });
    d.body.addEventListener('change', e => {
      if (!e.target.matches('[data-field=vt-auto]')) return;
      try { api.saveChatOptions({voiceText: {auto: e.target.checked}}); render(); } catch (error) { ctx.notify(error.message); }
    });
  }
  function threadMenu() {
    const group = thread.type === 'group';
    const d = ctx.dialog(thread.name, `<div class="pick-list">
      ${live ? `<button class="list-row" data-menu="reroll">${icon('refresh')}<span><strong>重新回复最后一轮</strong></span></button>` : ''}
      ${group ? `<button class="list-row" data-menu="rename">${icon('edit')}<span><strong>改群名</strong></span></button>` : ''}
      <button class="list-row" data-menu="voice-text">${icon('book')}<span><strong>语音消息</strong><small>转文字显示什么、要不要自动转</small></span></button>
      <button class="list-row" data-menu="clear">${icon('trash')}<span><strong>清空聊天记录</strong></span></button>
      <button class="list-row" data-menu="delete">${icon('close')}<span><strong>删除这段聊天</strong></span></button></div>`);
    d.body.addEventListener('click', e => {
      const action = e.target.closest('[data-menu]')?.dataset.menu;
      if (!action) return;
      d.close();
      ctx.win.Promise.resolve().then(async () => {
        if (action === 'reroll') await reroll();
        if (action === 'rename') {
          const r = ctx.dialog('改群名', `${field('群名', input('rename', thread.name, 'text', 'maxlength="40"'))}<div class="actions">${btn('rename-save', '保存', 'primary')}</div>`);
          r.body.addEventListener('click', ev => { if (ev.target.closest('[data-action=rename-save]')) { const name = r.body.querySelector('[data-field=rename]').value; r.close(); api.updateThread(threadId, {name}).catch(err => ctx.notify(err.message)); } });
        }
        if (action === 'voice-text') voiceTextSheet();
        if (action === 'clear' && await ctx.confirm('清空聊天记录？', '这段聊天会保留，消息全部删除。')) await api.deleteChatMessages(threadId, thread.messages.map(m => m.id));
        if (action === 'delete' && await ctx.confirm('删除这段聊天？', '聊天记录会一起删除，联系人不受影响。')) { await api.deleteThread(threadId); mode = 'list'; threadId = null; render(); }
      }).catch(error => ctx.notify(error.message));
    });
  }

  v.on('input', '[data-field=draft]', el => { drafts.set(threadId, el.value); syncSend(); });
  v.on('keydown', '[data-field=draft]', (el, e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); return send(); } });
  // Typing closes the + panel, like a phone keyboard replacing it.
  v.on('focusin', '[data-field=draft]', () => { if (panel) { panel = null; syncPanel(); } });
  v.on('click', '.msg[data-mid]', el => {
    if (!selecting) return;
    const id = el.dataset.mid;
    if (selecting.has(id)) selecting.delete(id); else selecting.add(id);
    render();
  });
  // Double-tap an avatar to 拍一拍; long-press (or right-click) a message for its menu.
  v.on('dblclick', '[data-pat]', el => { if (!selecting) return pat(el.dataset.pat); });
  // Long-press works the same on phones that do not send contextmenu (iOS): hold a message for half a second.
  v.on('pointerdown', '.msg[data-mid] .m-body', (el, e) => {
    if (selecting || e.button > 0) return;
    const id = el.closest('.msg').dataset.mid;
    ctx.win.clearTimeout(press?.timer);
    press = {x: e.clientX, y: e.clientY, timer: ctx.win.setTimeout(() => {
      press = null;
      const m = thread?.messages.find(x => x.id === id);
      if (m) { pressedAt = Date.now(); messageMenu(m); }
    }, 480)};
  });
  const cancelPress = (el, e) => {
    if (!press || (e.type === 'pointermove' && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 10)) return;
    ctx.win.clearTimeout(press.timer);
    press = null;
  };
  for (const type of ['pointermove', 'pointerup', 'pointercancel']) v.on(type, '*', cancelPress);
  v.on('contextmenu', '.msg[data-mid]', (el, e) => {
    if (Date.now() - pressedAt < 1000) { e.preventDefault(); return; }
    if (selecting) return;
    const m = thread?.messages.find(x => x.id === el.dataset.mid);
    if (m) { e.preventDefault(); messageMenu(m); }
  });
  v.on('click', '[data-action]', async el => {
    const action = el.dataset.action;
    // The click that ends a long-press only closes the press, it does not play or open anything.
    if (Date.now() - pressedAt < 700 && el.closest('.msg')) return;
    if (selecting && ['message', 'voice', 'photo', 'packet', 'transfer'].includes(action)) return;
    const find = () => thread.messages.find(x => x.id === el.dataset.mid);
    switch (action) {
      case 'filter': filter = el.dataset.filter; render(); break;
      case 'open': open(el.dataset.id); break;
      case 'new-chat': newChat(); break;
      case 'contacts': mode = 'contacts'; contactDraft = null; render(); break;
      case 'send': await send(); break;
      case 'panel': panel = panel ? null : 'tools'; syncPanel(); break;
      case 'panel-tools': panel = 'tools'; syncPanel(); break;
      case 'tool-emoji': panel = 'emoji'; syncPanel(); break;
      case 'emoji-pick': insertText(el.dataset.emoji); break;
      case 'emoji-del': deleteChar(); break;
      case 'tool-photo': panel = null; syncPanel(); await sendPhoto(); break;
      case 'tool-redpacket': panel = null; syncPanel(); sendPacket(); break;
      case 'tool-transfer': panel = null; syncPanel(); sendTransfer(); break;
      case 'tool-location': panel = null; syncPanel(); sendLocation(); break;
      case 'tool-pat': panel = null; syncPanel(); await choosePat(); break;
      case 'tool-dice': panel = null; syncPanel(); await rollDice(); break;
      case 'tool-nudge': panel = null; syncPanel(); requestReply(); break;
      case 'quote-off': quote = null; render(); break;
      case 're-edit': {
        const text = recalled.get(el.dataset.mid) || '';
        recalled.delete(el.dataset.mid);
        drafts.set(threadId, (drafts.get(threadId) || '') + text);
        render();
        break;
      }
      case 'message': { const m = find(); if (m) messageMenu(m); break; }
      case 'photo': {
        const m = find(), img = el.querySelector('img');
        if (!m || !img?.src) break;
        openImageViewer({doc: ctx.doc, src: img.src, alt: img.alt, from: img, actions: [downloadAction(ctx.doc, () => ({source: img.src, name: `${m.from === 'me' ? '我' : m.from} 的照片`}), ctx.notify), {label: '消息选项', run: () => messageMenu(m)}]});
        break;
      }
      case 'packet': { const m = find(); if (m) openPacket(m); break; }
      case 'transfer': { const m = find(); if (m) openTransfer(m); break; }
      case 'voice': {
        const m = find();
        if (!m) break;
        if (!ctx.routeFor(m.from)?.voice) { ctx.notify(`${m.from} 还没有配音`); break; }
        if (el.dataset.state === 'playing') { api.stop(); break; }
        await api.speak(lineOf(m));
        break;
      }
      case 'thread-menu': threadMenu(); break;
      case 'bring': selecting = selecting ? null : new Set(); panel = null; render(); break;
      case 'bring-go': {
        const count = selecting.size;
        if (!live) throw Error('在酒馆里打开小手机时才能带进剧情');
        await api.chatBring(threadId, [...selecting]);
        selecting = null;
        ctx.notify(`下一次正文会带上这 ${count} 条消息`);
        render();
        break;
      }
      case 'cancel-bring': api.chatCancelBring?.(); ctx.notify('已取消'); render(); break;
      case 'contact-add': contactDraft = {name: '', persona: ''}; render(); break;
      case 'contact-edit': contactDraft = structuredClone(api.getState().chat.contacts.find(c => c.id === el.dataset.id)); render(); break;
      case 'contact-cancel': contactDraft = null; render(); break;
      case 'contact-save': {
        contactDraft.name = v.root.querySelector('[data-field=contact-name]').value;
        contactDraft.persona = v.root.querySelector('[data-field=contact-persona]').value;
        api.saveContact(contactDraft);
        contactDraft = null;
        ctx.notify('联系人已保存');
        render();
        break;
      }
      case 'contact-delete':
        if (await ctx.confirm('删除这个联系人？', '和 TA 的聊天记录会保留。')) { api.deleteContact(contactDraft.id); contactDraft = null; render(); }
        break;
    }
  });

  v.back = () => {
    if (mode === 'thread' && panel) { panel = null; syncPanel(); return true; }
    if (mode === 'thread' && selecting) { selecting = null; render(); return true; }
    if (mode === 'contacts' && contactDraft) { contactDraft = null; render(); return true; }
    if (mode !== 'list') { mode = 'list'; threadId = null; selecting = null; quote = null; render(); return true; }
    return false;
  };
  v.refresh = () => render();
  v.openThread = open;
  v.onChat = event => {
    if (mode === 'list') return render();
    if (mode === 'thread' && (!event.threadId || event.threadId === threadId)) return render();
  };
  v.onPlayback = () => { if (mode === 'thread') paintVoices(); };
  const dispose = v.dispose;
  v.dispose = () => { for (const url of photoURLs.values()) if (url) ctx.win.URL.revokeObjectURL(url); photoURLs.clear(); dispose(); };
  render();
  return v;
}
