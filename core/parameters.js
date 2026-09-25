'use strict';
// Official TTS parameter snapshot: 2026-09-25. See research/engine-parameters/README.md.

const n=(key,label,value,min,max,step=.01,help='')=>({key,label,type:'number',value,min,max,step,help});
const s=(key,label,value,options,help='')=>({key,label,type:'select',value,options:options.map(o=>Array.isArray(o)?o:[o,o]),help});
const b=(key,label,value,help='')=>({key,label,type:'boolean',value,help});
const t=(key,label,help='',type='text')=>({key,label,type,value:'',help});
const rows=(key,label,columns,max,help='')=>({key,label,type:'rows',value:[],columns,max,help});
const group=(id,title,fields)=>({id,title,fields});
const refs=(key,label,id,version,optional=false)=>rows(key,label,[t(id,'词典 ID'),{...t(version,'版本 ID'),optional}],3,'最多三份，按添加顺序应用。');
const fish={model:'s2.1-pro',models:['s2.1-pro','s2.1-pro-free','s2-pro','s1','drama-3-preview'],source:'https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech',groups:[
 group('common','常用设置',[n('prosody.speed','语速',1,.5,2,.05),n('prosody.volume','音量 · dB',0,undefined,undefined,.5,'0 保持原音量；官网未规定上下限。'),b('prosody.normalize_loudness','统一响度',true,'S2 系列有效；s1 接收但不生效。预览模型尚待核验。'),n('temperature','表现变化',.7,0,1,.05,'数值越高，表现越多变。'),n('top_p','采样多样性',.7,0,1,.05)]),
 group('audio','音频输出',[s('format','音频格式','mp3',['mp3','wav','pcm','opus']),s('sample_rate','采样率',44100,[8000,16000,24000,32000,44100,48000]),s('mp3_bitrate','MP3 码率 · kbps',128,[64,128,192]),s('opus_bitrate','Opus 码率 · bps',-1000,[[-1000,'自动'],24000,32000,48000,64000],'兼容接口文档称 Opus 码率自动选择；原生字段是否覆盖需实测，当前请求省略。')]),
 group('generation','更多生成参数',[s('latency','延迟模式','normal',[['normal','质量优先'],['balanced','均衡'],['low','低延迟']]),n('chunk_length','分段长度',300,100,300,1),n('min_chunk_length','最小分段长度',50,0,100,1),n('max_new_tokens','每段生成上限',1024,undefined,undefined,1,'官网未规定上下限。'),n('repetition_penalty','重复惩罚',1.2,undefined,undefined,.05),n('early_stop_threshold','提前结束阈值',1,0,1,.05),b('normalize','规范数字与文字读法',true),b('condition_on_previous_chunks','沿用前段声音上下文',true),t('features','功能标记','每行一个，例如 quality-guard；是否生效由 Fish 后端决定。','lines')]),
 group('dictionary','发音词典',[s('dictionary_mode','词典方式','references',[['references','平台词典'],['inline','直接填写发音']]),refs('pronunciation_dictionary','平台词典','id','version'),rows('inline_dictionary','发音条目',[t('key','原词'),t('value','发音'),b('case_sensitive','区分大小写',false)],5000,'直接词典与平台词典二选一。')]),
 group('reference','参考音频',[rows('references','参考音频与原文',[{...t('audio','音频文件'),type:'file'},t('text','音频原文')],10,'替代角色音色 ID。文件暂存在当前页面，点击播放时以 Base64 发送。刷新后需要重新选择文件。')])
]};
const miniLanguages=['auto','Chinese','Chinese,Yue','English','Arabic','Russian','Spanish','French','Portuguese','German','Turkish','Dutch','Ukrainian','Vietnamese','Indonesian','Japanese','Italian','Korean','Thai','Polish','Romanian','Greek','Czech','Finnish','Hindi','Bulgarian','Danish','Hebrew','Malay','Persian','Slovak','Swedish','Croatian','Filipino','Hungarian','Norwegian','Slovenian','Catalan','Nynorsk','Tamil','Afrikaans'];
const mini={model:'speech-2.8-hd',models:['speech-2.8-hd','speech-2.8-turbo','speech-2.6-hd','speech-2.6-turbo','speech-02-hd','speech-02-turbo','speech-01-hd','speech-01-turbo'],source:'https://platform.minimax.io/docs/api-reference/speech-t2a-http',groups:[
 group('common','常用设置',[n('voice_setting.speed','语速',1,.5,2,.05),n('voice_setting.vol','音量',1,.01,10,.01,'官网范围大于 0 且不超过 10。'),n('voice_setting.pitch','音高',0,-12,12,1),s('voice_setting.emotion','情绪','',[['','跟随台词'],...['happy','sad','angry','fearful','disgusted','surprised','calm','fluent','whisper']],'fluent、whisper 按当前文档仅列为 2.6 系列支持。固定选择会覆盖台词情绪。')]),
 group('audio','音频输出',[s('audio_setting.format','音频格式','mp3',['mp3','pcm','flac','wav','pcmu_raw','pcmu_wav','opus']),s('audio_setting.sample_rate','采样率',32000,[8000,16000,22050,24000,32000,44100]),s('audio_setting.bitrate','MP3 码率 · bps',128000,[32000,64000,128000,256000]),s('audio_setting.channel','声道',1,[[1,'单声道'],[2,'双声道']]),b('audio_setting.force_cbr','恒定码率',false,'仅流式 MP3 输出有效。')]),
 group('effects','声音效果',[n('voice_modify.pitch','低沉 / 明亮',0,-100,100,1),n('voice_modify.intensity','强劲 / 柔和',0,-100,100,1),n('voice_modify.timbre','浑厚 / 清脆',0,-100,100,1),s('voice_modify.sound_effects','环境效果','',[['','无'],['spacious_echo','空旷回声'],['auditorium_echo','礼堂回声'],['lofi_telephone','电话音效'],['robotic','机器人']])]),
 group('language','语言与发音',[s('language_boost','语言增强','auto',miniLanguages),b('voice_setting.text_normalization','规范数字与文字读法',false),b('voice_setting.latex_read','朗读 LaTeX 公式',false,'开启后语言增强固定为中文。'),t('pronunciation_dict.tone','自定义读音','每行一条 原文/读法，例如 处理/(chu3)(li3)。','lines')]),
 group('stream','流式与字幕',[b('stream','流式输出',false),b('stream_options.exclude_aggregated_audio','末块省略完整音频',false),s('output_format','返回方式','hex',[['hex','音频数据'],['url','下载链接']],'流式仅支持音频数据；链接有效期 24 小时。'),b('subtitle_enable','生成字幕',false),s('subtitle_type','字幕粒度','sentence',[['sentence','按句'],['word','按词'],['word_streaming','按词 · 流式']])]),
 group('mix','混合音色',[rows('timbre_weights','音色权重',[t('voice_id','音色 ID'),n('weight','权重',50,1,100,1)],4,'官网标为旧版字段；设置混合音色时，voice_id 留空。最多四个音色。')])
]};
const formats=['mp3_44100_128','alaw_8000','mp3_22050_32','mp3_24000_48','mp3_44100_192','mp3_44100_32','mp3_44100_64','mp3_44100_96','opus_48000_128','opus_48000_192','opus_48000_32','opus_48000_64','opus_48000_96','pcm_16000','pcm_22050','pcm_24000','pcm_32000','pcm_44100','pcm_48000','pcm_8000','ulaw_8000','wav_16000','wav_22050','wav_24000','wav_32000','wav_44100','wav_48000','wav_8000'];
const eleven={model:'eleven_v3',models:['eleven_v3','eleven_multilingual_v2','eleven_flash_v2_5','eleven_flash_v2','eleven_turbo_v2_5','eleven_turbo_v2','eleven_v3_conversational'],source:'https://elevenlabs.io/docs/api-reference/text-to-speech/convert',groups:[
 group('common','常用设置',[n('voice_settings.stability','稳定性',.5,0,1,.05),n('voice_settings.speed','语速',1,.7,1.2,.05,'官网产品页建议 0.7–1.2；通用 REST 结构未给范围，官方技能另列 0.25–4。当前按产品页范围提供。v3 产品页标为不支持。'),n('voice_settings.similarity_boost','音色相似度',.75,0,1,.05),n('voice_settings.style','风格强度',0,0,1,.05),b('voice_settings.use_speaker_boost','增强原声特征',true)]),
 group('audio','音频输出',[s('output_format','音频格式','mp3_44100_128',formats,'MP3 192 kbps 需要 Creator 或更高；PCM/WAV 44.1 kHz 需要 Pro 或更高，仍以账户可用能力为准。')]),
 group('language','语言与文字',[t('language_code','语言代码','留空跟随角色语言。使用 ISO 639-1 代码，如 zh、en、ja；Multilingual v2 不支持。'),s('apply_text_normalization','文字规范化','auto',[['auto','自动'],['on','开启'],['off','关闭']]),b('apply_language_text_normalization','日语读法规范化',false,'当前仅日语；会增加生成延迟。')]),
 group('continuity','前后文与随机性',[n('seed','随机种子','',0,4294967295,1,'留空自动；相同种子也不保证完全相同结果。'),t('previous_text','前文','连续合成的上一段文本。','textarea'),t('next_text','后文','连续合成的下一段文本。','textarea'),t('previous_request_ids','前段请求 ID','每行一个，最多三个；设置后优先于前文。','lines'),t('next_request_ids','后段请求 ID','每行一个，最多三个；设置后优先于后文。','lines')]),
 group('dictionary','发音词典',[refs('pronunciation_dictionary_locators','平台词典','pronunciation_dictionary_id','version_id',true)]),
 group('request','请求选项',[b('enable_logging','保留生成记录',true,'关闭为零保留模式，仅 Enterprise 账户可用；不能用于前后请求拼接。'),s('optimize_streaming_latency','延迟优化（旧版）','',[['','默认'],[0,'0 · 关闭'],[1,'1 · 普通'],[2,'2 · 较强'],[3,'3 · 最大'],[4,'4 · 最大并关闭文字规范化']],'官网已弃用，保留为可选旧版参数。'),b('use_pvc_as_ivc','使用即时克隆版本（旧版）',false,'官网已弃用的临时选项。')])
]};
const catalogs={fish,mini,eleven};
function defaults(key){return Object.fromEntries(catalogs[key].groups.flatMap(g=>g.fields.map(f=>[f.key,structuredClone(f.value)])));}
function allowed(key,field,c){let list=field.options||[];const p=c.params;
 if(key==='fish'&&field.key==='sample_rate'){const rates=p.format==='mp3'?[32000,44100]:p.format==='opus'?[48000]:[8000,16000,24000,32000,44100];list=list.filter(([v])=>rates.includes(v));}
 if(key==='mini'&&field.key==='voice_setting.emotion'&&!c.model.startsWith('speech-2.6'))list=list.filter(([v])=>!['fluent','whisper'].includes(v));
 if(key==='mini'&&field.key==='language_boost'&&/^speech-0/.test(c.model))list=list.filter(([v])=>!['Persian','Filipino','Tamil'].includes(v));
 if(key==='mini'&&field.key==='audio_setting.sample_rate'&&p['audio_setting.format'].startsWith('pcmu'))list=list.filter(([v])=>v===8000);
 if(key==='mini'&&field.key==='output_format'&&p.stream)list=list.filter(([v])=>v==='hex');
 if(key==='mini'&&field.key==='subtitle_type'&&!p.stream)list=list.filter(([v])=>v!=='word_streaming');
 return list;
}
function unavailable(key,f,c){const p=c.params,k=f.key;
 if(key==='fish'){
  if(k==='prosody.normalize_loudness'&&!c.model.startsWith('s2'))return '该模型未确认支持响度统一。';
  if(k==='mp3_bitrate'&&p.format!=='mp3')return '仅 MP3 使用。';
  if(k==='opus_bitrate')return '兼容通道按自动码率输出，原生码率覆盖尚待实测。';
  if(k==='pronunciation_dictionary'&&p.dictionary_mode!=='references')return '当前使用直接发音条目。';
  if(k==='inline_dictionary'&&p.dictionary_mode!=='inline')return '当前使用平台词典。';
 }
 if(key==='mini'){
  if(k==='audio_setting.bitrate'&&p['audio_setting.format']!=='mp3')return '仅 MP3 使用。';
  if(k==='audio_setting.force_cbr'&&(!p.stream||p['audio_setting.format']!=='mp3'))return '仅流式 MP3 使用。';
  if(k==='stream_options.exclude_aggregated_audio'&&!p.stream)return '开启流式输出后可选。';
  if(k==='subtitle_type'&&!p.subtitle_enable)return '开启字幕后可选。';
  if(k==='language_boost'&&p['voice_setting.latex_read'])return '公式朗读会固定使用中文。';
  if(k.startsWith('voice_modify.')&&!(p.stream?p['audio_setting.format']==='mp3':['mp3','wav','flac'].includes(p['audio_setting.format'])))return '音效支持非流式 MP3/WAV/FLAC，或流式 MP3。';
 }
 if(key==='eleven'){
  if(k.startsWith('voice_settings.')&&k!=='voice_settings.stability'&&c.model.startsWith('eleven_v3'))return '按 v3 产品页与专用参数结构，此项不作为已支持参数发送。';
  if(['voice_settings.style','voice_settings.use_speaker_boost'].includes(k)&&c.model.includes('flash'))return 'Flash 专用声音结构未列此项，需账户能力核验。';
  if(k==='language_code'&&c.model==='eleven_multilingual_v2')return 'Multilingual v2 不支持强制语言代码。';
  if(['previous_request_ids','next_request_ids'].includes(k)&&!p.enable_logging)return '关闭生成记录后无法使用请求拼接。';
 }
 return '';
}
function normalize(key,c){for(const f of catalogs[key].groups.flatMap(g=>g.fields)){if(f.type==='select'){const opts=allowed(key,f,c);if(!opts.some(([v])=>v===c.params[f.key]))c.params[f.key]=opts.find(([v])=>v===f.value)?.[0]??opts[0]?.[0];}}if(key==='mini'&&c.params['voice_setting.latex_read'])c.params.language_boost='Chinese';}
function activeParameters(key,c){const out={};for(const f of catalogs[key].groups.flatMap(g=>g.fields)){if(unavailable(key,f,c))continue;const v=c.params[f.key];if(v===''||v===undefined||Array.isArray(v)&&!v.length)continue;out[f.key]=structuredClone(v);}return out;}
function setPath(target,key,value){const parts=key.split('.');let node=target;for(const part of parts.slice(0,-1))node=node[part]??=( {} );node[parts.at(-1)]=value;}
function requestPreview(key,c,voice='角色音色 ID',text='雨还没停。再坐一会儿吧。',model=c.model){c=structuredClone(c);c.model=model;normalize(key,c);const values=activeParameters(key,c);let body={},query={};for(let [k,v] of Object.entries(values)){if(['dictionary_mode','inline_dictionary'].includes(k))continue;if(key==='eleven'&&['output_format','enable_logging','optimize_streaming_latency'].includes(k)){query[k]=v;continue;}const f=catalogs[key].groups.flatMap(g=>g.fields).find(f=>f.key===k);if(f?.type==='lines')v=String(v).split('\n').map(x=>x.trim()).filter(Boolean);setPath(body,k,v);}
 if(key==='fish'){if(c.params.dictionary_mode==='inline'&&c.params.inline_dictionary.length)body.pronunciation_dictionary=[{items:c.params.inline_dictionary}];if(body.references)body.references=body.references.map(r=>({audio:'[本机会话文件：'+r.audio+']',text:r.text}));const format=body.format;delete body.format;return {url:'https://api.fish.audio/compat/v1/audio/speech',body:{model:'fish-audio/'+model,input:text,voice:body.references?'':voice,response_format:format,provider:{options:{'fish-audio':body}}}};}
 if(key==='mini'){body.model=model;body.text=text;body.voice_setting??={};body.voice_setting.voice_id=body.timbre_weights?.length?'':voice;return {url:'https://'+(c.region==='cn'?'api.minimaxi.com':c.region==='uw'?'api-uw.minimax.io':'api.minimax.io')+'/v1/t2a_v2',body};}
 body.model_id=model;body.text=text;return {url:'https://api.elevenlabs.io/v1/text-to-speech/'+encodeURIComponent(voice),query,body};
}
function validate(key,c){for(const f of catalogs[key].groups.flatMap(g=>g.fields)){if(unavailable(key,f,c))continue;const v=c.params[f.key];if(f.type==='number'&&v!==''){if(!Number.isFinite(v)||f.min!==undefined&&v<f.min||f.max!==undefined&&v>f.max||f.step===1&&!Number.isInteger(v))return f.label+'数值无效';}if(f.type==='rows'){if(v.length>f.max)return f.label+'条目过多';for(const row of v)for(const col of f.columns){const x=row[col.key];if(!col.optional&&col.type!=='boolean'&&(x===undefined||String(x).trim()===''))return f.label+'：请填写'+col.label;if(col.type==='number'&&(!Number.isFinite(x)||x<col.min||x>col.max||!Number.isInteger(x)))return f.label+'：'+col.label+'数值无效';}}if(['previous_request_ids','next_request_ids'].includes(f.key)&&String(v).split('\n').filter(x=>x.trim()).length>3)return f.label+'最多三个';}return '';}
function tags(key,model){return key==='mini'?['happy','sad','angry','fearful','disgusted','surprised','calm',...(model.startsWith('speech-2.6')?['fluent','whisper']:[])]:key==='eleven'?(model.startsWith('eleven_v3')?['whispers','laughs','sighs']:['通过文本表达情绪']):['情绪标签','声音标签'];}
export const TTSParameters={catalogs,defaults,allowed,unavailable,normalize,activeParameters,requestPreview,validate,tags};
