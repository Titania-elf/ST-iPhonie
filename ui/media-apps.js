import {createView,esc,btn,heading,empty,size,field,input,textArea,select} from './common.js';
import {icon,wave} from './icons.js';
export function libraryApp(ctx){
 const {api}=ctx,v=createView(ctx,'library');let tab='favorites',role='',epoch=0;
 async function render(){const ticket=++epoch;const rows=tab==='favorites'?await api.listFavorites():await api.listAudio();if(v.disposed||ticket!==epoch)return;const roles=[...new Set(rows.map(r=>r.role||r.metadata?.line?.role).filter(Boolean))];
  v.draw(heading('音频收藏')+`<div class="segmented"><button data-action="tab" data-tab="favorites" aria-pressed="${tab==='favorites'}">收藏</button><button data-action="tab" data-tab="cache" aria-pressed="${tab==='cache'}">缓存</button></div>${field('说话者',select('role',role,[['','所有角色'],...roles.map(r=>[r,r])]))}`+(rows.length?'<div class="group">'+rows.filter(r=>!role||(r.role||r.metadata?.line?.role)===role).map(r=>{const line=r.metadata?.line||r;return `<div class="dialogue-row"><div><small>${esc(line.role||'早期缓存')} · ${size(r.size||r.bytes)}</small><p>${esc(line.translation||'已保存音频')}</p><div class="actions">${tab==='favorites'?btn('delete-favorite','删除','text-button',`data-id="${esc(r.id)}"`):btn('favorite-cache','收藏','text-button',`data-id="${esc(r.key)}"`)+btn('delete-cache','清理','text-button',`data-id="${esc(r.key)}"`)}</div></div>${tab==='favorites'?btn('play-favorite',wave,'wave-button',`data-id="${esc(r.id)}" aria-label="播放收藏"`):''}</div>`;}).join('')+'</div>':empty(tab==='favorites'?'把喜欢的对白留在这里':'还没有音频缓存',tab==='favorites'?'在听取中收藏已生成的音频。':'')));
 }
 v.refresh=render;
 v.on('change','[data-field=role]',el=>{role=el.value;return render();});
 v.on('click','[data-action]',async el=>{const id=el.dataset.id;
  switch(el.dataset.action){
   case 'tab':tab=el.dataset.tab;role='';await render();break;
   case 'play-favorite':await api.playFavorite(id);break;
   case 'favorite-cache':await v.busy(el,()=>api.favoriteAudio(id));ctx.notify('已加入收藏');break;
   case 'delete-cache':if(await ctx.confirm('清理这段缓存？')){await api.deleteAudio(id);await render();}break;
   case 'delete-favorite':if(await ctx.confirm('删除这段收藏？')){await api.deleteFavorite(id);await render();}break;
  }
 });render().catch(e=>ctx.notify(e.message));return v;
}
export function galleryApp(ctx){
 const {api}=ctx,v=createView(ctx,'gallery');let current=null,epoch=0;const urls=new Set();
 const clear=()=>{for(const url of urls)ctx.win.URL.revokeObjectURL(url);urls.clear();};
 const urlFor=blob=>{const url=ctx.win.URL.createObjectURL(blob);urls.add(url);return url;};
 async function render(){const ticket=++epoch;
  if(current){const photo=await api.getPhoto(current);if(v.disposed||ticket!==epoch)return;clear();if(!photo){current=null;return render();}v.draw(heading('照片')+`<img class="photo-full" src="${esc(urlFor(photo.blob))}" alt="${esc(photo.name)}"><p class="muted">${esc(photo.name)} · ${size(photo.size)}</p><div class="actions">${btn('wallpaper','设为壁纸','primary')}${btn('delete-photo','删除','danger')}</div>`);return;}
  const rows=await api.listPhotos();if(v.disposed||ticket!==epoch)return;clear();v.draw(heading('相册')+`<label class="secondary file-button">导入照片<input type="file" data-photo-files multiple accept="image/png,image/jpeg,image/webp,image/avif,image/gif" aria-label="导入照片"></label>`+(rows.length?`<div class="photo-grid">${rows.map(r=>`<button data-action="photo" data-id="${esc(r.id)}" aria-label="查看 ${esc(r.name)}"><img loading="lazy" data-photo="${esc(r.id)}" alt="${esc(r.name)}"></button>`).join('')}</div>`:empty('留住喜欢的画面','从本地导入，也可以设为手机壁纸。')));
  for(const row of rows){const photo=await api.getPhoto(row.id);if(v.disposed||ticket!==epoch)return;if(photo){const img=[...v.root.querySelectorAll('[data-photo]')].find(el=>el.dataset.photo===row.id);if(img)img.src=urlFor(photo.blob);}}
 }
 v.back=()=>{if(!current)return false;current=null;render().catch(e=>ctx.notify(e.message));return true;};v.refresh=render;
 const dispose=v.dispose;v.dispose=()=>{epoch++;clear();dispose();};
 v.on('change','[data-photo-files]',async el=>{el.disabled=true;try{for(const file of el.files||[])await api.addPhoto({name:file.name,blob:file});await render();ctx.notify('照片已保存');}finally{if(el.isConnected){el.value='';el.disabled=false;}}});
 v.on('click','[data-action]',async el=>{switch(el.dataset.action){case 'photo':current=el.dataset.id;await render();break;case 'wallpaper':await api.savePhone({wallpaper:{kind:'photo',photoId:current}});ctx.notify('已设为壁纸');break;case 'delete-photo':if(await ctx.confirm('删除这张照片？','使用它的壁纸和图标会恢复默认。')){await api.deletePhoto(current);current=null;await render();}break;}});
 render().catch(e=>ctx.notify(e.message));return v;
}
export function notesApp(ctx){
 const {api}=ctx,v=createView(ctx,'notes'),drafts=new Map();let current=null,epoch=0;
 async function render(){const ticket=++epoch;if(current){v.draw(heading(current.id?'备忘录':'新备忘录')+`<div class="group pad">${field('标题',input('title',current.title,'text','maxlength="200" placeholder="标题"'))}${field('正文',textArea('text',current.text,'rows="14" placeholder="写点什么…"'))}</div><div class="savebar"><span class="save-state" data-save-state>草稿</span>${btn('save-note','保存','primary')}</div>${current.id?`<div class="actions">${btn('delete-note','删除备忘录','danger')}</div>`:''}`);return;}
 const rows=await api.listNotes();if(v.disposed||ticket!==epoch)return;v.draw(heading('备忘录',btn('add-note',icon('add'),'text-button','aria-label="新增备忘录"'))+(rows.length?'<div class="group">'+rows.map(n=>`<button class="note-row" data-action="edit-note" data-id="${esc(n.id)}"><strong>${esc(n.title||'未命名')}</strong><small>${esc(n.text.slice(0,80)||'空白备忘录')}</small></button>`).join('')+'</div>':empty('随手记下这一刻')));}
 v.back=()=>{if(!current)return false;current=null;render().catch(e=>ctx.notify(e.message));return true;};v.refresh=()=>{if(!current)return render();};
 v.on('input','[data-field]',el=>{current[el.dataset.field]=el.value;const s=v.root.querySelector('[data-save-state]');if(s)s.textContent='未保存';});
 v.on('click','[data-action]',async el=>{switch(el.dataset.action){
 case 'add-note':current=drafts.get('new')||{title:'',text:''};drafts.set('new',current);await render();break;
 case 'edit-note':{const rows=await api.listNotes(),saved=rows.find(r=>r.id===el.dataset.id);if(!saved)return;current=drafts.get(saved.id)||saved;drafts.set(saved.id,current);await render();break;}
 case 'save-note':await v.busy(el,async()=>{const target=current,saved=await api.saveNote(target);drafts.delete(target.id||'new');drafts.set(saved.id,saved);if(current===target){current=saved;await render();v.root.querySelector('[data-save-state]').textContent='已保存';}ctx.notify('备忘录已保存');});break;
 case 'delete-note':if(await ctx.confirm('删除这条备忘录？')){await api.deleteNote(current.id);drafts.delete(current.id);current=null;await render();}break;
 }});render().catch(e=>ctx.notify(e.message));return v;
}
export function listenApp(ctx){
 const {api}=ctx,v=createView(ctx,'listen');let latest={id:-1,lines:[]},epoch=0,playbackRevision=0;
 const playerHTML=()=>`<div class="play-card">${wave}<div class="play-message" data-playback-message></div><p class="play-caption" data-playback-line></p><div class="actions">${btn('toggle','暂停 / 继续','secondary')}${btn('stop','停止','secondary')}${btn('favorite','收藏','secondary')}</div></div>`;
 async function render(){const ticket=++epoch;latest=api.latest();v.draw(heading('听见这一刻',btn('refresh', '刷新','text-button'))+playerHTML()+(latest.lines.length?`<div class="actions">${btn('play-all','整条播放','primary')}</div><div class="group">${latest.lines.map((l,i)=>`<div class="dialogue-row"><div><small>${esc(l.role)}</small><p>${esc(l.translation)}</p></div>${btn('play-line',wave,'wave-button',`data-index="${i}" data-state="ungenerated" aria-label="朗读 ${esc(l.role)} 的台词"`)}</div>`).join('')}</div>`:empty('等一句真正说出口的话','回到聊天后，点击台词旁的声波。')));v.onPlayback(api.status());for(let i=0;i<latest.lines.length;i++){const state=await api.lineState(latest.lines[i]);if(v.disposed||ticket!==epoch)return;const b=v.root.querySelector(`[data-index="${i}"]`);if(b)b.dataset.state=state;}}
 v.onPlayback=state=>{const revision=++playbackRevision;for(const b of v.root.querySelectorAll('[data-action=play-line]')){const line=latest.lines[Number(b.dataset.index)];if(!line)continue;const selected=state.source==='dialogue'&&state.line?.role===line.role&&state.line?.text===line.text&&(state.line.uiIndex===undefined||state.line.uiIndex===Number(b.dataset.index));if(selected&&['playing','paused','generating','waiting'].includes(state.phase))b.dataset.state=state.phase;else api.lineState(line).then(value=>{if(!v.disposed&&revision===playbackRevision&&b.isConnected)b.dataset.state=value;});}const m=v.root.querySelector('[data-playback-message]'),line=v.root.querySelector('[data-playback-line]');if(m)m.textContent=state.message||'等待播放';if(line)line.textContent=state.line?.translation||'';const toggle=v.root.querySelector('[data-action=toggle]');if(toggle){toggle.disabled=!['playing','paused','generating'].includes(state.phase);toggle.textContent=state.phase==='paused'?'继续':'暂停';}const star=v.root.querySelector('[data-action=favorite]');if(star)star.disabled=!api.latestAudio();const stop=v.root.querySelector('[data-action=stop]');if(stop)stop.disabled=state.phase==='idle';};
 v.refresh=render;
 function play(index){const now=api.latest();if(JSON.stringify(now)!==JSON.stringify(latest)){render().catch(e=>ctx.notify(e.message));ctx.notify('聊天内容已变化，请重新选择台词');return;}api.play(latest.id,index);}
 v.on('click','[data-action]',async el=>{switch(el.dataset.action){case 'refresh':await render();break;case 'play-all':play();break;case 'play-line':play(Number(el.dataset.index));break;case 'toggle':api.toggle();break;case 'stop':api.stop();break;case 'favorite':{const audio=api.latestAudio();if(!audio)throw Error('先生成一句台词再收藏');await v.busy(el,()=>api.favoriteAudio(audio.key));ctx.notify('已加入收藏');break;}}});render().catch(e=>ctx.notify(e.message));return v;
}