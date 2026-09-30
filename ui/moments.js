// 朋友圈: the characters' posts, likes and comments, and the user's own posts and comments. New posts, reactions and
// replies are generated in the tavern page (host-moments.js); this view only shows them and sends what the user does.
import {createView, esc, btn, heading, empty, avatar, field, textArea, input, toggle} from './common.js';
import {icon} from './icons.js';
import {openImageViewer} from '../image-viewer.js';
import {downloadAction} from '../download.js';

const SEEN_KEY = 'st-iphonie-moments-seen';
/** When the user last looked at 朋友圈 (per browser; only for the dot on the icon). */
export function momentsSeen(win) { try { return Number(win.localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } }
function markSeen(win) { try { win.localStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* the dot is only a convenience */ } }
/** Posts and comments by others since the user last looked. */
export const momentsNew = (posts, seen) => posts.reduce((n, p) => n + (p.author !== 'me' && p.at > seen ? 1 : 0) + p.comments.filter(c => c.from !== 'me' && c.at > seen).length, 0);

function ago(at) {
  const s = (Date.now() - at) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  const d = new Date(at), today = new Date(); today.setHours(0, 0, 0, 0);
  if (at >= today.getTime() - 86400000) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function momentsApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'moments'), urls = new Map();
  let epoch = 0, posts = [];
  const nameOf = who => who === 'me' ? '我' : who;
  const urlFor = async id => {
    if (urls.has(id)) return urls.get(id);
    const photo = await api.getPhoto(id);
    const url = photo ? ctx.win.URL.createObjectURL(photo.blob) : '';
    urls.set(id, url);
    return url;
  };

  function picture(p) {
    if (p.photoId) return `<button type="button" class="moment-photo" data-action="view-photo" data-id="${esc(p.id)}" aria-label="查看配图"><img data-photo="${esc(p.photoId)}" alt="${esc(nameOf(p.author))} 的配图"></button>`;
    if (!p.imageTags) return '';
    if (p.imageState === 'waiting') return '<p class="moment-note">配图正在画……</p>';
    // Without a NovelAI key there is nothing to retry; once a key is saved the note turns into a button again.
    if (p.imageState === 'failed' && /密钥/.test(p.imageNote || '') && !api.keyStatus('nai')) return `<p class="moment-note">${esc(p.imageNote)}，这张配图没有画</p>`;
    if (p.imageState === 'failed') return `<button type="button" class="moment-note" data-action="draw-image" data-id="${esc(p.id)}">${esc(p.imageNote || '配图没画出来')} · 点一下重画</button>`;
    return `<button type="button" class="moment-note" data-action="draw-image" data-id="${esc(p.id)}">这条动态有配图 · 点一下画出来</button>`;
  }
  function post(p) {
    const liked = p.likes.includes('me');
    const social = p.likes.length || p.comments.length
      ? `<div class="moment-social">${p.likes.length ? `<p class="moment-likes">${icon('heart', true)}${esc(p.likes.map(nameOf).join('、'))}</p>` : ''}${p.comments.map(c => `<button type="button" class="moment-comment" data-action="${c.from === 'me' ? 'my-comment' : 'comment'}" data-id="${esc(p.id)}" data-comment="${esc(c.id)}" data-to="${esc(c.from)}"><b>${esc(nameOf(c.from))}</b>${c.to ? ` 回复 <b>${esc(nameOf(c.to))}</b>` : ''}：${esc(c.text)}</button>`).join('')}</div>`
      : '';
    return `<article class="moment" data-id="${esc(p.id)}">${avatar(nameOf(p.author), p.author === 'me' ? 'none' : ctx.engineOf(p.author), 42)}
      <div class="moment-body"><strong class="moment-name">${esc(nameOf(p.author))}</strong>${p.text ? `<p class="moment-text">${esc(p.text)}</p>` : ''}${picture(p)}
        <div class="moment-meta"><time>${ago(p.at)}</time><span class="moment-tools">${btn('like', icon('heart', liked), 'text-button', `data-id="${esc(p.id)}" aria-pressed="${liked}" aria-label="${liked ? '取消点赞' : '点赞'}"`)}${btn('comment', icon('bubble'), 'text-button', `data-id="${esc(p.id)}" aria-label="评论"`)}${btn('post-menu', icon('more'), 'text-button', `data-id="${esc(p.id)}" aria-label="更多"`)}</span></div>
        ${social}</div></article>`;
  }

  async function render() {
    const ticket = ++epoch;
    posts = await api.listMoments();
    if (v.disposed || ticket !== epoch) return;
    const busy = api.momentsBusy?.();
    const tools = btn('refresh-moments', icon('refresh'), 'round-button', `aria-label="刷新：让角色发新动态" ${busy ? 'disabled' : ''}`) + btn('new-post', icon('add'), 'round-button', 'aria-label="发动态"') + btn('moments-options', icon('sliders'), 'round-button', 'aria-label="朋友圈设置"');
    const scroll = v.root.scrollTop;
    v.draw(heading('朋友圈', tools, 'Moments')
      + (busy ? '<p class="moments-busy" role="status">朋友们正在刷朋友圈……</p>' : '')
      + (posts.length ? `<div class="moments-feed">${posts.map(post).join('')}</div>`
        : empty('朋友圈还是空的', '点右上角的刷新，角色们就会发动态；也可以自己先发一条。每次刷新会调用一次酒馆当前的模型。', 'image')));
    v.root.scrollTop = scroll;
    // Seen only when it is on screen: the view also redraws in the background when new posts arrive.
    if (ctx.visible?.('moments') !== false) { markSeen(ctx.win); ctx.momentsSeen?.(); }
    for (const img of v.root.querySelectorAll('img[data-photo]')) {
      const url = await urlFor(img.dataset.photo);
      if (v.disposed || ticket !== epoch) return;
      if (url) img.src = url; else img.closest('.moment-photo')?.replaceWith(Object.assign(ctx.doc.createElement('p'), {className: 'moment-note', textContent: '配图已经从相册删掉了'}));
    }
  }

  function sheet(title, html, handlers) {
    const d = ctx.dialog(title, html);
    d.body.addEventListener('click', e => {
      const b = e.target.closest('[data-action]');
      if (!b || !handlers[b.dataset.action]) return;
      e.preventDefault();
      ctx.win.Promise.resolve().then(() => handlers[b.dataset.action](b)).catch(error => ctx.notify(error.message, {error: true}));
    });
    return d;
  }
  /** Runs a model request in the background; the view shows it as busy and redraws when it ends. */
  function background(job, done) {
    render();
    job.then(result => { if (done) ctx.notify(done(result)); }).catch(error => ctx.notify(error.message, {error: true})).finally(() => render());
  }
  const replyOn = () => api.getState().moments.replyToMe !== false;

  async function newPost() {
    const photos = await api.listPhotos();
    let chosen = '';
    const d = sheet('发动态', `${field('这一刻的想法', textArea('text', '', 'rows="4" maxlength="2000" placeholder="写点什么…"'))}
      ${photos.length ? `<p class="help-copy">配一张相册里的照片（可选）</p><div class="photo-grid pick-photos">${photos.slice(0, 24).map(r => `<button data-action="pick" data-id="${esc(r.id)}" aria-pressed="false" aria-label="选择 ${esc(r.name)}"><img data-photo="${esc(r.id)}" alt="${esc(r.name)}"></button>`).join('')}</div>` : ''}
      <div class="actions">${btn('send-post', icon('send') + '发表', 'primary')}</div>`, {
      pick: b => { chosen = chosen === b.dataset.id ? '' : b.dataset.id; for (const x of d.body.querySelectorAll('[data-action=pick]')) x.setAttribute('aria-pressed', String(x.dataset.id === chosen)); },
      'send-post': async () => {
        const text = d.body.querySelector('[data-field=text]').value.trim();
        if (!text && !chosen) throw Error('写点什么，或者选一张照片');
        const made = await api.postMoment({text, ...(chosen ? {photoId: chosen} : {})});
        d.close();
        if (replyOn()) background(api.momentsReact(made.id), () => '朋友们看到了你的动态');
        else render();
      }
    });
    for (const img of d.body.querySelectorAll('img[data-photo]')) urlFor(img.dataset.photo).then(url => { if (url) img.src = url; });
  }
  function commentOn(id, to = '') {
    const d = sheet(to && to !== 'me' ? `回复 ${to}` : '评论', `${field('评论', textArea('text', '', `rows="3" maxlength="500" placeholder="${to && to !== 'me' ? '回复 ' + esc(to) : '说点什么…'}"`))}<div class="actions">${btn('send-comment', icon('send') + '发送', 'primary')}</div>`, {
      'send-comment': async () => {
        const text = d.body.querySelector('[data-field=text]').value.trim();
        if (!text) throw Error('写点什么再发送');
        const {comment} = await api.commentMoment(id, {text, ...(to && to !== 'me' ? {to} : {})});
        d.close();
        if (replyOn()) background(api.momentsReply(id, comment.id));
        else render();
      }
    });
    d.body.querySelector('textarea')?.focus();
  }
  function options() {
    const m = api.getState().moments;
    const d = sheet('朋友圈设置', `<div class="group">${toggle('auto', '角色自己发朋友圈', m.auto, '打开后，每隔几条正文回复，角色们会自己发一次动态（会调用一次酒馆当前的模型，花费和一次聊天回复差不多）。')}
        ${field('每几条正文回复发一次', input('every', m.every, 'number', 'min="1" max="100" step="1"'))}
        ${field('每天最多自动发几次', input('dailyMax', m.dailyMax, 'number', 'min="1" max="30" step="1"'))}
        ${toggle('images', '动态配图', m.images, '有画面感的动态会用 NovelAI 画一张配图。只在免费档内自动画；会扣 Anlas 的图要你点一下确认。没有 NovelAI 密钥时只显示文字。')}
        ${toggle('replyToMe', '角色回复我', m.replyToMe, '你发动态或评论后，角色会点赞、评论和回复（每次调用一次模型）。')}</div>
      <div class="actions">${btn('edit-prompt', icon('edit') + '编辑朋友圈提示词', 'secondary')}</div>
      <div class="actions">${btn('clear-moments', icon('trash') + '清空朋友圈', 'danger')}</div>`, {
      'edit-prompt': () => { d.close(); ctx.open('presets'); ctx.showPresetKind?.('moments'); },
      'clear-moments': async () => { if (!await ctx.confirm('清空朋友圈？', '所有动态、点赞和评论都会删除，配图还留在相册里。')) return; d.close(); await api.clearMoments(); await render(); ctx.notify('朋友圈已清空'); }
    });
    d.body.addEventListener('change', e => {
      const el = e.target.closest('[data-field]');
      if (!el) return;
      const key = el.dataset.field;
      try { api.saveMoments({[key]: el.type === 'checkbox' ? el.checked : Number(el.value)}); }
      catch (error) { ctx.notify(error.message, {error: true}); }
    });
  }

  v.refresh = render;
  v.onMoments = () => { if (!v.disposed) render().catch(error => ctx.notify(error.message)); };
  const dispose = v.dispose;
  v.dispose = () => { epoch++; for (const url of urls.values()) if (url) ctx.win.URL.revokeObjectURL(url); urls.clear(); dispose(); };
  v.on('click', '[data-action]', async el => {
    const id = el.dataset.id, target = posts.find(p => p.id === id);
    switch (el.dataset.action) {
      case 'refresh-moments': background(api.momentsRefresh(), made => `${[...new Set(made.map(p => p.author))].join('、')} 发了新动态`); break;
      case 'new-post': await newPost(); break;
      case 'moments-options': options(); break;
      case 'like': if (target) { await api.likeMoment(id, !target.likes.includes('me')); await render(); } break;
      case 'comment': commentOn(id, el.dataset.to || ''); break;
      case 'my-comment': if (await ctx.confirm('删除这条评论？')) { await api.deleteMomentComment(id, el.dataset.comment); await render(); } break;
      case 'post-menu': if (await ctx.confirm('删除这条动态？', '点赞和评论会一起删除，配图还留在相册里。')) { await api.deleteMoment(id); await render(); } break;
      case 'view-photo': {
        const img = el.querySelector('img');
        if (!img?.src || !target) break;
        openImageViewer({doc: ctx.doc, src: img.src, alt: img.alt, from: img, actions: [downloadAction(ctx.doc, async () => ({source: (await api.getPhoto(target.photoId)).blob, name: `朋友圈 · ${nameOf(target.author)}`}), ctx.notify)]});
        break;
      }
      case 'draw-image': {
        const paid = /Anlas/.test(target?.imageNote || '');
        if (paid && !await ctx.confirm('这张图会扣 Anlas', '超出了 NovelAI 的免费档，确认后再画。')) break;
        background(api.momentsDrawImage(id, paid));
        break;
      }
    }
  });
  render().catch(error => ctx.notify(error.message));
  return v;
}
