// Phone chat history, kept in this browser (IndexedDB) and scoped to the tavern account like the other local data.
// Thread: {id, type:'dm'|'group', name, members:[name], unread, createdAt, updatedAt, messages:[Message]}
// Message: {id, from:'me'|name, kind, text, at, quote?:{from,text}} plus, by kind:
//   voice: translation, emotion · photo: photoId? (none when a contact describes a photo in words)
//   redpacket: amount, state:'sent'|'opened', openedBy? · transfer: amount, state:'sent'|'accepted'|'returned'
//   location: text = place, detail = address · pat: target (who was patted) · dice: text = 1..6
//   notice: text = what `from` did, with {对方} standing for `target` · recall: a withdrawn message · system: app notes
// list() returns threads without their messages, plus the last message for previews.

export const CHAT_STORE_LIMITS = Object.freeze({messages: 1000, text: 4000, members: 20});
const KINDS = ['text', 'voice', 'photo', 'system', 'redpacket', 'transfer', 'location', 'pat', 'dice', 'notice', 'recall'];
const STATES = {redpacket: ['sent', 'opened'], transfer: ['sent', 'accepted', 'returned']};
/** Money as a string with two decimals, 0.01 to 200000; null when the value is not an amount. */
export function money(value) {
  const n = Math.round(Number(String(value ?? '').replace(/[¥￥,，\s元]/g, '')) * 100) / 100;
  return Number.isFinite(n) && n >= 0.01 && n <= 200000 ? n.toFixed(2) : null;
}
const fail = (message, code = 'INVALID') => Object.assign(new Error(message), {code});
const clip = (value, max) => String(value ?? '').slice(0, max);

function cleanMessage(m, id, at) {
  if (!m || typeof m !== 'object') throw fail('消息格式无效');
  const kind = KINDS.includes(m.kind) ? m.kind : 'text';
  const from = clip(m.from, 40).trim();
  if (!from) throw fail('消息缺少发送人');
  const out = {id, from, kind, text: clip(m.text, CHAT_STORE_LIMITS.text), at};
  if (kind === 'voice') { out.translation = clip(m.translation, CHAT_STORE_LIMITS.text); out.emotion = clip(m.emotion, 100); }
  if (kind === 'photo' && m.photoId) out.photoId = clip(m.photoId, 512);
  if (STATES[kind]) {
    out.amount = money(m.amount);
    if (!out.amount) throw fail('金额无效');
    out.state = STATES[kind].includes(m.state) ? m.state : 'sent';
    if (m.openedBy) out.openedBy = clip(m.openedBy, 40);
  }
  if (kind === 'location') out.detail = clip(m.detail, 200);
  if (kind === 'pat' || kind === 'notice') out.target = clip(m.target, 40).trim() || 'me';
  if (kind === 'dice') out.text = String(Math.min(6, Math.max(1, Math.round(Number(m.text)) || 1)));
  if (kind === 'recall') out.text = '';
  if (m.quote?.text && ['text', 'voice'].includes(kind)) out.quote = {from: clip(m.quote.from, 40), text: clip(m.quote.text, 200)};
  const textless = ['photo', 'system', 'redpacket', 'transfer', 'pat', 'dice', 'recall'];
  if (!textless.includes(kind) && !out.text.trim()) throw fail('消息内容为空');
  return out;
}

export class ChatStore {
  #scope; #factory; #now; #id; #db = null; #opening = null; #closed = false;
  constructor(scope, {indexedDB = globalThis.indexedDB, now = Date.now, id = () => globalThis.crypto.randomUUID()} = {}) {
    this.#scope = String(scope); this.#factory = indexedDB; this.#now = now; this.#id = id;
  }
  async #open() {
    if (this.#closed) throw fail('聊天记录已关闭', 'CLOSED');
    if (this.#db) return this.#db;
    if (!this.#factory?.open) throw fail('浏览器不支持本地保存聊天记录，请检查存储权限', 'STORAGE_UNAVAILABLE');
    this.#opening ||= new Promise((resolve, reject) => {
      const req = this.#factory.open('st-iphonie-chats-v1', 1);
      req.onupgradeneeded = () => { const store = req.result.createObjectStore('threads', {keyPath: ['scope', 'id']}); store.createIndex('scope', 'scope'); };
      req.onerror = () => reject(fail('无法打开聊天记录，请检查浏览器的存储权限', 'STORAGE_UNAVAILABLE'));
      req.onblocked = () => reject(fail('另一个页面占用了聊天记录，请关闭旧页面后重试', 'STORAGE_BLOCKED'));
      req.onsuccess = () => {
        if (this.#closed) { req.result.close(); reject(fail('聊天记录已关闭', 'CLOSED')); return; }
        this.#db = req.result;
        this.#db.onversionchange = () => { this.#db?.close(); this.#db = null; };
        resolve(this.#db);
      };
    }).finally(() => { this.#opening = null; });
    return this.#opening;
  }
  async #tx(mode, work) {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      let result, own, tx;
      try { tx = db.transaction('threads', mode); } catch { reject(fail('聊天记录已关闭', 'CLOSED')); return; }
      const store = tx.objectStore('threads');
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(own || fail(tx.error?.name === 'QuotaExceededError' ? '设备存储空间不足，聊天没有保存' : '聊天记录没有保存，请重试', 'STORAGE'));
      work(store, value => { result = value; }, error => { own = error; tx.abort(); });
    });
  }
  #get(store, id, then) {
    const req = store.get([this.#scope, String(id)]);
    req.onsuccess = () => then(req.result || null);
  }
  #public(row, full = true) {
    if (!row) return null;
    const {scope, messages, ...rest} = row;
    return full ? structuredClone({...rest, messages}) : structuredClone({...rest, count: messages.length, last: messages.filter(m => m.kind !== 'system').at(-1) || null});
  }

  async list() {
    const rows = await this.#tx('readonly', (store, done) => { const req = store.index('scope').getAll(this.#scope); req.onsuccess = () => done(req.result); });
    return rows.sort((a, b) => b.updatedAt - a.updatedAt).map(row => this.#public(row, false));
  }
  async get(id) {
    return this.#tx('readonly', (store, done) => this.#get(store, id, row => done(this.#public(row))));
  }
  async create({type = 'dm', name = '', members = []} = {}) {
    const list = [...new Set((Array.isArray(members) ? members : []).map(m => clip(m, 40).trim()).filter(Boolean))];
    if (!list.length) throw fail('请选择聊天对象');
    if (list.length > CHAT_STORE_LIMITS.members) throw fail('群聊最多 20 人');
    if (type === 'group' && list.length < 2) throw fail('群聊至少要选两个人');
    const now = this.#now(), row = {scope: this.#scope, id: this.#id(), type: type === 'group' ? 'group' : 'dm', name: clip(name, 40).trim() || (type === 'group' ? list.join('、').slice(0, 40) : list[0]), members: type === 'group' ? list : [list[0]], unread: 0, createdAt: now, updatedAt: now, messages: []};
    await this.#tx('readwrite', (store, done) => { store.put(row); done(); });
    return this.#public(row);
  }
  async #change(id, change) {
    return this.#tx('readwrite', (store, done, abort) => this.#get(store, id, row => {
      if (!row) { abort(fail('这段聊天已不存在', 'MISSING')); return; }
      try { change(row); } catch (error) { abort(error); return; }
      if (row.messages.length > CHAT_STORE_LIMITS.messages) row.messages = row.messages.slice(-CHAT_STORE_LIMITS.messages);
      store.put(row);
      done(this.#public(row));
    }));
  }
  async update(id, {name, members} = {}) {
    return this.#change(id, row => {
      if (name !== undefined) row.name = clip(name, 40).trim() || row.name;
      if (members !== undefined && row.type === 'group') {
        const list = [...new Set(members.map(m => clip(m, 40).trim()).filter(Boolean))];
        if (list.length < 2) throw fail('群聊至少要选两个人');
        row.members = list.slice(0, CHAT_STORE_LIMITS.members);
      }
      row.updatedAt = this.#now();
    });
  }
  /** Adds messages. Replies count as unread unless `read` is set (the chat is open on screen). */
  async append(id, messages, {read = false} = {}) {
    return this.#change(id, row => {
      const now = this.#now();
      const added = messages.map((m, i) => cleanMessage(m, this.#id(), now + i));
      row.messages.push(...added);
      if (!read) row.unread += added.filter(m => m.from !== 'me' && !['system', 'notice', 'recall'].includes(m.kind)).length;
      row.updatedAt = now;
    });
  }
  /**
   * Changes one message: {state, openedBy} for a red packet or transfer, or {recall: true} to withdraw it
   * (the message keeps its place and sender and loses its content).
   */
  async updateMessage(id, messageId, patch = {}) {
    return this.#change(id, row => {
      const m = row.messages.find(x => x.id === messageId);
      if (!m) throw fail('这条消息已不存在', 'MISSING');
      if (patch.recall) {
        for (const key of Object.keys(m)) if (!['id', 'from', 'at'].includes(key)) delete m[key];
        Object.assign(m, {kind: 'recall', text: ''});
        return;
      }
      if (!STATES[m.kind]) throw fail('这条消息不能修改');
      if (patch.state !== undefined) {
        if (!STATES[m.kind].includes(patch.state)) throw fail('状态无效');
        m.state = patch.state;
      }
      if (patch.openedBy !== undefined) m.openedBy = clip(patch.openedBy, 40);
    });
  }
  async removeMessages(id, ids) {
    const drop = new Set(ids);
    return this.#change(id, row => { row.messages = row.messages.filter(m => !drop.has(m.id)); });
  }
  async markRead(id) {
    return this.#change(id, row => { row.unread = 0; });
  }
  async remove(id) {
    return this.#tx('readwrite', (store, done) => { store.delete([this.#scope, String(id)]); done(true); });
  }
  async unread() {
    return (await this.list()).reduce((n, t) => n + t.unread, 0);
  }
  /** Every thread with its messages, for a backup. */
  async exportThreads() {
    const rows = await this.#tx('readonly', (store, done) => { const req = store.index('scope').getAll(this.#scope); req.onsuccess = () => done(req.result); });
    return rows.map(row => this.#public(row));
  }
  /** Puts backup threads back with their ids, checked like new ones, in one transaction. replace: other threads go. */
  async importThreads(threads, {replace = false} = {}) {
    if (!Array.isArray(threads)) throw fail('备份里的聊天记录无效');
    const now = this.#now(), rows = threads.map(t => {
      if (!t || typeof t !== 'object' || !t.id) throw fail('备份里的聊天记录无效');
      const members = [...new Set((Array.isArray(t.members) ? t.members : []).map(m => clip(m, 40).trim()).filter(Boolean))].slice(0, CHAT_STORE_LIMITS.members);
      if (!members.length) throw fail('备份里有一段聊天没有聊天对象');
      const messages = (Array.isArray(t.messages) ? t.messages : []).slice(-CHAT_STORE_LIMITS.messages).map(m => cleanMessage(m, clip(m?.id || this.#id(), 512), Number.isFinite(m?.at) ? m.at : now));
      return {scope: this.#scope, id: clip(t.id, 512), type: t.type === 'group' ? 'group' : 'dm', name: clip(t.name, 40).trim() || members.join('、').slice(0, 40), members: t.type === 'group' ? members : [members[0]],
        unread: Math.max(0, Math.min(CHAT_STORE_LIMITS.messages, Math.round(Number(t.unread)) || 0)), createdAt: Number.isFinite(t.createdAt) ? t.createdAt : now, updatedAt: Number.isFinite(t.updatedAt) ? t.updatedAt : now, messages};
    });
    return this.#tx('readwrite', (store, done) => {
      const write = () => { for (const row of rows) store.put(row); done(rows.length); };
      if (!replace) { write(); return; }
      const req = store.index('scope').getAllKeys(this.#scope);
      req.onsuccess = () => { for (const key of req.result) store.delete(key); write(); };
    });
  }
  close() { this.#closed = true; this.#db?.close(); this.#db = null; }
}
