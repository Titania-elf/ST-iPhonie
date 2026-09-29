// In-chat pictures: fills the placeholders left by <img prompt="…"> tags, generates them with NovelAI,
// uploads the result to the tavern's image folder and remembers it on the message (message.extra.sttts_pics),
// so every device that opens the chat sees the same picture.
import {parsePictures, pictureInputs} from './core/draw.js';
import {TIER_NAMES} from './core/novelai.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export function createPictureHost({context, settings, backend, marker, scheduleRender, openDraw, notice}) {
  const jobs = new Map(); // `${messageId}:${hash}` -> {state: 'generating'|'error', message}

  const stored = (message, hash) => message?.extra?.sttts_pics?.[hash] || null;

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

  /** Asks before spending Anlas. Returns false when the user declines or the key is missing. */
  async function allowed(interactive) {
    if (!backend.keyStatus('nai')) { if (interactive) notice('还没有填写 NovelAI 密钥，请在小手机的引擎卡包里填写'); return false; }
    try { await backend.naiSubscription(); } catch (error) { if (interactive) notice(error.message); }
    const quote = backend.drawQuote();
    if (quote.free === true) return 'free';
    if (!interactive) return false;
    const why = quote.free === null ? '暂时读不到 NovelAI 订阅信息，无法确认是否免费。' : '按当前参数和订阅，这张图会扣 Anlas。';
    return globalThis.confirm(why + '\n确定要生成吗？') ? 'paid' : false;
  }

  async function generate(id, tag, interactive) {
    const ctx = context(), message = ctx.chat[id], key = id + ':' + tag.hash;
    if (!message || jobs.get(key)?.state === 'generating') return;
    const permission = await allowed(interactive);
    if (!permission) return;
    jobs.set(key, {state: 'generating'});
    scheduleRender();
    try {
      const result = await backend.generateImage({...pictureInputs(settings(), tag), allowPaid: permission === 'paid', name: 'chat'});
      const url = await upload(result.blob, 'st-iphonie-' + Date.now());
      // Only store the picture when the same message is still there with this tag.
      const now = context().chat[id];
      if (now === message && parsePictures(now.mes).some(t => t.hash === tag.hash)) {
        now.extra ??= {};
        now.extra.sttts_pics ??= {};
        now.extra.sttts_pics[tag.hash] = {url, seed: result.seed, width: result.params.width, height: result.params.height, model: result.params.model, steps: result.params.steps, prompt: tag.prompt, at: Date.now()};
        await context().saveChat();
      }
      jobs.delete(key);
    } catch (error) {
      jobs.set(key, {state: 'error', message: error.message});
    }
    scheduleRender();
  }

  /** Called after a new reply is rendered: draws its pictures when automatic drawing is on and free. */
  async function autoPictures(id) {
    const s = settings();
    if (!s.draw.enabled || !s.draw.auto) return;
    const message = context().chat[id];
    if (!message || message.is_user || message.is_system) return;
    for (const tag of parsePictures(message.mes)) if (!stored(message, tag.hash)) await generate(id, tag, false);
  }

  function frame(inner) { return `<span class="sttts-pic-frame">${inner}</span>`; }
  function fill(el, id, message, tag) {
    const pic = stored(message, tag.hash), job = jobs.get(id + ':' + tag.hash);
    const state = pic ? 'done' : job?.state || 'idle';
    const signature = state + '|' + (pic?.url || job?.message || '');
    if (el.dataset.stttsRendered === signature) return;
    el.dataset.stttsRendered = signature;
    el.dataset.state = state;
    const s = settings();
    if (pic) {
      el.innerHTML = frame(`<a href="${esc(pic.url)}" target="_blank" rel="noopener"><img src="${esc(pic.url)}" alt="${esc(tag.prompt)}" loading="lazy"></a>`)
        + `<span class="sttts-pic-bar"><span>NovelAI · ${pic.width}×${pic.height}</span><button type="button" data-sttts-pic-action="redo">重画</button><button type="button" data-sttts-pic-action="open">在绘图中打开</button></span>`;
    } else if (state === 'generating') {
      el.innerHTML = frame('<span class="sttts-pic-wait">NovelAI 正在画……</span>');
    } else if (state === 'error') {
      el.innerHTML = frame(`<span class="sttts-pic-wait">${esc(job.message)}<br><button type="button" data-sttts-pic-action="draw">重试</button></span>`);
    } else {
      const reason = !s.draw.enabled ? '正文出图没有开启' : !backend.keyStatus('nai') ? '还没有填写 NovelAI 密钥' : !s.draw.auto ? '自动出图已关闭' : '这张图没有自动生成';
      el.innerHTML = frame(`<span class="sttts-pic-wait">${reason}<br><button type="button" data-sttts-pic-action="draw">点击生成</button></span>`);
    }
  }

  /** Fills every picture placeholder in the rendered chat. */
  function decorate(currentMessage) {
    for (const element of document.querySelectorAll('#chat .mes[mesid]')) {
      const placeholders = element.querySelectorAll('.sttts-pic');
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
    const box = button?.closest('.sttts-pic');
    if (!box || box.dataset.stttsToken !== marker) return false;
    event.preventDefault();
    const id = Number(box.closest('.mes[mesid]')?.getAttribute('mesid')), message = context().chat[id];
    const tag = message && parsePictures(message.mes).find(t => t.hash === box.dataset.stttsHash);
    if (!tag) return true;
    const action = button.dataset.stttsPicAction;
    if (action === 'draw' || action === 'redo') {
      if (action === 'redo') { delete message.extra.sttts_pics[tag.hash]; box.dataset.stttsRendered = ''; }
      generate(id, tag, true);
    }
    if (action === 'open') openDraw({...pictureInputs(settings(), tag), tag: tag.prompt, seed: stored(message, tag.hash)?.seed});
    return true;
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

  return {decorate, click, autoPictures, recentMessages, insertImage, suggestPrompt, subscriptionLabel};
}
