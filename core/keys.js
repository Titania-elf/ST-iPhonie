// Voice engines, NovelAI for drawing, and llm: the phone's own text model (an OpenAI-compatible API).
const engines=['fish','mini','eleven','nai','llm'];
// Keys copied from web pages and chat apps often carry invisible characters (zero-width spaces, line breaks), full-width
// letters typed with a Chinese input method, quotes, or a "Bearer " prefix. No key contains any of these, and a service
// answers such a key with 401 although the key itself is valid, so they are taken out before the key is kept or sent.
export function cleanKey(value){
 let key=String(value??'').normalize('NFKC').replace(/[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g,'');
 key=key.trim().replace(/^bearer\s+/i,'').replace(/\s+/g,'').replace(/^["'`“”‘’「」]+|["'`“”‘’「」]+$/g,'');
 return key;
}
export function validateKey(engine,value){if(!engines.includes(engine))throw Error('引擎无效');const key=cleanKey(value);if(key.length>4096)throw Error('密钥格式无效');if(/[^\x21-\x7E]/.test(key))throw Error('密钥里有不是英文字母、数字或符号的字，请回到官网重新复制一次');return key;}
/** The last characters of a key, to tell which key is saved without showing it. */
export const keyTail=key=>key&&key.length>=8?key.slice(-4):'';
export class LocalKeyStore{
 constructor(scope,storage=()=>globalThis.localStorage){this.prefix='sttts.keys.v1:'+encodeURIComponent(scope)+':';this.storage=storage;}
 load(){const result=new Map();let storage;try{storage=this.storage();for(const engine of engines){const value=storage.getItem(this.prefix+engine);if(value){try{const key=validateKey(engine,value);if(key)result.set(engine,key);}catch{}}}}catch{throw Error('浏览器无法读取已保存的密钥，请在引擎设置重新填写');}return result;}
 save(engine,value){const key=validateKey(engine,value);try{const storage=this.storage();if(key)storage.setItem(this.prefix+engine,key);else storage.removeItem(this.prefix+engine);}catch{throw Error('浏览器无法保存密钥，请检查是否允许本地存储');}return key;}
}
