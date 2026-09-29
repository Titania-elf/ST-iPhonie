import {createView,esc,engines,btn,field,input,select,heading,empty,languageField,languageOptions} from './common.js';
import {icon} from './icons.js';
export function rolesApp(ctx){
 const {api}=ctx,v=createView(ctx,'roles'),drafts=new Map();let current=null;
 const changed=()=>{const el=v.root.querySelector('[data-save-state]');if(el)el.textContent='未保存';};
 function render(){
  if(!current){const roles=api.getState().routes;v.draw(heading('角色',btn('add-role',icon('add'),'text-button','aria-label="新增角色"'))+(roles.length?'<div class="group">'+roles.map(r=>`<button class="list-row" data-action="edit-role" data-id="${esc(r.id)}"><i class="avatar">${esc(r.name.slice(0,1))}</i><span><strong>${esc(r.name)}</strong><small>${engines[r.engine]} · ${esc(r.voice||'待选择音色')}</small></span><i class="engine-dot" data-engine="${r.engine}"></i></button>`).join('')+'</div>':empty('为角色选一个声音','新增说话者，或点击聊天里的声波。')));return;}
  const r=current,c=api.getState().connections[r.engine],schema=api.engineSchema(r.engine),pending=api.pendingRole()===r.name;
  v.draw(heading(r.id?'角色配音':'新增角色')+`<div class="group pad">${field('角色名称',input('name',r.name,'text','placeholder="与台词里的说话者一致"'))}<div class="segmented">${Object.entries(engines).map(([k,label])=>`<button data-action="route-engine" data-engine="${k}" aria-pressed="${r.engine===k}">${label}</button>`).join('')}</div>${field('音色 ID',input('voice',r.voice,'text','placeholder="粘贴音色 ID 或从列表选择"'))}${btn('pick-voice','选择音色','secondary')}${field('模型',select('model',r.model||'',[['','跟随引擎 · '+c.model],...schema.models.map(m=>[m.id,m.id,!m.supported])]))}${languageField('language',r.language||'')}${languageOptions()}</div><div class="savebar"><span class="save-state" data-save-state>草稿</span>${btn('audition','试听','secondary')}${btn('save-role','保存','primary')}</div>${pending?btn('continue-role','保存并继续朗读','primary'):''}${r.id?`<div class="actions">${btn('delete-role','删除角色配音','danger')}</div>`:''}`);
 }
 function edit(id){const saved=api.getState().routes.find(r=>r.id===id);if(!saved){ctx.notify('角色已不存在');return;}current=drafts.get(id)||structuredClone(saved);drafts.set(id,current);render();}
 v.edit=edit;v.back=()=>{if(!current)return false;current=null;render();return true;};v.refresh=()=>{if(!current)render();};
 v.on('input','[data-field]',el=>{if(!current)return;current[el.dataset.field]=el.value;changed();});
 v.on('change','select[data-field]',el=>{current[el.dataset.field]=el.value;changed();});
 v.on('click','[data-action]',async el=>{
  switch(el.dataset.action){
   case 'add-role':current=drafts.get('new')||{name:'',engine:'fish',voice:'',model:'',language:'',bindings:{}};drafts.set('new',current);render();break;
   case 'edit-role':edit(el.dataset.id);break;
   case 'route-engine':current=api.switchRouteEngine(current,el.dataset.engine);drafts.set(current.id||'new',current);render();changed();break;
   case 'save-role':case 'continue-role':{const previous=current.id||'new';current=api.saveRoute(current);drafts.delete(previous);drafts.set(current.id,current);render();v.root.querySelector('[data-save-state]').textContent='已保存';ctx.notify('角色配音已保存');if(el.dataset.action==='continue-role')api.resume();break;}
   case 'audition':api.audition(current);break;
   case 'delete-role':if(await ctx.confirm('删除角色配音？','其他角色的音色和预设会保留。')){api.deleteRoute(current.id);drafts.delete(current.id);current=null;render();}break;
   case 'pick-voice':pickVoice();break;
  }
 });
 function pickVoice(){
  const target=current,engine=target.engine,connection=api.getState().connections[engine];let page=0,token='',search='',epoch=0;
  const dialog=ctx.dialog('选择音色',`<div class="field"><input class="search" type="search" placeholder="搜索音色" aria-label="搜索音色"></div><div class="actions">${btn('search','搜索')}</div><div data-voices></div>`);
  const load=async more=>{const ticket=++epoch;if(!more){page=0;token='';}const list=dialog.body.querySelector('[data-voices]');if(!more)list.textContent='正在读取…';try{const result=await api.voices(engine,connection,{search,page,token});if(!dialog.live||ticket!==epoch)return;const rows=engine==='mini'&&search?result.voices.filter(x=>x.name.toLowerCase().includes(search.toLowerCase())||x.id.includes(search)):result.voices;const html=rows.map(r=>`<button class="list-row" data-voice="${esc(r.id)}"><span><strong>${esc(r.name)}</strong><small>${esc(r.id)}</small></span>${icon('next')}</button>`).join('');if(!more)list.innerHTML=html||'<p class="muted">没有找到音色，可以直接填写音色 ID。</p>';else{list.querySelector('[data-more]')?.remove();list.insertAdjacentHTML('beforeend',html);}if(result.more)list.insertAdjacentHTML('beforeend','<button class="text-button" data-more>加载更多</button>');token=result.token;page++;}catch(error){if(dialog.live&&ticket===epoch)list.textContent=error.message;}};
  dialog.body.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.voice){target.voice=b.dataset.voice;dialog.close();if(current===target){render();changed();}}else if(b.hasAttribute('data-more')){b.disabled=true;load(true);}else if(b.dataset.action==='search'){search=dialog.body.querySelector('input').value.trim();load(false);}});
  load(false);
 }
 render();return v;
}