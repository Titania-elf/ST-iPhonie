import {createView, esc, btn, field, input, textArea, heading, groupTitle, avatar, empty} from './common.js';
import {icon} from './icons.js';

// Chat app: conversation list, private and group chats, voice messages, manual contacts,
// and "带进剧情" (carry selected messages into the next story reply).
// Replies come from the host (api.chatReply); outside the tavern the app still stores and shows chats.

const clock = at => new Date(at).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', hour12: false});
function stamp(at) {
  const d = new Date(at), now = new Date();
  if (d.toDateString() === now.toDateString()) return clock(at);
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
const dayLabel = at => { const s = stamp(at); return s.includes(':') ? '今天' : s; };
const preview = m => !m ? '还没有消息' : m.kind === 'voice' ? '[语音] ' + (m.translation || m.text) : m.kind === 'photo' ? '[图片]' : m.text;
const seconds = m => Math.max(1, Math.min(60, Math.round((m.text || '').length / 5)));
const lineOf = m => ({role: m.from, emotion: m.emotion || 'calm', text: m.text, translation: m.translation || ''});
const WAVE_HEIGHTS = [6, 12, 18, 10, 16, 22, 14, 8, 16, 20, 12, 7, 14, 10];

export function chatApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'chat');
  let mode = 'list', filter = 'all', threadId = null, thread = null, selecting = null, contactDraft = null, epoch = 0, replyTimer = null, stick = false;
  const drafts = new Map(), live = typeof api.chatReply === 'function';

  const engine = name => ctx.engineOf(name);
  const groupAvatar = (members, size) => `<span class="group-av" style="--s:${size}px">${members.slice(0, 3).map(m => `<i data-engine="${engine(m)}">${esc(m.slice(0, 1))}</i>`).join('')}</span>`;
  const threadAvatar = (t, size = 48) => t.type === 'group' ? groupAvatar(t.members, size) : avatar(t.members[0], engine(t.members[0]), size);
  const pendingBring = () => api.chatPendingBring?.() || null;
  const typing = () => !!threadId && !!api.chatTyping?.(threadId);

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
        const last = t.last, who = t.type === 'group' && last && last.from !== 'me' ? last.from + '：' : last?.from === 'me' ? '我：' : '';
        return `<button class="conv" data-action="open" data-id="${esc(t.id)}">${threadAvatar(t)}<span class="grow"><span class="conv-top"><strong>${esc(t.name)}</strong>${t.type === 'group' ? `<span class="tag-s">${t.members.length} 人</span>` : ''}<span class="conv-time">${t.last ? stamp(t.last.at) : ''}</span></span><span class="conv-bot"><span class="pv">${esc(who + preview(last))}</span>${t.unread ? `<span class="badge">${t.unread > 99 ? '99+' : t.unread}</span>` : ''}</span></span></button>`;
      }).join('')}</div>` : empty(threads.length ? '这里还没有聊天' : '还没有聊天', '点右上角的加号，和角色私聊，或者拉一个群。联系人来自角色 App，也可以手动添加。', 'chat')));
  }

  // ---------- Thread ----------
  function messageHTML(m, i, list) {
    const day = i === 0 || new Date(list[i - 1].at).toDateString() !== new Date(m.at).toDateString() ? `<div class="day">${dayLabel(m.at)}</div>` : '';
    if (m.kind === 'system') return day + `<div class="sys">${icon('book')}${esc(m.text)}</div>`;
    const me = m.from === 'me', group = thread.type === 'group', picked = selecting?.has(m.id);
    let body;
    if (m.kind === 'voice') body = `<button class="voice-msg" data-action="voice" data-mid="${esc(m.id)}" data-state="ungenerated" aria-label="播放 ${esc(m.from)} 的语音"><span class="v-ico">${icon('play', true)}</span><span class="v-wave">${WAVE_HEIGHTS.map(h => `<i style="height:${h}px"></i>`).join('')}</span><span class="v-sec">${seconds(m)}″</span></button><span class="v-text">${esc(m.translation || m.text)}</span>`;
    else body = `<button class="chat-bubble" data-action="message" data-mid="${esc(m.id)}">${esc(m.text)}</button>`;
    return day + `<div class="msg${me ? ' me' : ''}" data-engine="${me ? 'none' : engine(m.from)}" data-mid="${esc(m.id)}"${picked ? ' data-picked' : ''}>${selecting ? '<span class="pick" aria-hidden="true"></span>' : ''}${me ? '' : avatar(m.from, engine(m.from), 34)}<div class="m-body">${group && !me ? `<span class="m-name">${esc(m.from)}</span>` : ''}${body}</div></div>`;
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
    const list = thread.messages;
    v.draw(`<div class="chat-thread${selecting ? ' selecting' : ''}">
      <div class="th-head" data-engine="${group ? 'none' : engine(thread.members[0])}">${threadAvatar(thread, 38)}<div class="th-title"><strong>${esc(thread.name)}</strong><small>${esc(sub)}</small></div>
        ${btn('bring', selecting ? '取消' : icon('book') + '带进剧情', 'chip-button')}${btn('thread-menu', icon('more'), 'round-button', 'aria-label="更多"')}</div>
      <div class="msgs" role="log" aria-live="polite">${list.length ? list.map((m, i) => messageHTML(m, i, list)).join('') : `<p class="chat-empty">${live ? '发一条消息，或者点左下角让对方先开口。' : '在酒馆里打开小手机时，联系人才会回复。'}</p>`}
        ${bring?.threadId === threadId ? `<div class="sys">${icon('book')}${bring.count} 条消息会带进下一次正文 ${btn('cancel-bring', '取消', 'text-button')}</div>` : ''}
        ${typing() ? `<div class="msg" data-engine="${group ? 'none' : engine(thread.members[0])}">${avatar(group ? '…' : thread.members[0], group ? 'none' : engine(thread.members[0]), 34)}<div class="m-body"><div class="chat-bubble typing" aria-label="对方正在输入"><i></i><i></i><i></i></div></div></div>` : ''}</div>
      ${selecting
        ? `<div class="bring-bar"><span>${selecting.size ? `已选 ${selecting.size} 条` : '点消息来选择'}</span>${btn('bring-go', '带进下一次正文', 'primary', selecting.size ? '' : 'disabled')}</div>`
        : `<div class="composer">${btn('nudge', icon('reply'), 'round-button', `aria-label="让${group ? '群里' : '对方'}回复" ${live ? '' : 'disabled'}`)}<input class="field-in" data-field="draft" value="${esc(drafts.get(threadId) || '')}" placeholder="${group ? '发到群聊…' : '发消息…'}" enterkeyhint="send" autocomplete="off" aria-label="消息">${btn('send', icon('send'), 'round-button send', 'aria-label="发送"')}</div>`}
    </div>`);
    const msgs = v.root.querySelector('.msgs');
    if (atBottom || stick) msgs.scrollTop = msgs.scrollHeight;
    stick = false;
    paintVoices();
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
    threadId = id; mode = 'thread'; selecting = null; stick = true;
    return render();
  }

  // ---------- Actions ----------
  async function send() {
    const el = v.root.querySelector('[data-field=draft]'), text = el?.value.trim();
    if (!text) return;
    el.value = '';
    drafts.delete(threadId);
    await api.appendChat(threadId, [{from: 'me', kind: 'text', text}], {read: true});
    scheduleReply();
  }
  // Waits a moment so several quick messages get one reply.
  function scheduleReply(delay = 1400) {
    if (!live) return;
    ctx.win.clearTimeout(replyTimer);
    const id = threadId;
    replyTimer = ctx.win.setTimeout(() => requestReply(id), delay);
  }
  function requestReply(id = threadId) {
    if (!live || !id) return;
    ctx.win.clearTimeout(replyTimer);
    const job = api.chatReply(id);
    if (mode === 'thread' && id === threadId) render();
    job.catch(error => ctx.notify(error.message));
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
  function messageMenu(m) {
    const contact = m.from !== 'me', last = contact && thread.messages.at(-1)?.id === m.id;
    const d = ctx.dialog('消息', `<p class="help-copy">${esc(m.kind === 'voice' ? (m.translation || m.text) : m.text)}</p><div class="actions">${btn('copy', icon('copy') + '复制', 'secondary')}${btn('delete', icon('trash') + '删除', 'danger')}</div>${last && live ? `<div class="actions">${btn('reroll', icon('refresh') + '重新回复这一轮', 'secondary')}</div>` : ''}`);
    d.body.addEventListener('click', e => {
      const action = e.target.closest('button')?.dataset.action;
      if (!action) return;
      d.close();
      ctx.win.Promise.resolve().then(async () => {
        if (action === 'copy') { await ctx.win.navigator.clipboard?.writeText(m.kind === 'voice' ? m.text : m.text); ctx.notify('已复制'); }
        if (action === 'delete') await api.deleteChatMessages(threadId, [m.id]);
        if (action === 'reroll') await reroll();
      }).catch(error => ctx.notify(error.message));
    });
  }
  // Removes the contacts' latest messages (after the user's last one) and asks again.
  async function reroll() {
    const list = thread.messages, cut = list.findLastIndex(m => m.from === 'me' && m.kind !== 'system');
    const drop = list.slice(cut + 1).filter(m => m.from !== 'me').map(m => m.id);
    if (drop.length) await api.deleteChatMessages(threadId, drop);
    requestReply();
  }
  function threadMenu() {
    const group = thread.type === 'group';
    const d = ctx.dialog(thread.name, `<div class="pick-list">
      ${live ? `<button class="list-row" data-menu="reroll">${icon('refresh')}<span><strong>重新回复最后一轮</strong></span></button>` : ''}
      ${group ? `<button class="list-row" data-menu="rename">${icon('edit')}<span><strong>改群名</strong></span></button>` : ''}
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
        if (action === 'clear' && await ctx.confirm('清空聊天记录？', '这段聊天会保留，消息全部删除。')) await api.deleteChatMessages(threadId, thread.messages.map(m => m.id));
        if (action === 'delete' && await ctx.confirm('删除这段聊天？', '聊天记录会一起删除，联系人不受影响。')) { await api.deleteThread(threadId); mode = 'list'; threadId = null; render(); }
      }).catch(error => ctx.notify(error.message));
    });
  }

  v.on('input', '[data-field=draft]', el => drafts.set(threadId, el.value));
  v.on('keydown', '[data-field=draft]', (el, e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); return send(); } });
  v.on('click', '.msg[data-mid]', el => {
    if (!selecting) return;
    const id = el.dataset.mid;
    if (selecting.has(id)) selecting.delete(id); else selecting.add(id);
    render();
  });
  v.on('click', '[data-action]', async el => {
    const action = el.dataset.action;
    if (selecting && ['message', 'voice'].includes(action)) return;
    switch (action) {
      case 'filter': filter = el.dataset.filter; render(); break;
      case 'open': open(el.dataset.id); break;
      case 'new-chat': newChat(); break;
      case 'contacts': mode = 'contacts'; contactDraft = null; render(); break;
      case 'send': await send(); break;
      case 'nudge': requestReply(); break;
      case 'message': { const m = thread.messages.find(x => x.id === el.dataset.mid); if (m) messageMenu(m); break; }
      case 'voice': {
        const m = thread.messages.find(x => x.id === el.dataset.mid);
        if (!m) break;
        if (!ctx.routeFor(m.from)?.voice) { ctx.notify(`${m.from} 还没有配音`); break; }
        if (el.dataset.state === 'playing') { api.stop(); break; }
        await api.speak(lineOf(m));
        break;
      }
      case 'thread-menu': threadMenu(); break;
      case 'bring': selecting = selecting ? null : new Set(); render(); break;
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
    if (mode === 'thread' && selecting) { selecting = null; render(); return true; }
    if (mode === 'contacts' && contactDraft) { contactDraft = null; render(); return true; }
    if (mode !== 'list') { mode = 'list'; threadId = null; selecting = null; render(); return true; }
    return false;
  };
  v.refresh = () => render();
  v.openThread = open;
  v.onChat = event => {
    if (mode === 'list') return render();
    if (mode === 'thread' && (!event.threadId || event.threadId === threadId)) return render();
  };
  v.onPlayback = () => { if (mode === 'thread') paintVoices(); };
  render();
  return v;
}
