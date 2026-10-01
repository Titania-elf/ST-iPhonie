import { validateKey } from './keys.js';
import { TTSParameters as P } from './parameters.js';
const names={fish:'Fish Audio',mini:'MiniMax',eleven:'ElevenLabs'};
export const miniBase=c=>'https://'+(c.region==='cn'?'api.minimaxi.com':c.region==='uw'?'api-uw.minimax.io':'api.minimax.io');
const object=value=>Object.prototype.toString.call(value)==='[object Object]';
function checkedConnection(engine,connection,route,line,references){
 if(!Object.hasOwn(P.catalogs,engine))throw Error('引擎无效');
 if(!object(connection)||!object(connection.params))throw Error('引擎设置格式无效，请重新保存引擎设置');
 if(!object(route)||route.voice!==undefined&&typeof route.voice!=='string'||route.model!==undefined&&typeof route.model!=='string'||route.language!==undefined&&typeof route.language!=='string')throw Error('角色配音设置无效');
 if(!object(line)||typeof line.text!=='string'||!line.text.trim())throw Error('朗读文本不能为空');
 if(!references||typeof references.get!=='function')throw Error('参考音频数据无效，请重新选择文件');
 const model=route.model||connection.model;
 if(typeof model!=='string'||!P.catalogs[engine].models.includes(model))throw Error('请选择当前引擎支持的模型');
 let c;try{c=structuredClone(connection);}catch{throw Error('引擎设置格式无效，请重新保存引擎设置');}
 c.model=model;c.params={...P.defaults(engine),...c.params};
 for(const field of P.catalogs[engine].groups.flatMap(group=>group.fields)){
  const value=c.params[field.key],invalid=()=>{throw Error(field.label+'格式无效，请检查此项设置');};
  if(field.type==='rows'){
   if(!Array.isArray(value))invalid();
   for(const row of value){
    if(!object(row))invalid();
    for(const column of field.columns){
     const cell=row[column.key];
     if(cell===undefined&&column.optional)continue;
     if(column.type==='boolean'&&typeof cell!=='boolean'||column.type==='number'&&typeof cell!=='number'||!['number','boolean'].includes(column.type)&&typeof cell!=='string')invalid();
    }
   }
  }else if(field.type==='boolean'&&typeof value!=='boolean'||field.type==='number'&&typeof value!=='number'&&value!==''||field.type==='select'&&!['string','number'].includes(typeof value)||['text','textarea','lines'].includes(field.type)&&typeof value!=='string')invalid();
 }
 return c;
}
export function buildRequest(engine,connection,route,line,references=new Map()){
 const c=checkedConnection(engine,connection,route,line,references);P.normalize(engine,c);const error=P.validate(engine,c);if(error)throw Error(error);
 if(engine==='fish'&&c.model==='drama-3-preview')throw Error('这个模型尚未列入 Fish 兼容通道，请选择 S2 或 S1');
 if(!route.voice?.trim()&&!(engine==='fish'&&c.params.references.length)&&!(engine==='mini'&&c.params.timbre_weights.length))throw Error('请先选择角色音色');
 // The 情绪 field becomes the model's own opening tag (Fish, Eleven v3/v4) unless the text already starts with one.
 const request=P.requestPreview(engine,c,route.voice,P.emotionTag(engine,c.model,line.emotion,line.text),c.model);
 if(engine==='fish'&&c.params.references.length){request.body.provider.options['fish-audio'].references=c.params.references.map(r=>{const audio=references.get(r.audio);if(typeof audio!=='string'||!audio)throw Error('请在引擎设置重新选择参考音频：'+r.audio);return {audio,text:r.text};});}
 // MiniMax takes a fixed emotion list: Chinese or English words map onto it; anything else lets the model choose.
 if(engine==='mini'&&!request.body.voice_setting.emotion){const emotion=P.miniEmotion(c.model,line.emotion);if(emotion)request.body.voice_setting.emotion=emotion;else delete request.body.voice_setting.emotion;}
 if(engine==='eleven'&&!request.body.language_code&&c.model!=='eleven_multilingual_v2'&&route.language)request.body.language_code=route.language;
 const url=new URL(request.url);for(const [k,v] of Object.entries(request.query||{}))url.searchParams.set(k,String(v));
 return {engine,url:url.href,body:request.body,format:engine==='fish'?c.params.format:engine==='mini'?c.params['audio_setting.format']:c.params.output_format,sampleRate:engine==='fish'?c.params.sample_rate:engine==='mini'?c.params['audio_setting.sample_rate']:Number(c.params.output_format.split('_')[1]),channels:engine==='mini'?c.params['audio_setting.channel']:1};
}
export function hexBytes(hex){if(typeof hex!=='string'||!hex.length||hex.length%2||!/^[\da-f]+$/i.test(hex))throw Error('返回的音频数据无效');return Uint8Array.from(hex.match(/../g),x=>parseInt(x,16));}
export function wavePCM(bytes,rate=24000,channels=1){if(bytes.length%2||!Number.isFinite(rate)||rate<8000||rate>192000||![1,2].includes(channels))throw Error('PCM 音频参数无效');const out=new Uint8Array(44+bytes.length),v=new DataView(out.buffer),ascii=(p,s)=>[...s].forEach((x,i)=>v.setUint8(p+i,x.charCodeAt(0)));ascii(0,'RIFF');v.setUint32(4,36+bytes.length,true);ascii(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,rate,true);v.setUint32(28,rate*channels*2,true);v.setUint16(32,channels*2,true);v.setUint16(34,16,true);ascii(36,'data');v.setUint32(40,bytes.length,true);out.set(bytes,44);return out;}
function g711(bytes,alaw){const out=new Uint8Array(bytes.length*2),v=new DataView(out.buffer);bytes.forEach((b,i)=>{let n;if(alaw){b^=0x55;const seg=(b&112)>>4;n=(b&15)<<4;if(seg===0)n+=8;else{n+=264;if(seg>1)n<<=seg-1;}n=b&128?n:-n;}else{b=~b&255;n=(((b&15)<<3)+132)<<((b&112)>>4);n=(b&128)?132-n:n-132;}v.setInt16(i*2,n,true);});return out;}
export function audioBlob(bytes,request){let format=request.format.split('_')[0];if(request.format==='pcmu_raw'||format==='ulaw'||format==='alaw'){bytes=g711(bytes,format==='alaw');format='pcm';}if(format==='pcm'){bytes=wavePCM(bytes,request.sampleRate,request.channels);format='wav';}if(!bytes.length)throw Error('语音接口没有返回音频');return new Blob([bytes],{type:({mp3:'audio/mpeg',wav:'audio/wav',pcmu:'audio/wav',opus:'audio/ogg',flac:'audio/flac'})[format]||'application/octet-stream'});}
const limit=64*1024*1024;
export async function limitedBytes(response){const reader=response.body?.getReader();if(!reader){const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>limit)throw Error('单段音频过大，请缩短台词');return bytes;}const chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('单段音频过大，请缩短台词');chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}const out=new Uint8Array(size);let at=0;for(const c of chunks){out.set(c,at);at+=c.length;}return out;}
async function fetchWithPolicy(fetcher,url,init,signal){try{return await fetcher(url,{...init,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(20000)});}catch(e){if(signal?.aborted)throw new DOMException('已停止','AbortError');if(e.name==='TimeoutError')throw Error('请求超时，请稍后手动重试');throw Error('无法连接语音服务，请检查网络或浏览器跨域限制');}}
function checkMini(json){const code=json.base_resp?.status_code;if(code!==undefined&&code!==0)throw Error('MiniMax 返回错误 '+code+'；请检查账户、模型与音色设置');}
export async function decodeMini(response,request,fetcher,signal){
 const raw=new TextDecoder().decode(await limitedBytes(response));let chunks=[],last;
 if(request.body.stream){for(const event of raw.split(/\r?\n\r?\n/)){const data=event.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');if(!data||data==='[DONE]')continue;let item;try{item=JSON.parse(data);}catch{throw Error('MiniMax 流式响应不完整');}checkMini(item);last=item;if(item.data?.audio){const bytes=hexBytes(item.data.audio);if(item.data.status===2&&!request.body.stream_options?.exclude_aggregated_audio)chunks=[bytes];else chunks.push(bytes);}}if(last?.data?.status!==2)throw Error('MiniMax 音频流未完整结束');}
 else{let json;try{json=JSON.parse(raw);}catch{throw Error('MiniMax 返回了无效响应');}checkMini(json);if(request.body.output_format==='url'){let url;try{url=new URL(json.data?.audio);}catch{throw Error('MiniMax 未返回音频地址');}if(url.protocol!=='https:')throw Error('音频下载地址必须使用 HTTPS');const downloaded=await fetchWithPolicy(fetcher,url.href,{},signal);if(!downloaded.ok)throw Error('音频下载失败：HTTP '+downloaded.status);return audioBlob(await limitedBytes(downloaded),request);}chunks=[hexBytes(json.data?.audio)];}
 const bytes=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}return audioBlob(bytes,request);
}
// What a failed request means, from the error code the service sends back (ElevenLabs: detail.code / detail.status).
const REASONS={
 detected_unusual_activity:'免费账户被判定为异常使用（最常见的原因是开着 VPN 或代理），ElevenLabs 停用了这个账户的免费 API。换一个网络环境再试，或者升级到付费档。',
 missing_permissions:'这把密钥没有开对应的权限：试听要「文字转语音」，读取音色列表要「音色」读取，查额度要「用户」读取。在 ElevenLabs 的 API Keys 页面编辑这把密钥的权限，或者新建一把不限权限的密钥。',
 insufficient_permissions:'这把密钥没有开对应的权限：试听要「文字转语音」，读取音色列表要「音色」读取，查额度要「用户」读取。在 ElevenLabs 的 API Keys 页面编辑这把密钥的权限，或者新建一把不限权限的密钥。',
 invalid_api_key:'密钥无效。请重新完整复制密钥，注意不要带空格。',
 missing_api_key:'没有带上密钥，请在引擎卡片里重新保存密钥。',
 paid_plan_required:'免费账户不能通过 API 使用音色库（Voice Library）里的音色。换成「我的音色」里自己的或默认的音色，或者升级到付费档。',
 payment_required:'这个功能或音色需要付费档。免费账户不能通过 API 使用音色库里的音色，换成自己的或默认的音色试试。',
 subscription_required:'这个功能需要付费档。',
 feature_not_available:'当前档位不能用这个功能。',
 voice_access_denied:'这个账户没有这个音色的使用权限，换一个音色试试。',
 model_access_denied:'这个账户不能用这个模型，换一个模型试试。',
 unsupported_model:'这个模型不支持请求里的某个模型或设置，看括号里的说明。',
 quota_exceeded:'额度用完了。',
 insufficient_credits:'额度用完了。',
 voice_not_found:'找不到这个音色 ID，可能已经删除或者填错了。',
 invalid_voice_id:'音色 ID 格式不对，请重新选择音色。',
 invalid_voice_settings:'音色设置里有这个模型不接受的数值。eleven_v3 的稳定性只能是 0、0.5 或 1。',
 text_too_long:'这句台词太长了。',
 max_character_limit_exceeded:'这句台词太长了。',
 rate_limit_exceeded:'请求太频繁，稍等一会儿再试。',
 concurrent_limit_exceeded:'同时生成的太多了，等前面的生成完再试。',
 too_many_concurrent_requests:'同时生成的太多了，等前面的生成完再试。',
 system_busy:'服务正忙，稍后再试。'
};
const FALLBACK={400:'请求里有服务不接受的内容',401:'密钥没有通过验证。请回官网重新复制密钥，粘贴后点「保存密钥」；卡片上显示已保存密钥的末尾 4 位，可以和官网的对一下',402:'需要付费档或额度不足',403:'这个账户没有权限',404:'找不到这个音色或模型',422:'请求里有服务不接受的内容',429:'请求太频繁或额度不足，稍后再试'};
/**
 * An Error that says what the service reported: our explanation of its code, then its own code and message.
 * The service's text never shows a key: `secrets` and anything shaped like a key are replaced with ***.
 */
export async function httpError(engine,response,what='',secrets=[]){
 let detail={};
 try{const text=(await response.text()).slice(0,4000);try{const json=JSON.parse(text);const d=json.detail??json.error??json;detail=typeof d==='string'?{message:d}:Array.isArray(d)?{message:d.map(x=>x.msg||x.message).filter(Boolean).join('；')}:d||{};if(!detail.message&&json.message)detail.message=json.message;}catch{detail={message:text.trim()};}}catch{}
 const code=[detail.code,detail.status].find(x=>typeof x==='string'&&REASONS[x])||(typeof detail.code==='string'?detail.code:typeof detail.status==='string'?detail.status:'');
 // 「Providing X is not supported with the 'M' model」names the field: say that plainly.
 const refused=typeof detail.message==='string'&&detail.message.match(/Providing (\S+) is not supported with the '([^']+)' model/);
 const reason=refused?`${refused[2]} 不接受 ${refused[1]} 这一项设置`:REASONS[code]||FALLBACK[response.status]||'请求失败';
 const hide=text=>secrets.filter(k=>typeof k==='string'&&k.length>=4).reduce((t,k)=>t.split(k).join('***'),String(text)).replace(/[A-Za-z0-9_-]{24,}/g,t=>/\d/.test(t)&&/[A-Za-z]/.test(t)?'***':t);
 const said=hide([code,typeof detail.message==='string'?detail.message.slice(0,200):'',detail.param?'参数 '+detail.param:''].filter(Boolean).join('：'));
 return Object.assign(Error(names[engine]+(what?' '+what:'')+'：HTTP '+response.status+' · '+reason+(said?'（'+said+'）':'')),{status:response.status,code,refusedField:refused?.[1]||''});
}
export class Providers{
 // refused: fields a model said it does not take (model -> Set), left out of later requests while the page is open.
 constructor(fetcher=globalThis.fetch.bind(globalThis)){this.fetcher=fetcher;this.keys=new Map();this.references=new Map();this.refused=new Map();}
 setKey(engine,key){key=validateKey(engine,key);if(key)this.keys.set(engine,key);else this.keys.delete(engine);}
 headers(engine){const key=this.keys.get(engine);if(!key)throw Error('请先填写 '+names[engine]+' 的 API Key');return engine==='eleven'?{'xi-api-key':key}:{Authorization:'Bearer '+key};}
 async fetch(url,init,signal){return fetchWithPolicy(this.fetcher,url,init,signal);}
 /**
  * One synthesis request. When ElevenLabs answers 400 「Providing X is not supported with the 'M' model」 for a field
  * we sent, that field is dropped and the request is sent once more; the model is remembered so later lines skip it.
  */
 async synthesize(request,signal){
  const model=request.body?.model_id,body={...request.body};
  for(const field of this.refused.get(model)||[])delete body[field];
  let response=await this.post(request,body,signal);
  if(!response.ok){
   const error=await httpError(request.engine,response,'',[this.keys.get(request.engine)]);
   const field=error.refusedField;
   if(request.engine!=='eleven'||response.status!==400||!field||!Object.hasOwn(body,field)||field==='text'||field==='model_id')throw error;
   if(!this.refused.has(model))this.refused.set(model,new Set());
   this.refused.get(model).add(field);
   delete body[field];
   response=await this.post(request,body,signal);
   if(!response.ok)throw await httpError(request.engine,response,'',[this.keys.get(request.engine)]);
  }
  // A new audio was paid for: the balance shown on the engine card is out of date.
  try{this.onSpend?.(request.engine);}catch{}
  if(request.engine==='mini')return decodeMini(response,request,this.fetcher,signal);if(response.headers.get('Content-Type')?.includes('json'))throw Error(names[request.engine]+' 未返回音频');return audioBlob(await limitedBytes(response),request);}
 post(request,body,signal){return this.fetch(request.url,{method:'POST',headers:{...this.headers(request.engine),'Content-Type':'application/json'},body:JSON.stringify(body)},signal);}
 async voices(engine,c,{search='',page=0,token=''}={}){const headers=this.headers(engine);let url,init={headers};if(engine==='fish'){url=new URL('https://api.fish.audio/model');url.searchParams.set('page_size','50');url.searchParams.set('page_number',String(page+1));if(search)url.searchParams.set('title',search);}else if(engine==='mini'){url=miniBase(c)+'/v1/get_voice';init={method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({voice_type:'all'})};}else{url=new URL('https://api.elevenlabs.io/v2/voices');url.searchParams.set('page_size','100');if(search)url.searchParams.set('search',search);if(token)url.searchParams.set('next_page_token',token);}
 const response=await this.fetch(String(url),init);if(!response.ok)throw await httpError(engine,response,'音色读取失败',[this.keys.get(engine)]);const data=await response.json();if(engine==='mini')checkMini(data);const source=engine==='fish'?data.items:engine==='mini'?[...(data.system_voice||[]),...(data.voice_cloning||[]),...(data.voice_generation||[])]:data.voices;if(!Array.isArray(source))throw Error('音色列表格式不符');return {voices:source.map(v=>({id:v._id||v.voice_id,name:v.title||v.voice_name||v.name||v.voice_id})).filter(v=>typeof v.id==='string'),more:engine==='fish'?source.length===50:!!data.has_more,token:data.next_page_token||'',note:engine==='fish'?'已读取公开音色；此结果不能确认密钥有效':'音色列表已读取'};}
 /**
  * What is left on the account. ElevenLabs: {kind:'characters', used, limit, left, resetAt, tier, status} from
  * /v1/user/subscription (credits of the current period). Fish: {kind:'credit', credit, free} from /wallet/self/api-credit.
  */
 async balance(engine){
  if(!['eleven','fish'].includes(engine))throw Error('这家引擎没有提供余额查询');
  const headers=this.headers(engine),key=this.keys.get(engine);
  if(engine==='eleven'){
   const response=await this.fetch('https://api.elevenlabs.io/v1/user/subscription',{headers});
   if(!response.ok)throw await httpError(engine,response,'额度读取失败',[key]);
   const d=await response.json(),used=Number(d.character_count)||0,limit=Number(d.character_limit)||0;
   return {engine,kind:'characters',used,limit,left:Math.max(0,limit-used),resetAt:Number(d.next_character_count_reset_unix)>0?Number(d.next_character_count_reset_unix)*1000:null,tier:String(d.tier||''),status:String(d.status||'')};
  }
  if(engine==='fish'){
   const response=await this.fetch('https://api.fish.audio/wallet/self/api-credit?check_free_credit=true',{headers});
   if(!response.ok)throw await httpError(engine,response,'余额读取失败',[key]);
   const d=await response.json(),credit=Number(d.credit);
   if(!Number.isFinite(credit))throw Error('Fish Audio 返回的余额格式不符');
   return {engine,kind:'credit',credit,free:d.has_free_credit===true};
  }
 }
 clear(){this.keys.clear();this.references.clear();this.refused.clear();}
}
