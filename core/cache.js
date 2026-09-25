const MAX_BYTES=200*1024*1024;
export async function requestHash(request){const bytes=new TextEncoder().encode(JSON.stringify(request));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
export class AudioCache{
 constructor(scope,notify=()=>{}){this.scope=scope;this.notify=notify;this.epoch=0;this.db=null;this.failed=false;}
 async open(){if(this.failed)return null;if(!this.db)this.db=new Promise((resolve,reject)=>{const req=indexedDB.open('st-tts-audio-v1',1);req.onupgradeneeded=()=>req.result.createObjectStore('audio',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(Error('缓存正在被另一个页面使用'));}).catch(()=>{this.failed=true;this.notify('本机无法保存语音缓存；仍可生成和播放');return null;});return this.db;}
 async transaction(mode,action){const db=await this.open();if(!db)return null;return new Promise((resolve,reject)=>{const tx=db.transaction('audio',mode),store=tx.objectStore('audio');let value;try{value=action(store);}catch(e){tx.abort();reject(e);return;}tx.oncomplete=()=>resolve(value?.result??value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('缓存操作中止'));});}
 id(key){return this.scope+':'+key;}
 async get(key){try{const row=await this.transaction('readonly',s=>s.get(this.id(key)));return row?.blob instanceof Blob&&row.blob.size?row.blob:null;}catch{return null;}}
 async put(key,blob,epoch=this.epoch){if(epoch!==this.epoch||blob.size>MAX_BYTES)return;try{const rows=await this.transaction('readonly',s=>s.getAll());if(!rows||epoch!==this.epoch)return;const own=rows.filter(r=>r.scope===this.scope).sort((a,b)=>a.at-b.at);let total=own.reduce((n,r)=>n+r.size,0)+blob.size;const remove=[];for(const r of own){if(total<=MAX_BYTES)break;total-=r.size;remove.push(r.id);}await this.transaction('readwrite',s=>{if(epoch!==this.epoch)return;for(const id of remove)s.delete(id);s.put({id:this.id(key),scope:this.scope,at:Date.now(),size:blob.size,blob});});}catch{this.notify('语音已生成，但本机缓存未能保存');}}
 async stats(){const rows=await this.transaction('readonly',s=>s.getAll()).catch(()=>null);const own=(rows||[]).filter(r=>r.scope===this.scope);return {count:own.length,bytes:own.reduce((n,r)=>n+r.size,0)};}
 async clear(){this.epoch++;await this.transaction('readwrite',s=>{const cursor=s.openCursor();cursor.onsuccess=()=>{const row=cursor.result;if(!row)return;if(row.value.scope===this.scope)row.delete();row.continue();};});}
 async close(){const db=await this.db;db?.close();this.db=null;}
}
