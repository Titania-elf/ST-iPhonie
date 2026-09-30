// Voice engines, NovelAI for drawing, and llm: the phone's own text model (an OpenAI-compatible API).
const engines=['fish','mini','eleven','nai','llm'];
export function validateKey(engine,value){if(!engines.includes(engine))throw Error('引擎无效');const key=String(value).trim();if(key.length>4096||/[\r\n]/.test(key))throw Error('密钥格式无效');return key;}
export class LocalKeyStore{
 constructor(scope,storage=()=>globalThis.localStorage){this.prefix='sttts.keys.v1:'+encodeURIComponent(scope)+':';this.storage=storage;}
 load(){const result=new Map();let storage;try{storage=this.storage();for(const engine of engines){const value=storage.getItem(this.prefix+engine);if(value){try{const key=validateKey(engine,value);if(key)result.set(engine,key);}catch{}}}}catch{throw Error('浏览器无法读取已保存的密钥，请在引擎设置重新填写');}return result;}
 save(engine,value){const key=validateKey(engine,value);try{const storage=this.storage();if(key)storage.setItem(this.prefix+engine,key);else storage.removeItem(this.prefix+engine);}catch{throw Error('浏览器无法保存密钥，请检查是否允许本地存储');}return key;}
}
