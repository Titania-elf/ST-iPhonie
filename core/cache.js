const MAX_BYTES = 200 * 1024 * 1024;
export async function requestHash(request) {
 const bytes = new TextEncoder().encode(JSON.stringify(request));
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
export class AudioCache {
 constructor(scope, notify = () => {}, factory = globalThis.indexedDB) { Object.assign(this, { scope, notify, factory, epoch: 0, db: null, failed: false, closed: false }); }
 async open() {
  if (this.failed || this.closed) return null;
  if (!this.db) this.db = new Promise((resolve, reject) => {
   const request = this.factory.open('st-tts-audio-v1', 1);
   let settled = false;
   const fail = error => { if (!settled) { settled = true; reject(error); } };
   request.onupgradeneeded = () => request.result.createObjectStore('audio', { keyPath: 'id' });
   request.onsuccess = () => {
    if (settled || this.closed) { request.result.close(); if (!settled) { settled = true; resolve(null); } return; }
    settled = true; request.result.onversionchange = () => request.result.close(); resolve(request.result);
   };
   request.onerror = () => fail(request.error);
   request.onblocked = () => fail(Error('缓存正在被另一个页面使用'));
  }).catch(() => { this.failed = true; if (!this.closed) this.notify('本机无法保存语音缓存；仍可生成和播放'); return null; });
  return this.db;
 }
 async transaction(mode, action) {
  const db = await this.open(); if (!db) return null;
  return new Promise((resolve, reject) => {
   const tx = db.transaction('audio', mode); let value;
   try { value = action(tx.objectStore('audio')); } catch (error) { tx.abort(); reject(error); return; }
   tx.oncomplete = () => resolve(value && typeof value === 'object' && 'onsuccess' in value ? value.result : value);
   tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || Error('缓存操作中止'));
  });
 }
 id(key) { return this.scope + ':' + key; }
 async getRecord(key) { try { return await this.transaction('readonly', store => store.get(this.id(key))) || null; } catch { return null; } }
 async get(key) { const row = await this.getRecord(key); return row?.blob instanceof Blob && row.blob.size ? row.blob : null; }
 async has(key) { return Boolean(await this.get(key)); }
 async put(key, blob, epoch = this.epoch, metadata = {}) {
  if (epoch !== this.epoch || !(blob instanceof Blob) || !blob.size || blob.size > MAX_BYTES) return;
  try { await this.transaction('readwrite', store => {
   if (epoch !== this.epoch) return;
   const request = store.getAll(); request.onsuccess = () => {
    if (epoch !== this.epoch) return;
    const own = request.result.filter(row => row.scope === this.scope && row.id !== this.id(key)).sort((a,b) => a.at-b.at);
    let total = own.reduce((sum,row) => sum + row.size,0) + blob.size;
    for (const row of own) { if (total <= MAX_BYTES) break; total -= row.size; store.delete(row.id); }
    store.put({ id: this.id(key), key, scope:this.scope, at:Date.now(), size:blob.size, blob, metadata:structuredClone(metadata) });
   };
  }); } catch { this.notify('语音已生成，但本机缓存未能保存'); }
 }
 async list() {
  const rows = await this.transaction('readonly',store => store.getAll()).catch(() => null);
  return (rows || []).filter(row => row.scope===this.scope).sort((a,b) => b.at-a.at).map(row => ({key:row.key || row.id.slice(this.scope.length+1),at:row.at,bytes:row.size,metadata:structuredClone(row.metadata || {})}));
 }
 async stats() { const rows=await this.list(); return {count:rows.length,bytes:rows.reduce((sum,row)=>sum+row.bytes,0),available:!this.failed&&!this.closed}; }
 async remove(key) { this.epoch++; if(!await this.open()) throw Error('无法访问本机语音缓存'); await this.transaction('readwrite',store=>store.delete(this.id(key))); }
 async clear() {
  this.epoch++; if(!await this.open()) throw Error('无法访问本机语音缓存');
  await this.transaction('readwrite',store=>{const cursor=store.openCursor();cursor.onsuccess=()=>{const row=cursor.result;if(!row)return;if(row.value.scope===this.scope)row.delete();row.continue();};});
 }
 async close() {
  if (this.closed) return this.closing;
  this.closed = true; this.epoch++;
  this.closing = (async () => { const db = await this.db; db?.close(); this.db = null; })();
  return this.closing;
 }
}
