'use strict';
const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 4 6 10l6 6"/></svg>';
const engines = {
  fish: { name: 'Fish Audio', model: 's2.1-pro', models: ['s2.1-pro','s2-pro'], voices: [], tags: ['愉悦', '悲伤', '低语', '笑声'], detail: '暖杏' },
  mini: { name: 'MiniMax', model: 'speech-2.8-hd', models: ['speech-2.8-hd','speech-2.8-turbo'], voices: [], tags: ['happy', 'sad', 'calm', 'whisper'], detail: '雾蓝' },
  eleven: { name: 'ElevenLabs', model: 'eleven_v3', models: ['eleven_v3'], voices: [], tags: ['happy', 'sad', 'whispers', 'laughs'], detail: '鼠尾草绿' },
};
Object.entries(TTSParameters.catalogs).forEach(([key,c])=>engines[key].models=c.models);
const languages = { zh:'中文', ja:'日语', en:'英语', ko:'韩语', fr:'法语', de:'德语', es:'西班牙语', it:'意大利语', ru:'俄语', pt:'葡萄牙语' };
const originalPrompt = '正常续写正文与叙事，不要改变角色人设或写作风格。\n\n凡是角色真正说出口、需要朗读的台词，请完整照抄成 {{格式}}；标签前引号内的 {译文} 必须是自然中文，供读者查看；标签内的 {文本} 必须保留角色实际说话的原语言，供 TTS 生成。两者语义必须一致且都要保留。旁白、动作、环境和心理描写继续写成普通正文。\n\n格式中的角色、情绪和文本都必须填写，台词语言遵循：{{语言}}。\n\n不要解释这条规则，不要输出代码块，也不要为没有说出口的内容生成语音标签。';
const defaultFormat = '“{译文}”<tts role="{角色}" emotion="{情绪}">{文本}</tts>';
let state=ST_TTS_HOST.getState();
const defaultConnections={fish:{format:'mp3'},mini:{region:'cn',format:'mp3'},eleven:{format:'mp3_44100_128'}};
function normalizeState(){state.general={defaultLanguage:"zh",cacheEnabled:true,...state.general};if(!languages[state.general.defaultLanguage])state.general.defaultLanguage="zh";state.connections={...structuredClone(defaultConnections),...state.connections};for(const key of Object.keys(engines)){const c=state.connections[key];c.model??=engines[key].model;c.params={...TTSParameters.defaults(key),...c.params};if(c.format&&!c.parametersVersion)c.params[key==='fish'?'format':key==='mini'?'audio_setting.format':'output_format']=c.format;c.parametersVersion=1;TTSParameters.normalize(key,c);}state.presets.forEach(p=>{if(!p.entries)p.entries=[{id:'entry-'+p.id,title:'台词生成规则',text:p.prompt,enabled:true}];p.injection={...injectionDefaults,...p.injection};});}
normalizeState();
let selectedEngine=null;
const connectionDrafts=new Map();
let tab = 'roles';
let drafts = new Map();
let presetDrafts = new Map();
let modalAction = 'role';
let toastTimer;
let phase='idle';let activeLine=-1;let cache={size:0};let checked=new Set();let latest={id:-1,lines:[]};let voiceCursor={};
const voiceLists={fish:[],mini:[],eleven:[]};
const helps = {
  'default-language':['默认台词语言','供选择“跟随默认”的角色使用，新角色默认跟随。角色单独选过的语言保持不变。影响后续生成的语言规则，不会翻译已有台词；中文译文继续保留。实际可朗读语言由角色的引擎与模型决定。'],
  'appearance':['界面外观','默认跟随设备的日夜模式，也可以固定为日间或夜间。'],
  global:['全局角色配音','同一个角色名在不同聊天和角色卡中共用配音配置。提示词预设单独保存，切换预设不会改变这里的音色和语言。'],
  capabilities:['表达能力','这里展示各引擎的表达标签样例。发送时按角色选用的引擎与模型附加规则，由模型为每句台词选择情绪。实际支持范围将在正式接入时逐模型核验。'],
  variables:['提示词变量','{{格式}}：当前保存的台词格式。\n{{语言}}：各角色设置的语言规则。\n格式中需保留 {译文}、{角色}、{情绪}、{文本} 四个字段。'],
  injection:['插入深度与消息身份','聊天内插入时，深度 0 在最新消息之后，数值越大越靠前。系统、用户、助手是发送给模型的消息身份，不是台词说话者。主提示词前后位置不按聊天深度定位。\n条目默认沿用预设设置，也可分别设置位置与身份。实际后端可能合并系统消息，待酒馆接入验证。'],
  'transport-fish':['Fish 请求通道','使用官方兼容接口，原生参数放入 provider.options.fish-audio。drama-3-preview 在兼容目录中尚未列出，正式合成可用性待验证。','https://docs.fish.audio/developer-guide/compat/capabilities'],
  'transport-mini':['MiniMax 请求通道','官方 HTTP 合成接口；账户需对应所选区域。当前不发送真实请求。','https://platform.minimax.io/docs/api-reference/speech-t2a-http'],
  'transport-eleven':['ElevenLabs 请求通道','完整参数方案拟使用官方直连。当前酒馆内置转发未传 output_format、enable_logging 等查询参数。浏览器跨域、账户区域和真实合成仍待验证。','https://elevenlabs.io/docs/api-reference/text-to-speech/convert'],
  'engine-options':['引擎配置','每个引擎独立保存连接与输出设置。这里的音频格式是界面选项草案，实际可用项须以正式接入时的模型及账户能力为准。模型、音色和台词语言在角色配音中设置。'],
};
function persist(){state=ST_TTS_HOST.save(state);}
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent=message; $('#toast').classList.add('show'); toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2600); }
const effectiveLanguage = role => role.language || state.general.defaultLanguage;
const languageRules = () => '默认台词语言：'+languages[state.general.defaultLanguage]+'；'+state.routes.map(r=>`${r.name}：${languages[effectiveLanguage(r)]}`).join('；');
const getRoute = id => state.routes.find(r=>r.id===id);
function draft(id=state.selected) { if(!drafts.has(id)) drafts.set(id,{...getRoute(id)}); return drafts.get(id); }
function presetDraft() { if(!presetDrafts.has(state.activePreset)) presetDrafts.set(state.activePreset,structuredClone(state.presets.find(p=>p.id===state.activePreset))); return presetDrafts.get(state.activePreset); }
function applyTheme(){ const dark=state.theme==='dark'||(state.theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme=dark?'dark':'light'; if($('#theme'))$('#theme').value=state.theme; }
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyTheme);

function heading(title,detail,action=''){return `<div class="page-heading"><div><h2>${title}</h2><div class="page-sub">${detail}</div></div>${action}</div>`;}
function info(key,label){return `<button type="button" class="info" data-help="${key}" aria-label="${label}">i</button>`;}
function render(){
  rememberSections();
  document.querySelectorAll('[data-tab]').forEach(button=>{if(button.dataset.tab===tab)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  $('#page').innerHTML=tab==='roles'?rolesPage():tab==='presets'?presetsPage():tab==='settings'?settingsPage():enginesPage();
  if(tab==='presets')updatePreview();if(tab==='engines'&&selectedEngine)updateRequestPreview();
  renderChat();updateCacheSummary();
}
async function updateCacheSummary(){const stats=await ST_TTS_HOST.cacheStats();cache.size=stats.count;if($('#cache-count'))$('#cache-count').textContent=stats.count+' 段 · '+(stats.bytes/1048576).toFixed(1)+' MB';if($('#clear-cache'))$('#clear-cache').disabled=stats.count===0;}
function settingsPage(){return heading('通用设置','语言、外观与缓存')+`<div class="form-page general-settings"><section class="general-section"><div class="general-section-title"><h3>语言</h3>${info('default-language','默认台词语言说明')}</div><label class="field"><span>默认台词语言</span><select id="default-language">${Object.entries(languages).map(([key,label])=>`<option value="${key}" ${key===state.general.defaultLanguage?'selected':''}>${label}</option>`).join('')}</select></label></section><section class="general-section"><div class="general-section-title"><h3>外观</h3>${info('appearance','外观说明')}</div><label class="field"><span>日夜模式</span><select id="theme" aria-label="外观">${[['system','跟随系统'],['light','日间'],['dark','夜间']].map(([key,label])=>`<option value="${key}" ${key===state.theme?'selected':''}>${label}</option>`).join('')}</select></label></section><section class="general-section"><div class="general-section-title"><h3>悬浮播放器</h3>${info('floating','悬浮播放器说明')}</div><div class="switch-field cache-toggle"><span>显示悬浮播放器</span><label class="switch"><input id="floating-enabled" type="checkbox" aria-label="显示悬浮播放器" ${state.general.floatingEnabled?'checked':''}><span aria-hidden="true"></span></label></div><div class="switch-field cache-toggle"><span>播放音波动效</span><label class="switch"><input id="waveform-enabled" type="checkbox" aria-label="播放音波动效" ${state.general.waveformEnabled?'checked':''}><span aria-hidden="true"></span></label></div></section><section class="general-section"><div class="general-section-title"><h3>语音缓存</h3>${info('cache-settings','语音缓存说明')}</div><div class="switch-field cache-toggle"><span>复用已生成的语音</span><label class="switch"><input id="cache-enabled" type="checkbox" aria-label="复用已生成的语音" ${state.general.cacheEnabled?'checked':''}><span aria-hidden="true"></span></label></div><div class="cache-summary"><div><span>当前缓存</span><strong id="cache-count" aria-live="polite">${cache.size} 段</strong></div><button class="ghost" id="clear-cache" ${cache.size===0?'disabled':''}>清理缓存</button></div></section><div class="general-save-state" role="status">更改自动保存</div></div>`;}
function hasVoice(r){return !!r.voice?.trim() || r.engine==='fish'&&state.connections.fish.params.references.length>0 || r.engine==='mini'&&state.connections.mini.params.timbre_weights.length>0;}
function rolesPage(){
  if(!state.routes.length)return heading('角色配音','全局共用','<button class="ghost" id="add-role">＋ 新增角色</button>')+'<div class="form-page">添加说话者，为他们选择声音。</div>';
  const r=draft(); const e=engines[r.engine]; const dirty=JSON.stringify(r)!==JSON.stringify(getRoute(r.id));
  const waiting=ST_TTS_HOST.pendingRole()===r.name;
  return heading('角色配音',`${String(state.routes.length).padStart(2,'0')} 位说话者 <span>·</span> 全局共用 ${info('global','全局配音说明')}`,'<button class="ghost" id="add-role"><span aria-hidden="true">＋</span>新增角色</button>')+
  `<div class="role-layout"><div class="role-list" aria-label="角色列表">${state.routes.map((role,i)=>`<button class="role-row ${role.id===state.selected?'selected':''} ${!role.voice?'unset':''}" data-role="${role.id}" data-engine="${role.engine}" aria-pressed="${role.id===state.selected}"><span class="role-no">${String(i+1).padStart(2,'0')}</span><span><strong>${escapeHtml(role.name)}</strong><small>${role.voice?escapeHtml(languages[effectiveLanguage(role)])+' / '+escapeHtml(role.voice):'尚未选择音色'}</small><span class="role-engine">${role.voice?engines[role.engine].name:'等待配音'}</span></span></button>`).join('')}<div class="list-footer">每个角色，独立选择声音</div></div>
  <section class="editor" data-engine="${r.engine}" aria-label="角色配音编辑"><button class="text-button back" id="back-roles">${icon}角色列表</button>${waiting?'<div class="waiting-banner" role="status">整条播放已暂停，保存音色后继续。</div>':''}<div class="editor-header"><div><h3>${escapeHtml(r.name)}</h3><div class="edit-meta"><span class="counterpoint" aria-hidden="true"></span>${e.name}</div></div><span class="status-text" id="route-state">${dirty?'未保存':r.voice?'已保存':'待配置'}</span></div>
  <form id="role-form"><span class="field-label">语音引擎</span><div class="engine-picker">${Object.entries(engines).map(([key,item])=>`<button type="button" class="engine-choice" data-engine="${key}" data-select-engine="${key}" aria-pressed="${key===r.engine}">${item.name}</button>`).join('')}</div>
  <label class="field"><span>模型</span><select id="role-model" aria-label="模型"><option value="" ${!r.model?'selected':''}>跟随引擎 · ${state.connections[r.engine].model}</option>${e.models.map(model=>`<option ${model===r.model?'selected':''}>${model}</option>`).join('')}</select></label>
  <label class="field voice-field"><span>音色 ID</span><input id="role-voice" value="${escapeHtml(r.voice||'')}" list="voice-options" autocomplete="off"><datalist id="voice-options">${voiceLists[r.engine].map(v=>`<option value="${escapeHtml(v.id)}">${escapeHtml(v.name)}</option>`).join('')}</datalist></label><div class="voice-tools"><input id="voice-search" placeholder="搜索音色" aria-label="搜索音色"><button type="button" class="ghost" id="load-voices">读取音色</button><button type="button" class="text-button" id="more-voices" ${voiceCursor[r.engine]?.more?'':'hidden'}>下一页</button></div>
  <label class="field"><span>台词语言 ${info('language','台词语言说明')}</span><select id="role-language"><option value="" ${!r.language?'selected':''}>跟随默认 · ${languages[state.general.defaultLanguage]}</option>${Object.entries(languages).map(([key,label])=>`<option value="${key}" ${key===r.language?'selected':''}>${label}</option>`).join('')}</select></label>
  <div class="capability-label"><span class="field-label">表达能力</span>${info('capabilities','表达能力说明')}</div><div class="tags">${TTSParameters.tags(r.engine,r.model||state.connections[r.engine].model).map(tag=>`<span class="tag">${tag}</span>`).join('')}</div>
  <div class="editor-footer"><button type="button" class="ghost" id="audition"><span class="play-icon"></span>试听</button><button type="submit" class="primary">${waiting?'保存并继续':'保存配音'}</button></div></form></section></div>`;
}
function combinedPrompt(p){return p.entries.filter(e=>e.enabled).map(e=>e.text.trim()).filter(Boolean).join('\n\n');}
function syncPreset(){const p=presetDraft();const placement=$('.preset-injection > summary > span');if(placement)placement.textContent=p.injection.position==='in_chat'?injectionRoles[p.injection.role]+' · 深度 '+p.injection.depth:injectionPositions[p.injection.position];p.prompt=combinedPrompt(p);$('#preset-state').textContent='未保存';$('#preset-error').textContent='';updatePreview();}
function presetsPage(){const p=presetDraft();return heading('提示词预设',`提示词与台词格式 ${info('variables','预设变量说明')}`,'<button class="ghost" id="new-preset">＋ 新增预设</button>')+`<div class="form-page"><div class="preset-top"><label class="field"><span>当前预设</span><select id="preset-select">${state.presets.map(item=>`<option value="${item.id}" ${item.id===p.id?'selected':''}>${escapeHtml(item.name)}</option>`).join('')}</select></label><button class="ghost" id="save-as">另存为</button></div><form id="preset-form" novalidate>${presetInjection(p)}<div class="inline-heading"><h3>提示词条目</h3><button type="button" class="text-button" id="add-entry">＋ 增加条目</button></div><div class="prompt-entries">${p.entries.map((entry,i)=>`<article class="prompt-entry" data-entry="${entry.id}"><div class="entry-top"><span class="entry-number">${String(i+1).padStart(2,'0')}</span><label class="entry-toggle"><input type="checkbox" data-entry-enabled="${entry.id}" ${entry.enabled?'checked':''}><span>启用</span></label></div><details ${entry.id===p.openEntry?'open':''}><summary>${escapeHtml(entry.title||'未命名条目')}</summary><div class="entry-body"><label class="field"><span>条目名称</span><input data-entry-title="${entry.id}" value="${escapeHtml(entry.title)}" maxlength="60"></label><label class="field"><span>提示词</span><textarea data-entry-text="${entry.id}" rows="6" spellcheck="false">${escapeHtml(entry.text)}</textarea></label>${entryInjection(entry)}</div></details><div class="entry-actions"><button type="button" class="text-button" data-move-entry="${entry.id}" data-direction="-1" ${i===0?'disabled':''} aria-label="上移第 ${i+1} 条">上移</button><button type="button" class="text-button" data-move-entry="${entry.id}" data-direction="1" ${i===p.entries.length-1?'disabled':''} aria-label="下移第 ${i+1} 条">下移</button><button type="button" class="text-button remove-entry" data-remove-entry="${entry.id}">删除</button></div></article>`).join('')}</div><label class="field"><span>台词格式</span><textarea id="preset-format" class="format-area" rows="3" spellcheck="false">${escapeHtml(p.format)}</textarea></label><p class="error" id="preset-error" role="alert"></p><details class="preview-output"><summary>台词预览</summary><div id="format-preview"></div></details><details class="preview-output"><summary>查看发送内容</summary><div id="injection-plan"></div><pre id="injection-preview"></pre></details><div class="section-actions"><span class="status-text" id="preset-state">${JSON.stringify(savedPreset(p))===JSON.stringify(state.presets.find(item=>item.id===p.id))?'已保存':'未保存'}</span><button class="primary" type="submit">保存预设</button></div></form></div>`;}
function savedPreset(p){const {openEntry,...result}=structuredClone(p);result.prompt=combinedPrompt(result);return result;}
function connectionDraft(key){if(!connectionDrafts.has(key))connectionDrafts.set(key,structuredClone(state.connections[key]));return connectionDrafts.get(key);}
function engineSelect(label,field,options,value){return `<label class="field"><span>${label}</span><select data-connection-field="${field}">${options.map(([id,name])=>`<option value="${id}" ${id===value?'selected':''}>${name}</option>`).join('')}</select></label>`;}
function enginesPage(){
 if(!selectedEngine)return heading('引擎连接',`03 个语音引擎 ${info('key','密钥设置说明')}`)+`<div class="form-page engine-list">${Object.entries(engines).map(([key,e])=>`<button class="engine-link" data-open-engine="${key}" data-engine="${key}"><span class="engine-link-name"><span class="counterpoint" aria-hidden="true"></span>${e.name}<small>${key==='fish'?'官方兼容接口':key==='mini'?'国内 / 国际接口':'官方语音接口'}</small></span><span class="engine-link-end"><span class="connection-status">${checked.has(key)?'音色已读取':'未检查'}</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6"/></svg></span></button>`).join('')}</div>`;
 return engineSettingsPage(selectedEngine);
}

function updatePreview(){
  const p=presetDraft(); const mapping={'{译文}':'雨还没停。再坐一会儿吧。','{角色}':'沈砚','{情绪}':'calm','{文本}':'雨还没停。再坐一会儿吧。'};
  let output=p.format; Object.entries(mapping).forEach(([key,value])=>output=output.split(key).join(value));
  $('#format-preview').textContent=output;$('#injection-plan').innerHTML=injectionPlan(p).map(item=>`<div class="injection-preview-item"><strong>${escapeHtml(item.title)}</strong><span>${injectionPositions[item.position]}${item.depth===null?'':' · 深度 '+item.depth} · ${injectionRoles[item.role]}</span></div>`).join('');
  const languageText=languageRules();
  $('#injection-preview').textContent=p.prompt.replaceAll('{{格式}}',p.format).replaceAll('{{语言}}',languageText);
}
function renderChat(){latest=ST_TTS_HOST.latest();$('#dialogue').innerHTML=latest.lines.length?latest.lines.map((line,i)=>`<article class="line"><div class="line-top"><span>${escapeHtml(line.role)}</span><span>${escapeHtml(line.emotion)}</span></div><div class="line-body"><p>“${escapeHtml(line.translation)}”</p><button class="line-play" data-real-play="${i}" aria-label="播放台词"><span class="play-icon"></span></button></div><details><summary>原文</summary><p>${escapeHtml(line.text)}</p></details></article>`).join(''):'<p class="narration">当前聊天还没有可朗读的台词。</p>';$('#player-count').textContent=latest.lines.length+' 句';$('#play-all').disabled=!latest.lines.length;}
function stopPlayback(){ST_TTS_HOST.stop();}
function openRole(id){if($('#chat-drawer').open)$('#chat-drawer').close();state.selected=id;tab='roles';$('.workspace').classList.add('mobile-edit');render();}
function openName(action){modalAction=action;$('#name-title').textContent=action==='role'?'新增角色':action==='new-preset'?'新增预设':'另存预设';$('#new-name').value='';$('#name-error').textContent='';$('#name-dialog').showModal();$('#new-name').focus();}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.help){const [title,text,source]=helps[button.dataset.help];$('#help-source').hidden=!source;$('#help-source').href=source||'#';$('#help-title').textContent=title;$('#help-text').textContent=text;$('#help-dialog').showModal();}
  if(button.classList.contains('close-dialog'))button.closest('dialog').close();
  if(button.dataset.tab){tab=button.dataset.tab;$('.workspace').classList.remove('mobile-edit');render();}
  if(button.dataset.role)openRole(button.dataset.role);
  if(button.id==='back-roles')$('.workspace').classList.remove('mobile-edit');
  if(button.dataset.selectEngine){const r=draft();if(r.engine!==button.dataset.selectEngine){r.engine=button.dataset.selectEngine;r.model='';r.voice='';render();}}
  if(button.id==='add-role')openName('role');
  if(button.id==='save-as')openName('preset');
  if(button.id==='new-preset')openName('new-preset');
  if(button.id==='add-entry'){const p=presetDraft();const id='entry-'+crypto.randomUUID();p.entries.push({id,title:'新条目',text:'',enabled:true});p.openEntry=id;render();syncPreset();document.querySelector('[data-entry-title="'+id+'"]').focus();}
  if(button.dataset.removeEntry){const p=presetDraft();p.entries=p.entries.filter(e=>e.id!==button.dataset.removeEntry);p.prompt=combinedPrompt(p);render();syncPreset();}
  if(button.dataset.moveEntry){const p=presetDraft();const i=p.entries.findIndex(e=>e.id===button.dataset.moveEntry);const next=i+Number(button.dataset.direction);if(next>=0&&next<p.entries.length){[p.entries[i],p.entries[next]]=[p.entries[next],p.entries[i]];p.prompt=combinedPrompt(p);render();syncPreset();}}
  if(button.dataset.openEngine){selectedEngine=button.dataset.openEngine;render();}
  if(button.id==='back-engines'){selectedEngine=null;render();}
  if(button.dataset.configure)openRole(button.dataset.configure);
  if(button.dataset.realPlay!==undefined)ST_TTS_HOST.play(latest.id,Number(button.dataset.realPlay));
  if(button.id==='play-all'){if(['playing','generating','paused'].includes(phase))ST_TTS_HOST.toggle();else ST_TTS_HOST.play(latest.id);}
  if(button.id==='stop')ST_TTS_HOST.stop();
  if(button.id==='clear-cache'){await ST_TTS_HOST.clearCache();await updateCacheSummary();toast('语音缓存已清理');}
  if(button.id==='audition'){draft().voice=$('#role-voice').value.trim();if(!hasVoice(draft())){$('#role-voice').reportValidity();return;}ST_TTS_HOST.audition(draft());toast('正在准备试听');}
  if(button.dataset.saveKey){const input=$('#engine-key');try{ST_TTS_HOST.setKey(selectedEngine,input.value);input.value='';input.placeholder=ST_TTS_HOST.keyStatus(selectedEngine)?'当前页面已填写':'尚未填写';toast('密钥已更新');}catch(e){toast(e.message);}}
  if(button.dataset.check){button.disabled=true;try{const result=await ST_TTS_HOST.voices(selectedEngine,connectionDraft(selectedEngine));checked.add(selectedEngine);toast(result.note);if(tab==='engines')render();}catch(e){toast(e.message);button.disabled=false;}}
  if(button.id==='load-voices'||button.id==='more-voices'){const r=draft(),more=button.id==='more-voices';button.disabled=true;try{const cursor=more?voiceCursor[r.engine]:null;const query={search:$('#voice-search').value,page:more?(cursor?.page||0)+1:0,token:cursor?.token||''};const result=await ST_TTS_HOST.voices(r.engine,state.connections[r.engine],query);voiceLists[r.engine]=more?[...voiceLists[r.engine],...result.voices]:result.voices;voiceCursor[r.engine]={...result,page:query.page};render();toast(result.note);}catch(e){toast(e.message);button.disabled=false;}}
  if(button.dataset.reveal){const input=button.parentElement.querySelector('input');input.type=input.type==='password'?'text':'password';button.textContent=input.type==='password'?'显示':'隐藏';button.setAttribute('aria-label',`${button.textContent} ${engines[button.dataset.reveal].name} 密钥`);}
});
document.addEventListener('change',event=>{
  if(event.target.id==='floating-enabled'||event.target.id==='waveform-enabled'){state.general[event.target.id==='floating-enabled'?'floatingEnabled':'waveformEnabled']=event.target.checked;persist();render();}
  if(event.target.id==='theme'){state.theme=event.target.value;persist();applyTheme();}
  if(event.target.id==='default-language'){state.general.defaultLanguage=event.target.value;persist();renderChat();}
  if(event.target.id==='cache-enabled'){state.general.cacheEnabled=event.target.checked;persist();renderChat();updateCacheSummary();}

  if(event.target.id==='role-voice'||event.target.id==='role-language'||event.target.id==='role-model'){const r=draft();r.voice=$('#role-voice').value;r.language=$('#role-language').value;r.model=$('#role-model').value;$('#route-state').textContent='未保存';if(event.target.id==='role-model')render();}
  if(event.target.dataset.entryEnabled){const entry=presetDraft().entries.find(e=>e.id===event.target.dataset.entryEnabled);entry.enabled=event.target.checked;syncPreset();}
  if(event.target.dataset.connectionField){const c=connectionDraft(selectedEngine);c[event.target.dataset.connectionField]=event.target.value;TTSParameters.normalize(selectedEngine,c);redrawSettings();}
  if(event.target.id==='preset-select'){state.activePreset=event.target.value;persist();render();}
});
document.addEventListener('input',event=>{const t=event.target;if(t.id==='preset-format'){presetDraft().format=t.value;syncPreset();}if(t.dataset.entryTitle||t.dataset.entryText){const p=presetDraft(),entry=p.entries.find(e=>e.id===(t.dataset.entryTitle||t.dataset.entryText));if(t.dataset.entryTitle){entry.title=t.value;t.closest('details').querySelector('summary').textContent=t.value||'未命名条目';}else entry.text=t.value;syncPreset();}});
function validatePreset(p){return ST_TTS_HOST.validatePreset(p);}
document.addEventListener('submit',event=>{
  if(event.target.id==='role-form'){event.preventDefault();const r=draft();r.voice=$('#role-voice').value;r.language=$('#role-language').value;r.model=$('#role-model').value;if(!hasVoice(r))return;const resume=ST_TTS_HOST.pendingRole()===r.name;state.routes=state.routes.map(role=>role.id===r.id?{...r}:role);persist();if(resume){render();$('#chat-drawer').showModal();ST_TTS_HOST.resume();toast('配音已保存，继续播放');}else{if(phase!=='idle')stopPlayback('配音已更新');render();toast('配音已保存');}}
  if(event.target.id==='connection-form'){event.preventDefault();const c=connectionDraft(selectedEngine);const error=TTSParameters.validate(selectedEngine,c);$('#connection-error').textContent=error;if(error)return;c.format=c.params[selectedEngine==='fish'?'format':selectedEngine==='mini'?'audio_setting.format':'output_format'];state.connections[selectedEngine]=structuredClone(c);if(phase!=='idle')stopPlayback('引擎配置已更新');persist();$('#connection-state').textContent='已保存';toast('引擎配置已保存');}
  if(event.target.id==='preset-form'){event.preventDefault();const p=presetDraft();const error=validatePreset(p);$('#preset-error').textContent=error;if(error)return;state.presets=state.presets.map(item=>item.id===p.id?savedPreset(p):item);persist();render();toast('预设已保存');}
});
$('#name-form').addEventListener('submit',event=>{
  event.preventDefault();const name=$('#new-name').value.trim();if(!name){$('#name-error').textContent='请输入名称';return;}
  const items=modalAction==='role'?state.routes:state.presets;if(items.some(item=>item.name===name)){$('#name-error').textContent='这个名称已存在';return;}
  if(modalAction==='role'){const id='role-'+Date.now();state.routes.push({id,name,engine:'fish',voice:'',language:''});state.selected=id;drafts.delete(id);tab='roles';$('.workspace').classList.add('mobile-edit');}
  else{const p=modalAction==='new-preset'?{injection:{...injectionDefaults},entries:[{id:'entry-'+crypto.randomUUID(),title:'台词生成规则',text:originalPrompt,enabled:true}],format:defaultFormat}:presetDraft();const error=validatePreset(p);if(error){$('#name-error').textContent=error;return;}const id='preset-'+crypto.randomUUID();state.presets.push({...savedPreset(p),id,name});state.activePreset=id;}
  persist();$('#name-dialog').close();render();toast(modalAction==='role'?'角色已添加':modalAction==='new-preset'?'预设已新增':'预设已另存');
});
function pauseChat(){if(['playing','generating'].includes(phase))ST_TTS_HOST.toggle();}
$('#show-chat').addEventListener('click',()=>{renderChat();$('#chat-drawer').showModal();});
$('#close-chat').addEventListener('click',()=>{pauseChat();$('#chat-drawer').close();});
$('#chat-drawer').addEventListener('cancel',pauseChat);
$('#close-settings').addEventListener('click',()=>ST_TTS_HOST.close());
window.stTtsUpdate=value=>{phase=value.phase;$('#stop').disabled=['idle','error'].includes(phase);$('#progress-fill').style.width=value.total?Math.round(value.index/value.total*100)+'%':'0%';renderChat();$('#player-status').textContent=value.message;$('#play-all').textContent=['playing','generating'].includes(phase)?'暂停':phase==='paused'?'继续播放':'整条播放';updateCacheSummary();if(phase==='error')toast(value.message);};
window.stTtsOpenRole=id=>{state=ST_TTS_HOST.getState();drafts.clear();openRole(id);};

Object.assign(helps,{
 'floating':['悬浮播放器','拖动圆球选择位置，松手后吸附到左右边缘，闲置时收成一小条。点击直接打开插件设置。整条播放、暂停和停止位于插件入口与「听见这一刻」。音波跟随实际音频；关闭动效或开启系统减少动态效果后保持静态。关闭悬浮播放器不影响聊天里的播放按钮。'],
 'cache-settings':['语音缓存','音频保存在这台设备的浏览器中，最多约 200 MB，按保存时间清理旧段。关闭复用不会删除现有缓存；手动清理会停止当前播放。账户和浏览器不同，缓存互不共用。'],
 'key':['引擎密钥','密钥仅留在当前页面内存，刷新后需重新填写。点击播放会把台词与声音设置发送给对应引擎，并可能消耗账户额度。'],
 'chat':['聊天播放','点击一句或整条播放。遇到未配音角色，选好音色并保存后继续。此处显示当前聊天最新一条带语音标签的回复。'],
 'preview':['台词格式','四个字段各出现一次，字段之间和首尾都需要固定分隔符。字段中的分隔文字使用 HTML 实体转义。'],
 'capabilities':['表达能力','提示词按角色引擎与模型附加规则。模型表达效果还取决于音色和台词内容。MiniMax 的 fluent、whisper 使用 2.6 系列；语气词标签使用 2.8 系列。'],
 'transport-mini':['MiniMax 请求通道','使用所选区域的官方 HTTP 接口。流式返回会收齐音频再播放。','https://platform.minimax.io/docs/api-reference/speech-t2a-http'],
 'transport-eleven':['ElevenLabs 请求通道','使用官方接口直连，音频格式等选项作为查询参数发送。账户能力及网络可达性决定实际可用范围。','https://elevenlabs.io/docs/api-reference/text-to-speech/convert'],
 'language':['台词语言','影响后续生成的台词语言。已有台词保留原文。实际语言支持由引擎、模型和音色决定。']
});
if(ST_TTS_HOST.pendingRole()){$('.workspace').classList.add('mobile-edit');}
window.stTtsUpdate(ST_TTS_HOST.status());
applyTheme();render();
