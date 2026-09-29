import {icon} from './icons.js';
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const engines={fish:'Fish Audio',mini:'MiniMax',eleven:'ElevenLabs'};
export const languages=[['','跟随默认'],['zh','中文'],['en','英语'],['ja','日语'],['ko','韩语'],['fr','法语'],['de','德语'],['es','西班牙语'],['ru','俄语'],['it','意大利语'],['pt','葡萄牙语'],['ar','阿拉伯语'],['hi','印地语'],['th','泰语'],['vi','越南语']];
export const btn=(action,text,style='secondary',attrs='')=>`<button type="button" class="${style}" data-action="${action}" ${attrs}>${text}</button>`;
export const help=text=>`<button type="button" class="info" data-help="${esc(text)}" aria-label="查看说明">i</button>`;
export const field=(label,control,info='')=>`<div class="field"><span>${esc(label)}${info?help(info):''}</span>${control.replace(/aria-label="[^"]*"/, 'aria-label="'+esc(label)+'"')}</div>`;
export const input=(key,value='',type='text',attrs='')=>`<input data-field="${esc(key)}" aria-label="${esc(key)}" type="${type}" value="${esc(value)}" ${attrs}>`;
export const select=(key,value,choices,attrs='')=>`<select data-field="${esc(key)}" aria-label="${esc(key)}" ${attrs}>${choices.map(([v,t,disabled])=>`<option value="${esc(v)}" ${String(value)===String(v)?'selected':''} ${disabled?'disabled':''}>${esc(t)}</option>`).join('')}</select>`;
export const textArea=(key,value,attrs='')=>`<textarea data-field="${esc(key)}" aria-label="${esc(key)}" rows="5" ${attrs}>${esc(value)}</textarea>`;
export const toggle=(key,label,value,info='')=>`<div class="setting-row"><span>${esc(label)}${info?help(info):''}</span><input class="switch" aria-label="${esc(label)}" type="checkbox" data-field="${esc(key)}" ${value?'checked':''}></div>`;
export const empty=(title,detail='')=>`<div class="empty">${icon('music')}<h2>${esc(title)}</h2>${detail?`<p>${esc(detail)}</p>`:''}</div>`;
export const heading=(title,action='')=>`<div class="page-heading"><h1>${esc(title)}</h1>${action}</div>`;
export const size=bytes=>bytes<1024*1024?Math.round(bytes/1024)+' KB':(bytes/1024/1024).toFixed(1)+' MB';
export function createView(ctx,name){
 const root=ctx.doc.createElement('section');root.className='view';root.dataset.app=name;
 const controller=new ctx.win.AbortController();let disposed=false;
 const view={root,back:null,refresh(){},dispose(){disposed=true;controller.abort();},get disposed(){return disposed;},
  draw(html){const y=root.scrollTop;const opened=[...root.querySelectorAll('details[open]')].map(el=>el.dataset.group);root.innerHTML=html;for(const el of root.querySelectorAll('details'))if(opened.includes(el.dataset.group))el.open=true;root.scrollTop=y;},
  on(type,selector,fn){root.addEventListener(type,event=>{const el=event.target.closest(selector);if(!el||!root.contains(el))return;if(type==='click')event.preventDefault();try{const result=fn(el,event);if(result?.catch)result.catch(error=>ctx.notify(error.message));}catch(error){ctx.notify(error.message);}},{signal:controller.signal});},
  async busy(el,task){if(el.disabled)return;el.disabled=true;try{return await task();}finally{if(el.isConnected)el.disabled=false;}},
 };
 view.on('click','[data-help]',el=>ctx.help(el.dataset.help));
 return view;
}
export function languageField(key,value,inherit=true){return field('台词语言',input(key,value,'text',`list="tts-languages" placeholder="${inherit?'留空跟随默认':'例如 zh、en、ja'}"`),'可填写语言代码或语言名称；角色留空时使用默认台词语言。');}
export const languageOptions=()=>`<datalist id="tts-languages">${languages.filter(([v])=>v).map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</datalist>`;