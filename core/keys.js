// Voice engines, NovelAI for drawing, and llm: the phone's own text model (an OpenAI-compatible API).
const engines=['fish','mini','eleven','mimo','nai','llm'];
// Keys copied from web pages and chat apps often carry invisible characters (zero-width spaces, line breaks), full-width
// letters typed with a Chinese input method, quotes, or a "Bearer " prefix. No key contains any of these, and a service
// answers such a key with 401 although the key itself is valid, so they are taken out before the key is kept or sent.
export function cleanKey(value){
 let key=String(value??'').normalize('NFKC').replace(/[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g,'');
 key=key.trim().replace(/^bearer\s+/i,'').replace(/\s+/g,'').replace(/^["'`“”‘’「」]+|["'`“”‘’「」]+$/g,'');
 return key;
}
// Engines that take several keys, one per line: when one is refused or used up, the next one is used (core/providers.js).
export const MULTI_KEY=new Set(['fish','mini','eleven','mimo']);
function checkKey(key){if(key.length>4096)throw Error('密钥格式无效');if(/[^\x21-\x7E]/.test(key))throw Error('密钥里有不是英文字母、数字或符号的字，请回到官网重新复制一次');return key;}
// The text model keeps one key per connection preset: lines of "<preset id><tab><key>". A key saved before presets
// (a line without a tab) belongs to the first preset, 'default'.
export function parseTextKeys(value){const out=new Map();for(const line of String(value??'').split('\n')){if(!line.trim())continue;const at=line.indexOf('\t'),id=at<0?'default':line.slice(0,at).trim(),key=checkKey(cleanKey(at<0?line:line.slice(at+1)));if(/^[\w-]{1,64}$/.test(id)&&key)out.set(id,key);}return out;}
export const joinTextKeys=map=>[...map].filter(([,key])=>key).map(([id,key])=>id+'\t'+key).join('\n');
export function validateKey(engine,value){if(!engines.includes(engine))throw Error('引擎无效');
 if(engine==='llm')return joinTextKeys(parseTextKeys(value));
 // Several keys come one per line (commas, semicolons and spaces also separate them); repeats are kept once, in order.
 if(MULTI_KEY.has(engine)){const keys=[...new Set(String(value??'').normalize('NFKC').split(/[\s,;，；、]+/).map(cleanKey).filter(part=>part&&!/^bearer$/i.test(part)))];if(keys.length>50)throw Error('最多填 50 个密钥');return keys.map(checkKey).join('\n');}
 return checkKey(cleanKey(value));}
/** The last characters of a key, to tell which key is saved without showing it. */
export const keyTail=key=>key&&key.length>=8?key.slice(-4):'';
export class LocalKeyStore{
 constructor(scope,storage=()=>globalThis.localStorage){this.prefix='sttts.keys.v1:'+encodeURIComponent(scope)+':';this.storage=storage;}
 load(){const result=new Map();let storage;try{storage=this.storage();for(const engine of engines){const value=storage.getItem(this.prefix+engine);if(value){try{const key=validateKey(engine,value);if(key)result.set(engine,key);}catch{}}}}catch{throw Error('浏览器无法读取已保存的密钥，请在引擎设置重新填写');}return result;}
 save(engine,value){const key=validateKey(engine,value);try{const storage=this.storage();if(key)storage.setItem(this.prefix+engine,key);else storage.removeItem(this.prefix+engine);}catch{throw Error('浏览器无法保存密钥，请检查是否允许本地存储');}return key;}
}
