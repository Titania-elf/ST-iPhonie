import {createView,esc,btn,field,input,select,textArea,toggle,heading,help} from './common.js';
import {icon} from './icons.js';
const positions=[['in_chat','聊天内'],['before_prompt','主提示词之前'],['in_prompt','主提示词之后']],roles=[['system','系统'],['user','用户'],['assistant','助手']];
export function presetsApp(ctx){
 const {api}=ctx,v=createView(ctx,'presets'),drafts=new Map();let current=null;
 const mark=()=>{const el=v.root.querySelector('[data-save-state]');if(el)el.textContent='未保存';};
 function injection(i,index='preset'){
  const attrs=`data-injection-owner="${index}"`;
  return field('插入位置',select('position',i.position,positions,attrs))+field('深度',input('depth',i.depth,'number',`${attrs} min="0" max="10000" step="1" ${i.position!=='in_chat'?'disabled':''}`))+field('身份',select('role',i.role,roles,`${attrs} ${i.position!=='in_chat'?'disabled':''}`));
 }
 function render(){
  if(!current){const s=api.getState();v.draw(heading('提示预设',btn('add-preset',icon('add'),'text-button','aria-label="新增预设"'))+'<div class="group">'+s.presets.map(p=>`<button class="list-row" data-action="edit-preset" data-id="${esc(p.id)}"><span><strong>${esc(p.name||'未命名预设')}</strong><small>${p.entries.length} 条规则${p.id===s.activePreset?' · 正在使用':''}</small></span>${icon('next')}</button>`).join('')+'</div>');return;}
  const p=current,s=api.getState();
  v.draw(heading('编辑预设')+`<div class="group pad">${field('名称',input('name',p.name))}${field('台词格式',textArea('format',p.format,'class="code"'),'{译文}、{角色}、{情绪}、{文本} 各保留一次。译文供阅读，原语言供语音生成。')}<details data-group="preset-injection"><summary>默认插入设置 ${help('深度与身份仅在聊天内插入时生效；条目可以单独覆盖。')}</summary><div>${injection(p.injection)}</div></details></div><div class="row-heading"><h2>提示词条目</h2>${btn('add-entry','增加条目','text-button')}</div>${p.entries.map((e,i)=>`<details data-group="entry:${esc(e.id)}" ${i===0?'open':''}><summary>${esc(e.title||'未命名条目')}${e.enabled?'':' · 已停用'}</summary><div data-entry="${i}">${toggle('enabled','启用此条目',e.enabled)}${field('条目名称',input('title',e.title))}${field('提示词',textArea('text',e.text,'class="code"'),'启用规则的合计文字需包含 {{格式}} 和 {{语言}}。')}${toggle('customInjection','单独设置插入位置',!!e.injection)}${e.injection?injection(e.injection,i):''}<div class="actions">${btn('entry-up','上移','text-button',`data-index="${i}" ${i===0?'disabled':''}`)}${btn('entry-down','下移','text-button',`data-index="${i}" ${i===p.entries.length-1?'disabled':''}`)}${btn('delete-entry','删除','text-button',`data-index="${i}"`)}</div></div></details>`).join('')}<div class="actions">${btn('prompt-preview','发送预览')}${p.id?btn('use-preset',p.id===s.activePreset?'正在使用':'保存并使用','secondary',p.id===s.activePreset?'disabled':''):''}</div><div class="savebar"><span class="save-state" data-save-state>草稿</span>${btn('save-preset','保存预设','primary')}</div>${p.id?`<div class="actions">${btn('delete-preset','删除预设','danger')}</div>`:''}`);
 }
 function edit(id){current=drafts.get(id)||structuredClone(api.getState().presets.find(p=>p.id===id));if(!current)return;drafts.set(id,current);render();}
 v.back=()=>{if(!current)return false;current=null;render();return true;};v.refresh=()=>{if(!current)render();};
 function update(el,redraw){const key=el.dataset.field,index=el.closest('[data-entry]')?.dataset.entry;
  if(el.dataset.injectionOwner!==undefined){const owner=el.dataset.injectionOwner==='preset'?current:current.entries[Number(el.dataset.injectionOwner)];owner.injection[key]=key==='depth'?Number(el.value):el.value;}
  else if(index!==undefined){const entry=current.entries[Number(index)];if(key==='customInjection'){if(el.checked)entry.injection=structuredClone(current.injection);else delete entry.injection;}else entry[key]=el.type==='checkbox'?el.checked:el.value;}
  else current[key]=el.value;
  mark();if(redraw)render();
 }
 v.on('input','[data-field]',el=>{if(el.type!=='checkbox'&&el.tagName!=='SELECT')update(el,false);});
 v.on('change','[data-field]',el=>{if(el.type==='checkbox'||el.tagName==='SELECT')update(el,true);});
 function save(){const id=current.id||'new';current=api.savePreset(current);drafts.delete(id);drafts.set(current.id,current);render();v.root.querySelector('[data-save-state]').textContent='已保存';ctx.notify('预设已保存');}
 v.on('click','[data-action]',async el=>{
  const index=Number(el.dataset.index);
  switch(el.dataset.action){
   case 'add-preset':current=drafts.get('new')||{name:'新预设',format:api.defaultFormat,injection:{position:'in_chat',depth:0,role:'system'},entries:[{id:crypto.randomUUID(),title:'台词生成规则',text:api.defaultPrompt,enabled:true}]};drafts.set('new',current);render();break;
   case 'edit-preset':edit(el.dataset.id);break;
   case 'save-preset':save();break;
   case 'use-preset':save();api.selectPreset(current.id);render();break;
   case 'add-entry':current.entries.push({id:crypto.randomUUID(),title:'新条目',enabled:true,text:''});render();v.root.querySelector('details:last-of-type').open=true;mark();break;
   case 'delete-entry':if(await ctx.confirm('删除这条规则？','保存预设后生效。')){current.entries.splice(index,1);render();mark();}break;
   case 'entry-up':case 'entry-down':{const to=index+(el.dataset.action==='entry-up'?-1:1);if(to>=0&&to<current.entries.length){[current.entries[index],current.entries[to]]=[current.entries[to],current.entries[index]];render();mark();}break;}
   case 'delete-preset':if(await ctx.confirm('删除这个预设？','角色配音不会被删除。')){api.deletePreset(current.id);drafts.delete(current.id);current=null;render();}break;
   case 'prompt-preview':{const error=api.validatePreset(current);if(error)throw Error(error);ctx.dialog('发送预览',`<pre class="code-preview">${esc(api.previewPrompt({...current,id:current.id||'preview'}))}</pre>`);break;}
  }
 });
 render();return v;
}