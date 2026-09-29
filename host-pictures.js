// In-chat pictures: fills the placeholders left by <img>…</img> tags, generates them with NovelAI,
// uploads the result to the tavern's image folder and remembers it on the message (message.extra.sttts_pics),
// so every device that opens the chat sees the same picture.
//
// Each tag keeps every version it was drawn in: {versions: [{url, seed, width, height, …}], index}.
// Redrawing adds a version (the old ones stay for comparison); deleting removes the shown version and its file.
// When the last version is deleted the record becomes {removed: true, versions: []}, so it is not drawn again
// automatically. Older records ({url, seed, …}) read as a single version.
import {parsePictures, pictureInputs} from './core/draw.js';
import {openImageViewer} from './image-viewer.js';
import {TIER_NAMES} from './core/novelai.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const versionsOf = record => !record ? [] : Array.isArray(record.versions) ? record.versions : record.url ? [{...record}] : [];

export function createPictureHost({context, settings, backend, marker, scheduleRender, openDraw, notice}) {
  const jobs = new Map(); // queue key -> {state: 'generating'|'error', message}
  const folds = new Map(); // `${id}:${hash}` -> true/false, this session's fold choice per picture

  const stored = (message, hash) => message?.extra?.sttts_pics?.[hash] || null;
  /** The version on screen, with its position: {…version, index, count}; null when there is none. */
  function shown(message, hash) {
    const record = stored(message, hash), list = versionsOf(record);
    if (!list.length) return null;
    const index = Math.min(list.length - 1, Math.max(0, Number.isInteger(record.index) ? record.index : list.length - 1));
    return {...list[index], index, count: list.length};
  }
  function keep(message, hash, list, index) {
    message.extra ??= {};
    message.extra.sttts_pics ??= {};
    message.extra.sttts_pics[hash] = list.length ? {versions: list, index: Math.min(list.length - 1, Math.max(0, index))} : {removed: true, versions: [], at: Date.now()};
  }
  const jobKey = (id, tag) => `pic:${context()?.chatId ?? ''}:${id}:${tag.hash}`;
  const saveSoon = () => (context().saveChatDebounced || context().saveChat)?.();

  // The queue changes often (positions, retry countdowns): redraw the placeholders when it does.
  backend.subscribe?.(event => { if (event.type === 'draw' && event.queue) scheduleRender(); });

  async function upload(blob, name) {
    const ctx = context();
    const base64 = await backend.base64(blob);
    const response = await fetch('/api/images/upload', {
      method: 'POST', headers: ctx.getRequestHeaders(),
      body: JSON.stringify({image: base64, format: 'png', ch_name: ctx.name2 || 'ST-iPhonie', filename: String(name).replace(/\./g, '_')})
    });
    if (!response.ok) throw Error('图片已生成，但上传到酒馆失败（' + response.status + '）');
    return (await response.json()).path;
  }
  /** Deletes a picture file from the tavern's image folder. A file that is already gone counts as deleted. */
  async function removeFile(url) {
    if (!url) return;
    const response = await fetch('/api/images/delete', {method: 'POST', headers: context().getRequestHeaders(), body: JSON.stringify({path: url})});
    if (!response.ok && response.status !== 404) throw Error('没能从酒馆删除图片文件（' + response.status + '）');
  }

  /** Asks before spending Anlas. Returns 'free', 'paid' or false (declined, or no key). */
  async function allowed(interactive) {
    if (!backend.keyStatus('nai')) { if (interactive) notice('还没有填写 NovelAI 密钥，请在小手机的引擎卡包里填写'); return false; }
    try { await backend.naiSubscription(); } catch (error) { if (interactive) notice(error.message); }
    const quote = backend.drawQuote();
    if (quote.free === true) return 'free';
    if (!interactive) return false;
    const why = quote.free === null ? '暂时读不到 NovelAI 订阅信息，无法确认是否免费。' : '按当前参数和订阅，这张图会扣 Anlas。';
    return globalThis.confirm(why + '\n确定要生成吗？') ? 'paid' : false;
  }

  /** Queues one picture. Redrawing adds a version; the earlier versions stay. */
  async function generate(id, tag, {interactive = false, permission = null} = {}) {
    const ctx = context(), message = ctx.chat[id], key = jobKey(id, tag);
    if (!message || jobs.get(key)?.state === 'generating') return;
    permission ??= await allowed(interactive);
    if (!permission) return;
    jobs.set(key, {state: 'generating'});
    scheduleRender();
    try {
      const inputs = pictureInputs(settings(), tag, message.mes);
      const result = await backend.generateImage({...inputs, allowPaid: permission === 'paid', name: 'chat', key, label: '正文图片 · ' + tag.prompt.slice(0, 24)});
      const url = await upload(result.blob, 'st-iphonie-' + Date.now());
      // Only store the picture when the same message is still there with this tag.
      const now = context().chat[id];
      if (now === message && parsePictures(now.mes).some(t => t.hash === tag.hash)) {
        const list = versionsOf(stored(now, tag.hash));
        list.push({url, seed: result.seed, width: result.params.width, height: result.params.height, model: result.params.model, steps: result.params.steps, prompt: tag.prompt, characters: inputs.names, at: Date.now()});
        keep(now, tag.hash, list, list.length - 1);
        await context().saveChat();
      }
      jobs.delete(key);
    } catch (error) {
      if (error.cancelled) jobs.delete(key); else jobs.set(key, {state: 'error', message: error.message});
    }
    scheduleRender();
  }

  /** Called after a new reply is rendered: queues all its pictures when automatic drawing is on and free. */
  async function autoPictures(id) {
    const s = settings();
    if (!s.draw.enabled || !s.draw.auto) return;
    const message = context().chat[id];
    if (!message || message.is_user || message.is_system) return;
    const tags = parsePictures(message.mes).filter(tag => !stored(message, tag.hash));
    if (!tags.length) return;
    const permission = await allowed(false);
    if (!permission) { scheduleRender(); return; }
    await Promise.all(tags.map(tag => generate(id, tag, {permission})));
  }

  /** What the queue says about a job, for the placeholder. */
  function queueText(key) {
    const job = backend.drawQueue?.get?.(key);
    if (!job) return 'NovelAI 正在画……';
    if (job.state === 'running') return job.attempt ? `NovelAI 正在画……（第 ${job.attempt + 1} 次尝试）` : 'NovelAI 正在画……';
    if (job.state === 'busy') return `NovelAI 账号正忙，稍后自动重试（第 ${job.attempt} 次）`;
    if (job.state === 'spacing') return '排队中，马上开始';
    return `排队中，前面还有 ${job.position} 张`;
  }

  function frame(inner) { return `<span class="sttts-pic-frame">${inner}</span>`; }
  function fill(el, id, message, tag) {
    const record = stored(message, tag.hash), pic = shown(message, tag.hash), key = jobKey(id, tag), job = jobs.get(key);
    const s = settings(), folded = folds.get(id + ':' + tag.hash) ?? s.draw.fold;
    const state = job?.state || (pic ? 'done' : record?.removed ? 'removed' : 'idle');
    const waiting = state === 'generating' ? queueText(key) : '';
    const signature = [state, pic?.url, pic?.count, folded, waiting, job?.message].join('|');
    if (el.dataset.stttsRendered === signature) return;
    el.dataset.stttsRendered = signature;
    el.dataset.state = state;
    el.toggleAttribute('data-folded', state === 'done' && folded);
    if (state === 'done' && folded) {
      el.innerHTML = `<button type="button" class="sttts-pic-fold" data-sttts-pic-action="unfold" aria-label="展开图片"><img src="${esc(pic.url)}" alt="" loading="lazy"><span>图片已收起${pic.count > 1 ? ` · ${pic.count} 个版本` : ''} · 点开</span></button>`;
    } else if (state === 'done') {
      const who = pic.characters ? (pic.characters.length ? ' · ' + pic.characters.join('、') : ' · 没有补角色外貌') : '';
      const pager = pic.count > 1 ? `<span class="sttts-pic-pager"><button type="button" data-sttts-pic-action="prev" aria-label="上一个版本" ${pic.index ? '' : 'disabled'}>‹</button>${pic.index + 1}/${pic.count}<button type="button" data-sttts-pic-action="next" aria-label="下一个版本" ${pic.index < pic.count - 1 ? '' : 'disabled'}>›</button></span>` : '';
      el.innerHTML = frame(`<button type="button" class="sttts-pic-zoom" data-sttts-pic-action="zoom" aria-label="放大查看"><img src="${esc(pic.url)}" alt="${esc(tag.prompt)}" loading="lazy"></button>`)
        + `<span class="sttts-pic-bar">${pager}<span>NovelAI · ${pic.width}×${pic.height}${esc(who)}</span><button type="button" data-sttts-pic-action="redo">重画</button><button type="button" data-sttts-pic-action="open">在绘图中打开</button><button type="button" data-sttts-pic-action="delete">删除</button><button type="button" data-sttts-pic-action="fold">收起</button></span>`;
    } else if (state === 'removed') {
      el.innerHTML = `<span class="sttts-pic-removed">图片已删除<button type="button" data-sttts-pic-action="draw">重新生成</button></span>`;
    } else if (state === 'generating') {
      el.innerHTML = `<span class="sttts-pic-removed">${esc(waiting)}<button type="button" data-sttts-pic-action="cancel">取消</button></span>`
        + frame(pic ? `<button type="button" class="sttts-pic-zoom" data-sttts-pic-action="zoom" aria-label="放大查看"><img src="${esc(pic.url)}" alt="${esc(tag.prompt)}" loading="lazy"></button>` : '<span class="sttts-pic-wait"></span>');
    } else if (state === 'error') {
      el.innerHTML = frame(`<span class="sttts-pic-wait">${esc(job.message)}<br><button type="button" data-sttts-pic-action="draw">重试</button></span>`);
    } else {
      const reason = !s.draw.enabled ? '正文出图没有开启' : !backend.keyStatus('nai') ? '还没有填写 NovelAI 密钥' : !s.draw.auto ? '自动出图已关闭' : '这张图没有自动生成';
      el.innerHTML = frame(`<span class="sttts-pic-wait">${reason}<br><button type="button" data-sttts-pic-action="draw">点击生成</button></span>`);
    }
  }

  /** Fills every picture placeholder in the rendered chat. The tavern's sanitizer renames classes in messages
   *  (sttts-pic becomes custom-sttts-pic), so placeholders are found by their data attributes. */
  function decorate(currentMessage) {
    for (const element of document.querySelectorAll('#chat .mes[mesid]')) {
      const placeholders = element.querySelectorAll('[data-sttts-pic]');
      if (!placeholders.length) continue;
      const id = Number(element.getAttribute('mesid')), message = context().chat[id];
      if (!message || !currentMessage(id)) continue;
      const tags = parsePictures(message.mes);
      for (const el of placeholders) {
        if (el.dataset.stttsToken !== marker) continue;
        const tag = tags.find(t => t.hash === el.dataset.stttsHash);
        if (tag) fill(el, id, message, tag);
      }
    }
  }

  /** Handles clicks inside picture blocks. Returns true when the click was ours. */
  function click(event) {
    const button = event.target.closest('[data-sttts-pic-action]');
    const box = button?.closest('[data-sttts-pic]');
    if (!box || box.dataset.stttsToken !== marker) return false;
    event.preventDefault();
    const id = Number(box.closest('.mes[mesid]')?.getAttribute('mesid')), message = context().chat[id];
    const tag = message && parsePictures(message.mes).find(t => t.hash === box.dataset.stttsHash);
    if (!tag) return true;
    act(button.dataset.stttsPicAction, id, message, tag, button);
    return true;
  }
  function act(action, id, message, tag, source = null) {
    const pic = shown(message, tag.hash);
    if (action === 'draw' || action === 'redo') generate(id, tag, {interactive: true});
    if (action === 'cancel') backend.drawQueue?.cancel?.(jobKey(id, tag));
    if (action === 'open') openDraw({...pictureInputs(settings(), tag, message.mes), tag: tag.prompt, seed: pic?.seed});
    if (action === 'fold' || action === 'unfold') { folds.set(id + ':' + tag.hash, action === 'fold'); scheduleRender(); }
    if ((action === 'prev' || action === 'next') && pic) {
      keep(message, tag.hash, versionsOf(stored(message, tag.hash)), pic.index + (action === 'next' ? 1 : -1));
      saveSoon();
      scheduleRender();
    }
    if (action === 'zoom' && pic) openImageViewer({doc: document, src: pic.url, alt: tag.prompt, from: source?.querySelector?.('img') || source, actions: [
      {label: '重画', run: () => act('redo', id, message, tag)},
      {label: '删除这版', danger: true, run: () => remove(id, tag).then(done => done ? undefined : false)}
    ]});
    if (action === 'delete') remove(id, tag).catch(error => notice(error.message));
  }
  /** Deletes the version on screen (file and record). Returns false when the user cancels. */
  async function remove(id, tag) {
    const message = context().chat[id], pic = shown(message, tag.hash);
    const others = pic ? pic.count - 1 : 0;
    if (!pic || !globalThis.confirm(`删除这张图？图片文件也会从酒馆删除。${others ? `这个标签还有 ${others} 个别的版本。` : '之后可以点“重新生成”再画。'}`)) return false;
    await removeFile(pic.url);
    const list = versionsOf(stored(message, tag.hash)).filter((_, i) => i !== pic.index);
    keep(message, tag.hash, list, pic.index - 1);
    await context().saveChat();
    scheduleRender();
    return true;
  }
  /** Pictures stored in the open chat, counting every version. */
  function pictureStats() {
    let count = 0;
    for (const m of context()?.chat || []) for (const record of Object.values(m?.extra?.sttts_pics || {})) count += versionsOf(record).length;
    return {count};
  }
  /** Deletes every picture (all versions) of the open chat from the tavern; their tags show "点击生成" again. */
  async function clearPictures() {
    const ctx = context();
    let count = 0, failed = 0;
    for (const m of ctx.chat || []) {
      const pics = m?.extra?.sttts_pics;
      if (!pics) continue;
      for (const record of Object.values(pics)) for (const version of versionsOf(record)) {
        try { await removeFile(version.url); count++; } catch { failed++; }
      }
      delete m.extra.sttts_pics;
    }
    await ctx.saveChat();
    scheduleRender();
    return {count, failed};
  }

  // ---------- Bridge helpers for the phone ----------
  function recentMessages(limit = 8) {
    const chat = context().chat, rows = [];
    for (let id = chat.length - 1; id >= 0 && rows.length < limit; id--) {
      const m = chat[id];
      if (!m || m.is_system) continue;
      rows.push({id, name: m.name || (m.is_user ? '我' : '角色'), user: !!m.is_user, preview: String(m.mes || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').slice(0, 60)});
    }
    return rows;
  }
  async function insertImage(id, photoId) {
    const ctx = context(), message = ctx.chat[id];
    if (!message) throw Error('这条消息已经不存在');
    const photo = await backend.library.getPhoto(photoId);
    if (!photo) throw Error('图片已不在相册中');
    const url = await upload(photo.blob, 'st-iphonie-' + Date.now());
    message.extra ??= {};
    if (!Array.isArray(message.extra.media)) message.extra.media = [];
    message.extra.inline_image = !(message.extra.media.length && !message.extra.inline_image);
    message.extra.media.push({url, type: 'image', title: photo.name, source: 'generated'});
    message.extra.media_index = message.extra.media.length - 1;
    const element = globalThis.$?.(`#chat .mes[mesid="${id}"]`);
    if (element?.length && ctx.appendMediaToMessage) ctx.appendMediaToMessage(message, element);
    await ctx.saveChat();
    return {id, url};
  }
  async function suggestPrompt() {
    const ctx = context();
    if (!ctx.generateQuietPrompt) throw Error('当前酒馆版本不支持后台生成');
    const text = await ctx.generateQuietPrompt({quietPrompt: '根据最近的剧情，写一组用于 NovelAI 绘图的英文 danbooru tag，描述当前最有画面感的一幕：人数（1girl、2girls 等）、动作、表情、服装、场景、光线、构图。只输出逗号分隔的英文 tag，不要画师名和质量词，不要任何解释。', removeReasoning: true});
    return String(text || '').replace(/```[a-z]*|```/g, '').replace(/\n+/g, ', ').trim();
  }
  const subscriptionLabel = sub => sub ? `${TIER_NAMES[sub.tier] || '未知档位'} · Anlas ${sub.anlas}` : '';

  return {decorate, click, autoPictures, recentMessages, insertImage, suggestPrompt, subscriptionLabel, pictureStats, clearPictures};
}
