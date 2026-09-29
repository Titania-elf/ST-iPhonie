import {createView,esc,engines,btn,field,input,select,heading,help} from './common.js';
import {icon} from './icons.js';
export function enginesApp(ctx){
 const {api}=ctx,v=createView(ctx,'engines'),drafts=new Map();let engine=null,dirty=false;
 const draft=()=>drafts.get(engine);
 const changed=()=>{dirty=true;const e=v.root.querySelector('[data-save-state]');if(e)e.textContent='未保存';};
 function control(f,c,rowIndex=null,parent=null){
  const value=rowIndex===null?c.params[f.key]:c.params[parent.key][rowIndex][f.key];
  const reason=parent?.unavailable||f.unavailable||'',attrs=`data-param="${esc(parent?.key||f.key)}" ${rowIndex!==null?`data-row="${rowIndex}" data-column="${esc(f.key)}"`:''} aria-label="${esc(f.label)}" ${reason?'disabled':''}`;
  const note=[f.help,reason,'官方字段：'+(parent?parent.key+'.':'')+f.key].filter(Boolean).join('\n');
  if(f.type==='rows')return `<div class="parameter-field" aria-disabled="${!!reason}"><div class="row-heading"><span>${esc(f.label)}${help(note)}</span>${btn('add-row','增加','text-button',`data-param-key="${esc(f.key)}" ${reason||value.length>=f.max?'disabled':''}`)}</div>${value.map((row,i)=>`<div class="parameter-row">${f.columns.map(col=>control(col,c,i,f)).join('')}${btn('remove-row','删除条目','text-button',`data-param-key="${esc(f.key)}" data-index="${i}" ${reason?'disabled':''}`)}</div>`).join('')}</div>`;
  if(f.type==='boolean')return `<div class="setting-row"><span>${esc(f.label)}${help(note)}</span><input type="checkbox" class="switch" ${attrs} ${value?'checked':''}></div>`;
  let html;
  if(f.type==='select')html=`<select ${attrs}>${f.options.map(([valueOption,label])=>`<option value="${esc(valueOption)}" ${value===valueOption?'selected':''}>${esc(label)}</option>`).join('')}</select>`;
  else if(f.type==='file')html=`<input type="file" accept="audio/*,.wav,.mp3,.flac,.m4a,.ogg,.opus" ${attrs}>${value?`<small>已选参考音频</small>`:''}`;
  else if(['textarea','lines'].includes(f.type))html=`<textarea rows="4" ${attrs}>${esc(value)}</textarea>`;
  else html=`<input type="${f.type==='number'?'number':'text'}" ${attrs} value="${esc(value)}" ${f.min!==undefined?`min="${f.min}"`:''} ${f.max!==undefined?`max="${f.max}"`:''} ${f.step!==undefined?`step="${f.step}"`:''}>`;
  return field(f.label,html,note);
 }
 function render(){
  if(!engine){v.draw(heading('语音引擎')+'<div class="group">'+Object.entries(engines).map(([id,name])=>`<button class="list-row" data-action="engine" data-engine="${id}"><i class="engine-dot" data-engine="${id}"></i><span><strong>${name}</strong><small>${esc(api.getState().connections[id].model)} · ${api.keyStatus(id)?'已保存密钥':'待填写密钥'}</small></span>${icon('next')}</button>`).join('')+'</div>');return;}
  const schema=api.engineSchema(engine,draft());drafts.set(engine,schema.connection);const c=draft();
  v.root.style.setProperty('--accent',`var(--${engine})`);
  v.draw(heading(engines[engine])+`<div class="group pad">${field('模型',select('model',c.model,schema.models.map(m=>[m.id,m.id,!m.supported])),schema.models.filter(m=>!m.supported).map(m=>m.id+'：'+m.reason).join('\n')||'角色未指定模型时使用此处选择。')}${engine==='mini'?field('服务区域',select('region',c.region,[['cn','国内'],['global','国际'],['uw','国际 · 低延迟入口']])):''}${field('API Key',input('key','','password',`autocomplete="off" placeholder="${api.keyStatus(engine)?'已保存在此浏览器':'填写此引擎密钥'}"`),'密钥仅保存在当前浏览器和酒馆地址，按账户分别保存。已填写不表示鉴权成功。')}<div class="actions">${btn('save-key','保存密钥')}${btn('reveal-key','显示')}${btn('clear-key','清除','text-button')}</div>${btn('read-voices','读取音色','secondary')}<p class="muted" data-connection-status></p></div>${schema.groups.map((g,i)=>`<details data-group="${engine}:${g.id}" ${i===0?'open':''}><summary>${esc(g.title)}</summary><div>${g.fields.map(f=>control(f,c)).join('')}</div></details>`).join('')}<details data-group="tags"><summary>情绪与语气</summary><div><div class="tags">${schema.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>${engine==='mini'&&c.model.startsWith('speech-2.8')?'<div class="tags">'+['laughs','chuckle','coughs','clear-throat','groans','breath','pant','inhale','exhale','gasps','sniffs','sighs','snorts','burps','lip-smacking','humming','hissing','emm','sneezes'].map(x=>`<span class="tag">(${x})</span>`).join('')+'</div>':''}<a href="${esc(schema.source)}" target="_blank" rel="noopener noreferrer">查看官方文档</a></div></details>${engine==='fish'?btn('references','管理参考音频','secondary'):''}<div class="actions">${btn('request-preview','请求预览','text-button')}</div><div class="savebar"><span class="save-state" data-save-state>${dirty?'未保存':'已保存'}</span>${btn('save-connection','保存配置','primary')}</div>`);
 }
 function edit(id){engine=id;if(!drafts.has(id))drafts.set(id,structuredClone(api.getState().connections[id]));dirty=JSON.stringify(draft())!==JSON.stringify(api.getState().connections[id]);render();}
 v.back=()=>{if(!engine)return false;engine=null;v.root.style.removeProperty('--accent');render();return true;};v.refresh=()=>{if(!engine)render();};
 v.on('change','[data-field]',el=>{if(el.dataset.field==='key')return;draft()[el.dataset.field]=el.value;changed();render();});
 const readValue=(el,f)=>f.type==='boolean'?el.checked:f.type==='number'?(el.value===''?'':Number(el.value)):f.type==='select'?f.options.find(([key])=>String(key)===el.value)?.[0]:el.value;
 async function updateParam(el,redraw){
  const c=draft(),schema=api.engineSchema(engine,c),f=schema.groups.flatMap(g=>g.fields).find(x=>x.key===el.dataset.param);if(!f)return;
  if(el.dataset.row!==undefined){const row=c.params[f.key][Number(el.dataset.row)],col=f.columns.find(x=>x.key===el.dataset.column);if(!row)return;if(col.type==='file'){const file=el.files?.[0];if(!file)return;el.disabled=true;try{const id=await api.reference(file);if(c.params[f.key].includes(row)){row[col.key]=id;if(draft()===c){changed();render();}}}finally{if(el.isConnected)el.disabled=false;}return;}row[col.key]=readValue(el,col);}
  else c.params[f.key]=readValue(el,f);
  changed();if(redraw&&['select','boolean'].includes(f.type))render();
 }
 v.on('input','[data-param]',el=>{if(!['checkbox','file'].includes(el.type)&&el.tagName!=='SELECT')return updateParam(el,false);});
 v.on('change','[data-param]',el=>updateParam(el,true));
 v.on('click','[data-action]',async el=>{
  switch(el.dataset.action){
   case 'engine':edit(el.dataset.engine);break;
   case 'save-connection':api.saveConnection(engine,draft());dirty=false;render();ctx.notify('引擎配置已保存');break;
   case 'save-key':api.setKey(engine,v.root.querySelector('[data-field=key]').value);render();ctx.notify('密钥已保存');break;
   case 'clear-key':if(await ctx.confirm('清除密钥？','之后使用这个引擎需要重新填写。')){api.clearKey(engine);render();}break;
   case 'reveal-key':{const input=v.root.querySelector('[data-field=key]');input.type=input.type==='password'?'text':'password';el.textContent=input.type==='password'?'显示':'隐藏';break;}
   case 'read-voices':{const current=engine;await v.busy(el,async()=>{const r=await api.voices(current,draft());if(current===engine){const status=v.root.querySelector('[data-connection-status]');if(status)status.textContent=r.note+' · '+r.voices.length+' 个';}});break;}
   case 'add-row':{const f=api.engineSchema(engine,draft()).groups.flatMap(g=>g.fields).find(x=>x.key===el.dataset.paramKey);if(draft().params[f.key].length<f.max)draft().params[f.key].push(Object.fromEntries(f.columns.map(c=>[c.key,c.value??(c.type==='boolean'?false:c.type==='number'?c.min??0:'')])));changed();render();break;}
   case 'remove-row':draft().params[el.dataset.paramKey].splice(Number(el.dataset.index),1);changed();render();break;
   case 'request-preview':{const state=api.getState(),r=state.routes.find(r=>r.engine===engine)||{name:'预览角色',voice:'voice-id',engine,language:state.general.defaultLanguage};const request=api.previewRequest(engine,draft(),{...r,model:''},{role:r.name,emotion:'calm',text:'雨还没停，再坐一会儿吧。',translation:'雨还没停，再坐一会儿吧。'});ctx.dialog('请求预览',`<pre class="code-preview">${esc(JSON.stringify(request,null,2))}</pre>`);break;}
   case 'references':await manageReferences();break;
  }
 });
 async function manageReferences(){
  const d=ctx.dialog('参考音频','<p>正在读取…</p>');
  const refresh=async()=>{const rows=await api.listReferences();if(!d.live)return;d.body.innerHTML=rows.length?rows.map(r=>`<div class="list-row"><span><strong>${esc(r.name)}</strong><small>${Math.round(r.size/1024)} KB</small></span><button class="text-button" data-delete-reference="${esc(r.id)}">删除</button></div>`).join(''):'<p class="muted">还没有保存参考音频。</p>';};
  d.body.addEventListener('click',async e=>{const el=e.target.closest('[data-delete-reference]');if(!el)return;el.disabled=true;try{await api.deleteReference(el.dataset.deleteReference);for(const c of drafts.values())if(c.params.references)c.params.references=c.params.references.filter(r=>r.audio!==el.dataset.deleteReference);await refresh();}catch(error){ctx.notify(error.message);}finally{if(el.isConnected)el.disabled=false;}});await refresh();
 }
 render();return v;
}