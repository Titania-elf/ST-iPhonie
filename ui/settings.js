import {createView,esc,btn,field,input,select,toggle,heading,size,languageField,languageOptions} from './common.js';
import {icon,names} from './icons.js';
export const wallpapers={
 sky:{name:'晴空',ink:'#263850',background:'radial-gradient(ellipse at 12% 8%,#f7f4ef 0%,#f7f4ef00 53%),radial-gradient(ellipse at 95% 38%,#b5cbe6 0%,#b5cbe600 60%),linear-gradient(155deg,#dce7f4,#d0dff2 50%,#e9d9d1)'},
 silver:{name:'银雾',ink:'#29313d',background:'radial-gradient(ellipse at 20% 15%,#fff,#ffffff00 60%),linear-gradient(145deg,#d4d9e1,#c1c7d0 60%,#e1dce2)'},
 midnight:{name:'午夜',ink:'#f4f4f8',background:'radial-gradient(ellipse at 75% 20%,#455e85,#455e8500 60%),linear-gradient(140deg,#141d31,#283146 65%,#494258)'},
 rose:{name:'玫瑰',ink:'#493640',background:'radial-gradient(ellipse at 20% 15%,#fff5ed,#fff5ed00 60%),linear-gradient(155deg,#f3d9d7,#d9bfd4 65%,#ebdae4)'},
 sand:{name:'暖砂',ink:'#443930',background:'radial-gradient(ellipse at 20% 15%,#fff8e8,#fff8e800 60%),linear-gradient(145deg,#e9dcc6,#cdbfad 65%,#e8d4c5)'}
};
export function settingsApp(ctx){
 const {api}=ctx,v=createView(ctx,'settings');let appearance=null,epoch=0;
 async function render(){const ticket=++epoch;
  if(appearance){const d=appearance;v.draw(heading('壁纸与图标')+'<div class="group pad"><h3>壁纸</h3><div class="wallpaper-options">'+Object.entries(wallpapers).map(([key,w])=>`<button class="wallpaper-choice" data-action="wallpaper" data-key="${key}" aria-pressed="${d.wallpaper.kind==='builtin'&&d.wallpaper.key===key}"><span style="background:${w.background}"></span><small>${w.name}</small></button>`).join('')+`</div><div class="actions"><label class="secondary file-button">选择本地壁纸<input type="file" data-personal-file="wallpaper" aria-label="选择本地壁纸" accept="image/png,image/jpeg,image/webp,image/avif,image/gif"></label></div>${d.wallpaper.kind==='photo'?'<small>已选择自定义照片</small>':''}${field('图标外观',select('iconStyle',d.iconStyle,[['color','彩色'],['glass','玻璃'],['mono','单色']]))}</div><div class="group pad"><h3>应用图标</h3>${Object.entries(names).map(([app,name])=>`<div class="icon-settings-row"><strong>${name}</strong>${field('图标',select('glyph',d.icons[app]?.kind==='glyph'?d.icons[app].key:'default',api.phoneCatalog.glyphs.map(key=>[key,names[key]||({default:'默认',wave:'声波',book:'书本',music:'音乐',camera:'相机',sliders:'滑块',note:'便笺',person:'人物',microphone:'麦克风',star:'星形',headphones:'耳机'})[key]||key]),`data-icon-app="${app}"`))}<label class="secondary file-button">${d.icons[app]?.kind==='photo'?'更换图标图片':'选择图标图片'}<input type="file" data-personal-file="icon" data-app="${app}" aria-label="${name}图标图片" accept="image/png,image/jpeg,image/webp,image/avif,image/gif"></label></div>`).join('')}</div><div class="savebar">${btn('cancel-appearance','取消','secondary')}${btn('save-appearance','应用','primary')}</div>`);return;}
  const [phone,cache,library]=await Promise.all([api.getPhone(),api.cacheStats(),api.libraryStats().catch(()=>null)]);if(v.disposed||ticket!==epoch)return;const s=api.getState();
  v.draw(heading('设置')+`<div class="group pad">${languageField('defaultLanguage',s.general.defaultLanguage,false)}${languageOptions()}${field('显示主题',select('theme',phone.theme,[['system','跟随系统'],['light','日间'],['dark','夜间']]))}</div><div class="group">${toggle('floatingEnabled','悬浮入口',s.general.floatingEnabled)}${toggle('waveformEnabled','声波动效',s.general.waveformEnabled)}${toggle('lockOnOpen','打开时显示锁屏',phone.lockOnOpen,'锁屏可随时跳过，是插件内的外观，不是手机安全锁。')}<button class="list-row" data-action="appearance"><span><strong>壁纸与图标</strong><small>${phone.wallpaper.kind==='builtin'?wallpapers[phone.wallpaper.key]?.name:'自定义照片'}</small></span>${icon('next')}</button><button class="list-row" data-action="lock"><span><strong>查看锁屏</strong></span>${icon('lock')}</button></div><div class="group pad"><div class="meter-label"><span>播放音量</span><output>${Math.round(phone.volume*100)}%</output></div><input class="slider" type="range" data-field="volume" min="0" max="100" value="${Math.round(phone.volume*100)}" aria-label="播放音量"></div><div class="group">${toggle('cacheEnabled','保存语音缓存',s.general.cacheEnabled,'已生成的音频用于重播。清缓存不会删除收藏、相册、备忘录或参考音频。')}<div class="setting-row"><span>语音缓存</span><small>${cache.available?cache.count+' 段 · '+size(cache.bytes):'本地缓存不可用'}</small></div><div class="setting-row"><span>本地资料</span><small>${library?size(library.bytes)+' / '+size(library.limit):'无法读取'}</small></div></div><div class="actions">${btn('clear-cache','清理语音缓存','danger')}</div><div class="actions">${btn('about','关于 ST-TTS','text-button')}</div>`);
 }
 v.back=()=>{if(!appearance)return false;appearance=null;render().catch(e=>ctx.notify(e.message));return true;};v.refresh=()=>{if(!appearance)return render();};
 v.on('input','[data-field=volume]',el=>{el.previousElementSibling.querySelector('output').textContent=el.value+'%';});
 v.on('change','[data-field]',async el=>{const key=el.dataset.field;
  if(appearance){if(key==='iconStyle')appearance.iconStyle=el.value;if(key==='glyph')appearance.icons[el.dataset.iconApp]=el.value==='default'?null:{kind:'glyph',key:el.value};return;}
  if(['floatingEnabled','waveformEnabled','cacheEnabled'].includes(key))api.updateGeneral({[key]:el.checked});
  else if(key==='defaultLanguage')api.updateGeneral({defaultLanguage:el.value});
  else if(key==='theme')await api.savePhone({theme:el.value});
  else if(key==='volume')await api.setVolume(Number(el.value)/100);
  else if(key==='lockOnOpen')await api.savePhone({lockOnOpen:el.checked});
 });
 v.on('change','[data-personal-file]',async el=>{const file=el.files?.[0],target=appearance;if(!file||!target)return;el.disabled=true;try{const photo=await api.addPhoto({name:file.name,blob:file});if(appearance!==target)return;if(el.dataset.personalFile==='wallpaper')target.wallpaper={kind:'photo',photoId:photo.id};else target.icons[el.dataset.app]={kind:'photo',photoId:photo.id};await render();}finally{if(el.isConnected){el.disabled=false;el.value='';}}});
 v.on('click','[data-action]',async el=>{switch(el.dataset.action){
  case 'appearance':{const p=await api.getPhone();appearance={wallpaper:p.wallpaper,icons:p.icons,iconStyle:p.iconStyle};await render();break;}
  case 'wallpaper':appearance.wallpaper={kind:'builtin',key:el.dataset.key};await render();break;
  case 'cancel-appearance':appearance=null;await render();break;
  case 'save-appearance':await v.busy(el,async()=>{await api.savePhone(appearance);appearance=null;await render();ctx.notify('外观已应用');});break;
  case 'lock':ctx.lock();break;
  case 'clear-cache':if(await ctx.confirm('清理语音缓存？','正在播放的音频会停止，收藏和其他资料会保留。')){await v.busy(el,()=>api.clearCache());await render();ctx.notify('语音缓存已清理');}break;
  case 'about':ctx.help('ST-TTS 0.2.0\n角色对白 · 随身配音\n\n密钥和本地资料保存在当前浏览器与酒馆地址。状态栏的信号和电量是装饰。语音仅在你点击播放或试听后生成。');break;
 }});render().catch(e=>ctx.notify(e.message));return v;
}