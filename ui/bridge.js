'use strict';
const ST_TTS_HOST=parent.__stTtsPanelBridge.connect(window);
window.addEventListener('unhandledrejection',e=>{e.preventDefault();const el=document.querySelector('#toast');if(el){el.textContent=e.reason?.message||'操作未完成';el.classList.add('show');}});
