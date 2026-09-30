import { TTSBackend } from './core/backend.js';
import { normalizeSettings,validateSettings,modelRules,NAMESPACE } from './core/state.js';
import { parseDialogue,renderDialogue,plainDialogue,promptPlan,validatePreset,isPlaceholderRole,DEFAULT_PROMPT,knownFormats,dialogueProblems,escapeHTML } from './core/protocol.js';
import { FloatingPlayer } from './core/floating.js';
import { renderPictures, drawPromptPlan, withoutPictures } from './core/draw.js';
import { createPictureHost } from './host-pictures.js';
import { createChatHost } from './host-chat.js';
import { createMomentsHost } from './host-moments.js';
import { createCallHost } from './host-call.js';
import { TIER_NAMES } from './core/novelai.js';
const base=new URL('.',import.meta.url),marker=globalThis.crypto?.randomUUID?.()||'unavailable';
let active=false,hooked=false,settings,cache,player,panel,frame,observer,renderTimer,floating,lineRaf,lineMedia,playbackMessage,selectedMessage,backend,enabling;
let renderEpoch=0,pictures=null,chats=null,momentsHost=null,callHost=null,pendingDraw=null,legacy=false;
const listeners=[],prompts=new Set();
// Every copy of the plugin that loads adds its folder here, so the self-check can tell when it is installed twice.
(globalThis.__stIphonieCopies??=new Set()).add(decodeURIComponent(base.pathname.replace(/\/$/,'').split('/').pop()));
// The latest notices and errors, for the self-check.
const recent=[];function remember(message,kind='notice'){recent.push({at:Date.now(),kind,message:String(message||'').slice(0,300)});if(recent.length>12)recent.shift();}
const context=()=>globalThis.SillyTavern?.getContext();
// Generation interceptor (manifest generate_interceptor): picture blocks stay in the chat but are left out of the
// messages sent to the model, so old pictures do not cost tokens on every request. Replaced, never mutated.
globalThis.stIphonieInterceptor=function(chat){if(!active||settings?.draw?.strip===false)return;for(let i=0;i<chat.length;i++){const m=chat[i];if(typeof m?.mes==='string'&&/<img\b/i.test(m.mes))chat[i]={...m,mes:withoutPictures(m.mes)};}};
// A call while the phone is closed: a note that stays until answered, and a tap on it opens the phone on the call.
function ringing(name){if(panel?.open)return;remember(name+' 来电');const open=()=>openPanel();if(globalThis.toastr)globalThis.toastr.info('点这里打开小手机接听',`📞 ${name} 来电`,{timeOut:settings?.calls?.ring*1000||30000,extendedTimeOut:0,tapToDismiss:true,onclick:open});else console.info('[ST-iPhonie]',name+' 来电');}
function notice(message){remember(message);if(globalThis.toastr)globalThis.toastr.info(message,'ST-iPhonie');else console.info('[ST-iPhonie]',message);}
function formats(){return knownFormats(settings);}
// What a reply shows: picture tags become placeholders, voice lines become waves (or plain lines when voice is off).
function transform(text){const out=renderPictures(text,marker);const p=parsed(out);return p.lines.length?(voiceOn()?renderDialogue(out,p.format,marker):plainDialogue(out,p.format)):out;}
function parsed(message){for(const format of formats()){try{const lines=parseDialogue(message,format);if(lines.length)return {format,lines};}catch{}}return {format:formats()[0],lines:[]};}
function clearPrompts(){const ctx=context();if(!ctx)return;for(const key of Object.keys(ctx.extensionPrompts||{})){if(key.startsWith('sttts.entry.'))ctx.setExtensionPrompt(key,'',-1,0);}prompts.clear();}
// Who may speak in this reply: the chat's character (all members in a group), anyone who spoke with a voice tag in the
// last 8 messages, and anyone named in the last 3. Reading rules and the language line are written only for them.
function speakers(){const ctx=context(),names=new Set(),add=n=>{if(n&&String(n).trim())names.add(String(n).trim());};if(!ctx)return [];add(ctx.name2);
 if(ctx.groupId){const group=ctx.groups?.find(g=>g.id===ctx.groupId);for(const member of group?.members||[])add(ctx.characters?.find(c=>c.avatar===member)?.name);}
 const recent=(ctx.chat||[]).filter(m=>m&&!m.is_system).slice(-8);for(const m of recent){if(!m.is_user)add(m.name);for(const line of parsed(m.mes||'').lines)add(line.role);}
 const text=recent.slice(-3).map(m=>m.mes||'').join('\n');for(const r of settings.routes)if(r.name&&text.includes(r.name))add(r.name);return [...names];}
function inject(type,options,dryRun){clearPrompts();if(!active)return;const only=speakers();for(const p of [...(voiceOn()?promptPlan(settings,modelRules(settings,only),only):[]),...drawPromptPlan(settings),...(chats?.bringPlan(typeof type==='string'?type:'',dryRun===true)||[])]){context().setExtensionPrompt(p.key,p.text,p.position,p.depth,false,p.role);prompts.add(p.key);}}
function persist(next){return backend.save(next);}
const voiceOn=()=>settings?.general?.voiceEnabled!==false;
function storeSettings(next){const voiced=voiceOn();settings=next;context().extensionSettings[NAMESPACE]=structuredClone(next);context().saveSettingsDebounced();if(active){inject();syncFloating();if(voiced!==voiceOn()){player.stop();rerender();}else scheduleRender();}}
function currentMessage(id){const ctx=context(),message=ctx.chat[id];if(!message||message.is_user||message.is_system)return null;return {message,chat:ctx.getCurrentChatId?.()??ctx.chatId,id,raw:message.mes,swipe:message.swipe_id};}
function unchanged(snap){const now=currentMessage(snap.id);return active&&now?.message===snap.message&&now.chat===snap.chat&&now.raw===snap.raw&&now.swipe===snap.swipe;}
function playMessage(id,index){const snap=currentMessage(id);if(!snap)return;const current=player.queue[player.index];if(index!==undefined&&playbackMessage&&unchanged(playbackMessage)&&playbackMessage.id===id&&current?.uiIndex===index&&['playing','generating','paused'].includes(player.phase)){player.toggle();return;}selectedMessage=snap;playbackMessage=snap;const lines=parsed(snap.raw).lines.map((line,uiIndex)=>({...line,uiIndex}));if(index!==undefined&&!lines[index]){healed.delete(id);context().updateMessageBlock(id,snap.message);scheduleRender();notice('这句台词和消息内容对不上了，已经重新画好，请再点一次');return;}player.start(index===undefined?lines:lines[index]?[lines[index]]:[],()=>unchanged(snap));}
function playSelected(){if(selectedMessage&&unchanged(selectedMessage))return playMessage(selectedMessage.id);const chat=context().chat;for(let id=chat.length-1;id>=0;id--){const snap=currentMessage(id);if(snap&&parsed(snap.raw).lines.length)return playMessage(id);}notice('当前聊天还没有可朗读的台词');}
function status(value){floating?.update(value);const label=document.querySelector('#sttts-extension-entry .sttts-status');if(label)label.textContent=value.message;const toggle=document.querySelector('#sttts-toggle');if(toggle){toggle.textContent=value.phase==='paused'?'继续':'暂停';toggle.disabled=!['playing','generating','paused'].includes(value.phase);}const stop=document.querySelector('#sttts-stop');if(stop)stop.disabled=['idle','error'].includes(value.phase);frame?.contentWindow?.stTtsUpdate?.(value);if(value.phase==='error'&&!panel?.open)notice(value.message);scheduleRender();}
// A reply whose voice lines were not turned into waves when it was first drawn (seen once after a generation) is redrawn once.
const healed=new Map(),streaming=()=>{const p=context()?.streamingProcessor;return !!p&&!p.isFinished;};
// Throttled, not debounced: other extensions that keep changing #chat cannot postpone the waves forever.
function scheduleRender(){if(renderTimer)return;renderTimer=setTimeout(()=>{renderTimer=0;decorate();},40);}
/** Only changes that bring in (or take away) messages or our own marks are worth a redraw. */
const ours=node=>node.nodeType===1&&(node.matches?.('.mes,[data-sttts-token]')||!!node.querySelector?.('[data-sttts-token],.mes'));
// While a reply streams in, the tavern draws the whole message again for every new chunk, so the waves and pictures in
// it are brand new each time: blank until decorate() fills them 40 ms later, which made them flash on every chunk. The
// observer runs before the browser paints, so there the new ones take over what the old ones showed (a finished picture
// is moved over as it is, and its image never reloads).
const drawnIn=r=>r.target.closest?.('.mes[mesid]')?.getAttribute('mesid');
const ownedIn=n=>n.nodeType!==1?[]:[n,...n.querySelectorAll('[data-sttts-pic],[data-sttts-line]')].filter(el=>el.dataset?.stttsToken===marker);
const waveKey=(id,el)=>id+':'+el.dataset.stttsLine+':'+el.textContent;
function carryOver(records){const pics=new Map(),waves=new Map();
 for(const r of records){const id=drawnIn(r);if(id==null)continue;for(const n of r.removedNodes)for(const el of ownedIn(n)){if(el.hasAttribute('data-sttts-pic')){if(el.dataset.stttsRendered)pics.set(id+':'+el.dataset.stttsHash,el);}else{const b=el.querySelector('[data-sttts-action="line"]');if(b)waves.set(waveKey(id,el),b);}}}
 if(!pics.size&&!waves.size)return;
 for(const r of records){const id=drawnIn(r);if(id==null)continue;for(const n of r.addedNodes){if(!n.isConnected)continue;for(const el of ownedIn(n)){if(el.hasAttribute('data-sttts-pic')){const key=id+':'+el.dataset.stttsHash,old=pics.get(key);if(old&&!el.dataset.stttsRendered){pics.delete(key);el.replaceWith(old);}}else{const old=waves.get(waveKey(id,el)),b=el.querySelector('[data-sttts-action="line"]');if(old&&b)for(const k of ['data-sttts-state','title','aria-label','aria-busy'])old.hasAttribute(k)?b.setAttribute(k,old.getAttribute(k)):b.removeAttribute(k);}}}}}
function chatChanged(records){try{carryOver(records);}catch{}if(records.some(r=>[...r.addedNodes,...r.removedNodes].some(ours)||legacy&&redrawn(r.target)))scheduleRender();}
// SillyTavern before 1.19 has no message formatter hook. There a reply is drawn again after the tavern draws it: the
// transformed text goes through the tavern's own formatting (the steps the hook runs in), and the first node drawn is
// remembered, so a later redraw by the tavern (edit, swipe, other extensions) is noticed and drawn again.
const liveId=()=>streaming()?context().chat.length-1:-1;
const redrawn=t=>t.nodeType===1&&t.classList.contains('mes_text')&&Number(t.closest('.mes')?.getAttribute('mesid'))!==liveId();
function legacyFormat(){if(!legacy)return;const ctx=context(),live=liveId();for(const element of document.querySelectorAll('#chat .mes[mesid]')){const id=Number(element.getAttribute('mesid')),message=ctx.chat[id],box=element.querySelector('.mes_text');if(!box||!message||message.is_user||message.is_system||id===live||box.querySelector('textarea'))continue;const raw=message.extra?.display_text||message.mes||'',drawn=box.stttsDrawn;if(drawn&&drawn.raw===raw&&drawn.voice===voiceOn()&&drawn.node?.parentNode===box)continue;let out;try{out=transform(raw);}catch{continue;}if(out===raw)continue;box.innerHTML=ctx.messageFormatting(out,message.name,message.is_system,message.is_user,id,message.extra?.uses_system_ui?{MESSAGE_ALLOW_SYSTEM_UI:true}:{},false);box.stttsDrawn={raw,voice:voiceOn(),node:box.firstChild};}}
function animateLines(){cancelAnimationFrame(lineRaf);document.querySelectorAll('[data-sttts-bar]').forEach(el=>el.style.removeProperty('transform'));if(!active||player.phase!=='playing'||!settings.general.waveformEnabled||lineMedia?.matches||document.hidden)return;let previous=0;const draw=now=>{if(now-previous>=32){const levels=player.sink.levels();document.querySelectorAll('[data-sttts-state="playing"] [data-sttts-bar]').forEach((bar,i)=>bar.style.transform='scaleY('+(.2+.8*(levels[i%5]||0))+')');previous=now;}lineRaf=requestAnimationFrame(draw);};lineRaf=requestAnimationFrame(draw);}
async function decorate(){if(!active)return;legacyFormat();pictures?.decorate(currentMessage);const epoch=++renderEpoch,livePlayer=player;document.querySelectorAll('#chat [data-sttts-owned="toolbar"]').forEach(el=>el.remove());const jobs=[];for(const element of document.querySelectorAll('#chat .mes[mesid]')){const id=Number(element.getAttribute('mesid')),snap=currentMessage(id);if(!snap)continue;const lines=parsed(snap.raw).lines;lint(element,snap.raw,lines);if(!legacy&&voiceOn()&&lines.length&&!element.querySelector(`[data-sttts-line][data-sttts-token="${marker}"]`)&&!streaming()&&healed.get(id)!==snap.raw){healed.set(id,snap.raw);context().updateMessageBlock?.(id,snap.message);continue;}for(const button of element.querySelectorAll('[data-sttts-action="line"]')){const owner=button.closest('[data-sttts-token]'),index=Number(owner?.dataset.stttsLine),line=lines[index];if(owner?.dataset.stttsToken!==marker||!line)continue;const ticket=button.stttsTicket=(button.stttsTicket||0)+1;jobs.push((async()=>{let state=await livePlayer.lineState(line);const route=settings.routes.find(r=>r.name===line.role);if(state==='ungenerated'&&!route?.voice)state='unbound';if(button.stttsTicket!==ticket||!active||livePlayer!==player||!unchanged(snap)||!button.isConnected)return;const current=player.queue[player.index];if(playbackMessage&&unchanged(playbackMessage)&&playbackMessage.id===id&&current?.uiIndex===index&&['playing','generating','paused','waiting'].includes(player.phase))state=player.phase;button.dataset.stttsState=state;const labels={unbound:'还没有配音，点击选择音色',ungenerated:'未生成，点击生成并播放',ready:'可以播放',played:'已播放，点击再次朗读',generating:'正在生成，点击暂停',playing:'正在播放，点击暂停',paused:'已暂停，点击继续',waiting:'等待选择音色'};button.title=labels[state];button.setAttribute('aria-label',line.role+'：'+labels[state]);button.setAttribute('aria-busy',String(state==='generating'));})());}}
await Promise.all(jobs);if(epoch===renderEpoch&&active){animateLines();lookForCover();}}
// A reply whose voice tags could not all be read gets a small note under it: which ones and why. Drawn again only when
// the problems change, so it never keeps the chat redrawing.
function lint(element,raw,lines){const box=element.querySelector('.mes_text');if(!box)return;const old=box.querySelector(':scope>[data-sttts-owned="lint"]');const problems=voiceOn()&&Number(element.getAttribute('mesid'))!==liveId()&&!box.querySelector('textarea')?dialogueProblems(raw,lines):[];const key=problems.length?JSON.stringify(problems.map(p=>[p.at,p.reason])):'';if((old?.dataset.key||'')===key)return;old?.remove();if(!key)return;const note=document.createElement('details');note.className='sttts-lint';note.dataset.stttsOwned='lint';note.dataset.key=key;note.innerHTML=`<summary>有 ${problems.length} 句台词格式不对，没有声波</summary><ul>${problems.map(p=>`<li><b>${escapeHTML(p.role||'未写角色')}</b>：${escapeHTML(p.reason)}<code>${escapeHTML(p.snippet)}</code></li>`).join('')}</ul><p>可以重新生成这条回复，或者编辑成 “译文”&lt;tts&gt;角色|情绪|原文&lt;/tts&gt;。</p>`;box.append(note);}
/** Facts for the self-check (core/diagnostics.js makes the report). Keys are only asked whether they work, never read. */
async function diagnose(){const ctx=context(),s=settings,json=url=>fetch(url,{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null);
 const [manifest,version,storage]=await Promise.all([json(new URL('manifest.json',base)),json('/version'),navigator.storage?.estimate?.().catch(()=>null)]);
 const preset=s.presets.find(p=>p.id===s.activePreset),voiced=r=>!!(r.voice?.trim()||(r.engine==='fish'&&s.connections.fish?.params?.references?.length)||(r.engine==='mini'&&s.connections.mini?.params?.timbre_weights?.length));
 const keys={};for(const engine of ['fish','mini','eleven','nai']){const users=engine==='nai'?[]:s.routes.filter(r=>r.engine===engine).map(r=>r.name),k={set:!!backend.keyStatus(engine),needed:engine==='nai'?(s.draw?.enabled?'正文出图开着':''):users.length?'有角色在用：'+users.join('、'):''};
  if(k.set&&engine!=='mini'){try{if(engine==='nai'){const sub=await backend.naiSubscription();k.detail=sub?`${TIER_NAMES[sub.tier]||'订阅'}${sub.active?'':'（未激活）'}${sub.anlas!==undefined?' · Anlas '+sub.anlas:''}`:'';}else{const b=await backend.voiceBalance(engine);k.detail=b?.kind==='characters'?`剩余 ${b.left} / ${b.limit} 字符`:b?.kind==='credit'?`余额 ${b.credit}`:'';}k.check='ok';}catch(e){k.check='error';k.detail=e.message;}}
  if(k.set||k.needed)keys[engine]=k;}
 let reply=null;for(let i=ctx.chat.length-1;i>=0&&!reply;i--){const m=ctx.chat[i];if(!m||m.is_user||m.is_system)continue;const raw=m.mes||'',lines=parsed(raw).lines,element=document.querySelector(`#chat .mes[mesid="${i}"]`),ours=element?element.querySelectorAll(`[data-sttts-line][data-sttts-token="${marker}"]`).length:0,all=element?element.querySelectorAll('[data-sttts-line]').length:0;
  reply={id:i,name:m.name||'',lines:lines.length,tags:/<tts\b/i.test(raw),problems:dialogueProblems(raw,lines),inChat:!!element,waves:ours,stale:all-ours,iframes:element?element.querySelectorAll('iframe').length:0,covered:coverSeen?.id===i?coverSeen.what:'',streaming:i===liveId()};}
 const where={in_chat:'聊天中',in_prompt:'系统提示后',before_prompt:'系统提示前'};
 return {at:Date.now(),plugin:{version:manifest?.version||'',copies:[...globalThis.__stIphonieCopies]},tavern:{version:version?.pkgVersion||'',mode:legacy?'legacy':'hook'},
  browser:{secure:globalThis.isSecureContext!==false,audio:!!globalThis.AudioContext,indexedDB:!!globalThis.indexedDB,storage:storage?.quota?{usage:storage.usage,quota:storage.quota}:null,agent:browserName()},extensions:thirdParty(),
  voice:{enabled:voiceOn(),preset:preset?.name||'',format:preset?.format||'',injection:preset?.injection?`${where[preset.injection.position]||preset.injection.position}${preset.injection.position==='in_chat'?' · 深度 '+preset.injection.depth:''}`:'',roles:s.routes.map(r=>({name:r.name,voice:voiced(r)}))},
  keys,reply,errors:recent.slice()};}
// What sits on top of the reply's first wave, when something other than the wave would take the click. Looked at while
// the chat is drawn and the phone is closed (an open phone is a modal dialog: nothing under it can be hit-tested).
let coverSeen=null;
function lookForCover(){if(panel?.open)return;const chat=context()?.chat||[];for(let i=chat.length-1;i>=0;i--){const m=chat[i];if(!m||m.is_user||m.is_system)continue;const element=document.querySelector(`#chat .mes[mesid="${i}"]`),what=covering(element);if(what!==null)coverSeen={id:i,what};return;}}
function covering(element){const button=element?.querySelector(`[data-sttts-token="${marker}"] [data-sttts-action="line"]`);if(!button||!document.elementsFromPoint)return null;const r=button.getBoundingClientRect();if(!r.width||r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth)return null;const top=document.elementsFromPoint(r.left+r.width/2,r.top+r.height/2).find(el=>!el.closest('#sttts-panel,#sttts-floating'));if(!top||top===document.documentElement||top===document.body)return null;if(top===button||button.contains(top))return '';return top.tagName.toLowerCase()+(top.id?'#'+top.id:'')+[...top.classList].slice(0,3).map(c=>'.'+c).join('');}
function thirdParty(){const names=new Set();for(const el of document.querySelectorAll('script[src*="/extensions/third-party/"],link[href*="/extensions/third-party/"]')){const m=/\/extensions\/third-party\/([^/]+)\//.exec(el.src||el.href);if(m)names.add(decodeURIComponent(m[1]));}return [...names];}
function browserName(){const ua=navigator.userAgent||'',b=(/(Edg|OPR|Firefox|Chrome)\/(\d+)/.exec(ua)||[]).slice(1).join(' ')||(/Version\/(\d+).*Safari/.test(ua)?'Safari '+/Version\/(\d+)/.exec(ua)[1]:''),os=/Android/.test(ua)?'Android':/iPhone|iPad/.test(ua)?'iOS':/Windows/.test(ua)?'Windows':/Mac OS/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'';return [b.replace('Edg','Edge').replace('OPR','Opera'),os].filter(Boolean).join(' · ');}
function rerender(){const ctx=context();document.querySelectorAll('#chat .mes[mesid]').forEach(el=>{const id=Number(el.getAttribute('mesid'));if(ctx.chat[id])ctx.updateMessageBlock(id,ctx.chat[id]);});scheduleRender();}
function unknown(name){if(isPlaceholderRole(name)){player.stop('请在台词中填写实际角色名');return;}let route=settings.routes.find(r=>r.name===name);if(!route){route={id:crypto.randomUUID(),name,engine:'fish',voice:'',language:''};settings.routes.push(route);}settings.selected=route.id;persist(settings);openPanel(route.id);}
function openPanel(roleId){floating?.setMode('docked');if(!panel){panel=document.createElement('dialog');panel.id='sttts-panel';panel.setAttribute('aria-label','ST-iPhonie');frame=document.createElement('iframe');frame.title='ST-iPhonie';frame.src=new URL('ui/index.html',base).href;panel.append(frame);panel.addEventListener('close',()=>frame?.contentWindow?.stTtsPanelVisibility?.(false));panel.addEventListener('cancel',()=>{if(['playing','generating'].includes(player.phase))player.toggle();});document.body.append(panel);}if(!panel.open){panel.showModal();frame.contentWindow?.stTtsPanelVisibility?.(true);}if(roleId)frame.contentWindow?.stTtsOpenRole?.(roleId);}
function connect(source){
 if(!active||source!==frame?.contentWindow)throw Error('设置页面未连接');
 const owner=backend,api=owner.api();
 const check=()=>{if(!active||backend!==owner||owner.closed||source!==frame?.contentWindow)throw Error('设置页面已失效，请重新打开');};
 return Object.freeze({...api,
  save:(next,revision)=>{check();return api.save({...next,floating:settings.floating},revision);},
  close:()=>{check();panel?.close();},
  latest:()=>{check();const ctx=context();for(let i=ctx.chat.length-1;i>=0;i--){const snap=currentMessage(i);if(snap&&parsed(snap.raw).lines.length)return {id:i,lines:parsed(snap.raw).lines};}return {id:-1,lines:[]};},
  play:(id,line)=>{check();playMessage(id,line);},
  audition:route=>{check();playbackMessage=null;api.audition(route);},
  recentMessages:()=>{check();return pictures.recentMessages();},
  insertImage:(id,photoId)=>{check();return pictures.insertImage(id,photoId);},
  suggestPrompt:()=>{check();return pictures.suggestPrompt();},
  chatPictureStats:()=>{check();return pictures.pictureStats();},
  planLatestPictures:()=>{check();return pictures.planLatest();},
  clearChatPictures:()=>{check();return pictures.clearPictures();},
  takeDraw:()=>{check();const value=pendingDraw;pendingDraw=null;return value;},
  chatReply:threadId=>{check();return chats.reply(threadId);},
  chatBring:(threadId,ids)=>{check();return chats.bring(threadId,ids);},
  chatPendingBring:()=>{check();return chats.pendingBring();},
  chatCancelBring:()=>{check();chats.cancelBring();},
  chatTyping:threadId=>{check();return chats.typing(threadId);},
  momentsRefresh:()=>{check();return momentsHost.refresh();},
  momentsReact:id=>{check();return momentsHost.react(id);},
  momentsReply:(id,commentId)=>{check();return momentsHost.reply(id,commentId);},
  momentsDrawImage:(id,allowPaid)=>{check();return momentsHost.drawImage(id,{allowPaid});},
  momentsBusy:()=>{check();return momentsHost.busy();},
  callStatus:()=>{check();return callHost.status();},
  callDial:name=>{check();return callHost.dial(name);},
  callAnswer:()=>{check();return callHost.answer();},
  callDecline:()=>{check();return callHost.decline();},
  callHangup:()=>{check();return callHost.hangup();},
  callSay:text=>{check();return callHost.say(text);},
  callRetry:()=>{check();return callHost.retry();},
   playFavorite:id=>{check();playbackMessage=null;return api.playFavorite(id);},
  diagnose:()=>{check();return diagnose();},
  userName:()=>{check();return context()?.name1||'';},
  exportBackup:async parts=>{check();const manifest=await fetch(new URL('manifest.json',base)).then(r=>r.ok?r.json():null).catch(()=>null);return api.exportBackup(parts,manifest?.version||'');},
  noteError:text=>{check();remember(text,'error');}
 });
}
// Listened to in the capture phase, so a theme or extension that stops clicks inside messages cannot swallow it.
// A click on a wave that cannot be played always says why instead of doing nothing.
function click(event){if(!active)return;if(pictures?.click(event))return;const button=event.target.closest?.('[data-sttts-action]');if(!button)return;const owner=button.closest('[data-sttts-token]'),mes=button.closest('.mes[mesid]'),id=Number(mes?.getAttribute('mesid')),action=button.dataset.stttsAction;
 if(owner?.dataset.stttsToken!==marker){if(action!=='line'||!owner)return;event.preventDefault();
  // Drawn before this page load (kept by another extension), or moved out of the chat by a theme or extension.
  if(mes&&currentMessage(id)){healed.delete(id);context().updateMessageBlock(id,context().chat[id]);scheduleRender();notice('这段声波是刷新前画的，已经重新画好，请再点一次');}
  else notice('这段声波不在酒馆的消息里（可能被美化主题或别的插件搬动过），没法播放。可以关掉它们再刷新试试');return;}
 event.preventDefault();if(action==='settings')openPanel();else if(action==='stop')player.stop();else if(action==='toggle')player.toggle();
 else if(!mes||!currentMessage(id))notice('找不到这段声波所在的消息（可能被美化主题或别的插件改动过），请刷新页面再试');
 else if(action==='all')playMessage(id);else if(action==='line')playMessage(id,Number(owner.dataset.stttsLine));}
function mountEntry(){const mount=document.querySelector('#extensions_settings');if(!mount)return;const entry=document.createElement('div');entry.id='sttts-extension-entry';entry.innerHTML='<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header" id="sttts-entry-header" tabindex="0"><b>ST-iPhonie</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><div class="sttts-entry-controls"><button type="button" id="sttts-all" class="menu_button">整条播放</button><button type="button" id="sttts-toggle" class="menu_button" disabled>暂停</button><button type="button" id="sttts-stop" class="menu_button" disabled>停止</button></div><span class="sttts-status" role="status">等待播放</span><button type="button" id="sttts-open" class="menu_button">打开小手机</button></div></div>';entry.querySelector('#sttts-all').addEventListener('click',playSelected);entry.querySelector('#sttts-toggle').addEventListener('click',()=>player.toggle());entry.querySelector('#sttts-stop').addEventListener('click',()=>player.stop());entry.querySelector('#sttts-open').addEventListener('click',()=>openPanel());entry.querySelector('#sttts-entry-header').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.currentTarget.click();}});mount.append(entry);}
function syncFloating(){if(!active)return;if(!settings.general.floatingEnabled){floating?.destroy();floating=null;return;}if(floating){floating.applyTheme();floating.animate();return;}floating=new FloatingPlayer({openSettings:()=>openPanel(),position:settings.floating,savePosition:p=>{settings.floating=p;persist(settings);},levels:()=>player.sink.levels(),theme:()=>settings.theme,motion:()=>settings.general.waveformEnabled});floating.update({phase:player.phase,message:player.message,engine:player.engine,speaker:player.speaker});}
async function enableInternal(){if(active)return;const ctx=context();// generateRaw joined the context in 1.13.2, which also ignores minimum_client_version: this keeps older taverns out.
 if(!ctx?.setExtensionPrompt||!ctx.generateRaw||!(ctx.messageFormatter?.addHook||ctx.messageFormatting)||!ctx.updateMessageBlock||!ctx.eventSource?.on||!ctx.eventSource?.removeListener||!ctx.eventTypes||!ctx.extensionSettings||!ctx.saveSettingsDebounced){notice('ST-iPhonie 需要 SillyTavern 1.13.2 或更新版本');return;}if(!globalThis.crypto?.subtle||!globalThis.crypto?.randomUUID){notice('请用 localhost 或 HTTPS 地址打开酒馆，以启用语音缓存和设置');return;}if(!globalThis.AudioContext||!globalThis.AbortSignal?.any){notice('当前浏览器缺少语音播放所需功能，请更新浏览器');return;}backend=new TTSBackend({settings:ctx.extensionSettings[NAMESPACE],persist:storeSettings,notify:notice,change:status,unknown});settings=backend.settings;cache=backend.cache;player=backend.player;pictures=createPictureHost({context,settings:()=>settings,backend,marker,scheduleRender,notice,openDraw:payload=>{pendingDraw=payload;openPanel();frame?.contentWindow?.stTtsOpenDraw?.();}});callHost=createCallHost({context,settings:()=>settings,backend,notice,ringing});chats=createChatHost({context,settings:()=>settings,backend,notice,onCall:(name,reason)=>{try{callHost.ring(name,{reason});}catch{}}});momentsHost=createMomentsHost({context,settings:()=>settings,backend,notice});await backend.initialize();ctx.extensionSettings[NAMESPACE]=structuredClone(settings);ctx.saveSettingsDebounced();active=true;lineMedia=matchMedia('(prefers-reduced-motion: reduce)');lineMedia.addEventListener('change',animateLines);document.addEventListener('visibilitychange',animateLines);globalThis.__stTtsPanelBridge={connect};
 legacy=!ctx.messageFormatter?.addHook;
 if(!hooked&&!legacy){ctx.messageFormatter.addHook((text,meta)=>{if(!active||meta.isUser||meta.isSystem||meta.isReasoning||meta.messageId<0)return text;try{return transform(text);}catch{return text;}},{stage:ctx.messageFormatter.stage.BEFORE_REGEX,order:100});hooked=true;}
 const subscribe=(name,fn)=>{if(!name)return;ctx.eventSource.on(name,fn);listeners.push([ctx.eventSource,name,fn]);};subscribe(ctx.eventTypes.GENERATION_AFTER_COMMANDS,inject);
 // Each new story reply counts toward automatic 朋友圈 posts (off unless the user turns it on).
 subscribe(ctx.eventTypes.MESSAGE_RECEIVED,()=>{momentsHost?.storyReplied();callHost?.storyReplied();});
 for(const event of ['CHAT_CHANGED','MESSAGE_SWIPED','MESSAGE_EDITED','MESSAGE_DELETED'])subscribe(ctx.eventTypes[event],()=>{player.stop('消息已变化');scheduleRender();});for(const event of ['CHARACTER_MESSAGE_RENDERED','MESSAGE_RECEIVED'])subscribe(ctx.eventTypes[event],scheduleRender);subscribe(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED,id=>{pictures?.autoPictures(Number(id)).catch(e=>notice(e.message));});
 document.addEventListener('click',click,true);mountEntry();syncFloating();observer=new MutationObserver(chatChanged);const chat=document.querySelector('#chat');if(chat)observer.observe(chat,{childList:true,subtree:true});inject();rerender();}
export function enable(){if(enabling)return enabling;enabling=enableInternal().finally(()=>{enabling=null;});return enabling;}
export async function disable(){if(enabling)await enabling;if(!active)return;active=false;renderEpoch++;cancelAnimationFrame(lineRaf);lineMedia?.removeEventListener('change',animateLines);document.removeEventListener('visibilitychange',animateLines);playbackMessage=selectedMessage=null;healed.clear();player.stop();clearPrompts();for(const [source,event,fn] of listeners)source.removeListener(event,fn);listeners.length=0;observer?.disconnect();clearTimeout(renderTimer);renderTimer=0;document.removeEventListener('click',click,true);document.querySelector('#sttts-extension-entry')?.remove();floating?.destroy();floating=null;document.querySelectorAll('[data-sttts-owned="toolbar"]').forEach(el=>el.remove());panel?.remove();panel=frame=null;delete globalThis.__stTtsPanelBridge;pictures=null;chats=null;momentsHost=null;callHost?.dispose();callHost=null;pendingDraw=null;await backend.close();rerender();}
export const dispose=disable;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>enable().catch(e=>notice(e.message)),{once:true});else enable().catch(e=>notice(e.message));
