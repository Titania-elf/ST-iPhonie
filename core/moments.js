// 朋友圈 (moments) without DOM or network: the moments preset, the prompts for new posts and for reactions, and the
// parser for the model's answer.
//
// The model answers in tagged lines, one item per line:
//   【动态】名字：内容          a new post (only when asking for new posts)
//   【配图】english tags       a picture for the post above (optional)
//   【赞】名字、名字            likes on the post above (or on the post being reacted to)
//   【评论】名字：内容          a comment; 「名字 回复 名字：内容」 answers someone
import {plainStory} from './chat.js';
import {isPlaceholderRole} from './protocol.js';

export const MOMENTS_LIMITS = Object.freeze({posts: 300, comments: 60, text: 2000, people: 12, story: 40, perRefresh: 5});

export const DEFAULT_MOMENTS_ENTRIES = Object.freeze([
  {id: 'style', title: '朋友圈口吻', text: '你在替联系人发朋友圈。像真人发动态：一两句话到一小段，写日常、心情、吐槽、见闻，或者对最近发生的事的感受。口语、自然，可以用表情和颜文字，不写旁白、动作描写和心理描写。每个人发的内容和语气都要符合自己的人设和说话习惯，彼此不要雷同。'},
  {id: 'persona', title: '守住人设', text: '朋友圈是发给所有朋友看的，不是单独对{{用户}}说话。可以含蓄地提到和{{用户}}之间的事，但不要把只有两个人知道的秘密直接写出来，除非人设就是这样。最近的剧情只作背景，不要复述剧情，也不要替{{用户}}说话或发动态。'},
  {id: 'interact', title: '点赞和评论', text: '别人发动态时，关系好的联系人会点赞或评论；评论简短口语，可以互相接话、吐槽、开玩笑。{{用户}}评论时，被评论的人一定会回复，别的人看到了也可以接话。'},
  {id: 'picture', title: '配图', text: '有画面感的动态可以配一张图，大约三成的动态配图就好：自拍、吃的、风景、宠物、正在看的东西。配图写成英文 danbooru tag，描述画面本身。'}
]);
const PRESET_REV = 1;
const DEFAULT_PRESET = {id: 'default', name: '日常朋友圈', rev: PRESET_REV, context: 6, posts: 2, entries: DEFAULT_MOMENTS_ENTRIES.map(e => ({...e, enabled: true}))};

/** Moments settings: presets, and when posts happen by themselves (off by default: each refresh costs a model call). */
export function defaultMoments() {
  return {presets: [structuredClone(DEFAULT_PRESET)], activePreset: 'default', auto: false, every: 8, dailyMax: 4, images: true, replyToMe: true};
}

const text = (value, max) => String(value ?? '').slice(0, max);
const count = (value, min, max, fallback) => { const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };

export function normalizeMomentsPreset(p = {}) {
  const entries = Array.isArray(p.entries) ? p.entries : DEFAULT_PRESET.entries;
  return {
    id: String(p.id || crypto.randomUUID()), name: text(p.name, 60) || '朋友圈预设', rev: PRESET_REV,
    context: count(p.context, 0, MOMENTS_LIMITS.story, DEFAULT_PRESET.context),
    posts: count(p.posts, 1, MOMENTS_LIMITS.perRefresh, DEFAULT_PRESET.posts),
    entries: entries.map(e => ({id: String(e.id || crypto.randomUUID()), title: text(e.title, 80), enabled: e.enabled !== false, text: text(e.text, 20000)}))
  };
}

export function normalizeMoments(value) {
  const base = defaultMoments();
  if (!value || typeof value !== 'object') return base;
  const presets = (Array.isArray(value.presets) && value.presets.length ? value.presets : base.presets).map(normalizeMomentsPreset);
  return {
    presets, activePreset: presets.some(p => p.id === value.activePreset) ? value.activePreset : presets[0].id,
    auto: value.auto === true, every: count(value.every, 1, 100, base.every), dailyMax: count(value.dailyMax, 1, 30, base.dailyMax),
    images: value.images !== false, replyToMe: value.replyToMe !== false
  };
}

export function validateMomentsPreset(p) {
  if (!p?.name?.trim()) throw Error('请填写朋友圈预设名称');
  if (!p.entries.some(e => e.enabled && e.text.trim())) throw Error('至少启用一条朋友圈规则');
  return p;
}
export const activeMomentsPreset = moments => moments.presets.find(p => p.id === moments.activePreset) || moments.presets[0];

const fill = (template, values) => String(template).replace(/\{\{(.+?)\}\}/g, (m, key) => values[key.trim()] ?? m);
const who = (name, user) => name === 'me' ? user : name;

/** A post as the model reads it: author, text, picture, likes and comments. */
export function postLines(post, user) {
  const lines = [`${who(post.author, user)}：${post.text}${post.photoId || post.imageTags ? '（配了图）' : ''}`];
  if (post.likes?.length) lines.push(`  赞：${post.likes.map(n => who(n, user)).join('、')}`);
  for (const c of post.comments || []) lines.push(`  ${who(c.from, user)}${c.to ? ' 回复 ' + who(c.to, user) : ''}：${c.text}`);
  return lines.join('\n');
}

/**
 * The request for moments. mode 'posts': new posts from the people; 'react': reactions to one post (the user's new post);
 * 'reply': answers to the user's comment on a post. people: [{name, persona, card}]. recent: latest posts, for variety.
 */
export function buildMomentsRequest({preset, mode = 'posts', people, story = [], user = '我', userPersona = '', recent = [], post = null, comment = null, images = true}) {
  const values = {'用户': user};
  const rules = preset.entries.filter(e => e.enabled && e.text.trim()).filter(e => images || e.id !== 'picture').map(e => fill(e.text, values));
  const names = people.map(p => p.name);
  const system = [
    rules.join('\n\n'),
    `【朋友圈里的人】\n${people.map(p => `- ${p.name}：${(p.persona || p.card || '').trim() || '（没有资料，按剧情里的表现来）'}`).join('\n')}`,
    userPersona.trim() ? `【${user}】\n${userPersona.trim()}` : '',
    story.length ? `【最近的剧情】（只作背景参考）\n${story.map(s => `${s.name}：${s.text}`).join('\n')}` : '',
    recent.length && mode === 'posts' ? `【最近的朋友圈】（不要重复这些内容）\n${recent.map(p => postLines(p, user)).join('\n')}` : '',
    ['【输出格式】',
      '每一项单独一行，只能用下面这几种写法，不要写别的文字、编号或解释：',
      mode === 'posts' ? '「【动态】名字：动态内容」发一条新动态；' : '',
      mode === 'posts' && images ? '「【配图】英文 tag」给上一条动态配图，不需要配图就不写；' : '',
      '「【赞】名字、名字」点赞；',
      `「【评论】名字：评论内容」评论，回复某人时写「【评论】名字 回复 某人：内容」。`,
      `名字只能是：${names.join('、')}。不要替${user}写动态、点赞或评论。`].filter(Boolean).join('\n')
  ].filter(Boolean).join('\n\n');
  let ask;
  if (mode === 'posts') ask = `挑 1 到 ${preset.posts} 个人各发一条新动态（不一定每个人都发）。每条动态下面可以跟着别人的赞和评论。`;
  else if (mode === 'react') ask = `【${user}刚发的动态】\n${postLines(post, user)}\n\n朋友们看到了这条动态：写出谁点了赞、谁评论了什么。`;
  else ask = `【这条动态】\n${postLines(post, user)}\n\n${user}刚评论：「${comment.text}」${comment.to ? `（回复 ${who(comment.to, user)}）` : ''}\n被评论的人回复${user}，别的人也可以接话。只写新的评论。`;
  return [{role: 'system', content: system}, {role: 'user', content: ask}];
}

const LINE = /^\s*(?:[-*•]\s*)?[【\[]\s*(动态|配图|赞|点赞|评论)\s*[】\]]\s*(.*)$/;
const SAID = /^([^:：\n]{1,40}?)\s*(?:回复\s*([^:：\n]{1,40}?))?\s*[:：]\s*(.+)$/;
const clean = s => String(s).replace(/<[^>]+>/g, '').trim().replace(/^[「“"](.*)[」”"]$/s, '$1').trim();

/**
 * The model's answer as {posts: [{author, text, imageTags, likes, comments}], likes, comments}. posts only for mode
 * 'posts'; likes and comments outside a post belong to the post being reacted to. Unknown names are dropped, and
 * nobody speaks for the user.
 */
export function parseMoments(reply, {names, user = '我', mode = 'posts'}) {
  const body = String(reply || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```[a-z]*\n?|```/g, '');
  const known = name => names.find(n => n === String(name).trim());
  const target = name => { const n = String(name || '').trim(); return !n ? '' : n === user || n === '我' ? 'me' : known(n) || ''; };
  const out = {posts: [], likes: [], comments: []};
  let post = null;
  const holder = () => post || out;
  for (const raw of body.split(/\r?\n/)) {
    const m = raw.match(LINE);
    if (!m) continue;
    const [, kind, rest] = m;
    if (kind === '动态') {
      if (mode !== 'posts') continue;
      const s = rest.match(SAID), author = s && known(s[1]);
      post = null;
      if (!author || isPlaceholderRole(author)) continue;
      const said = clean(s[3]).slice(0, MOMENTS_LIMITS.text);
      if (!said) continue;
      if (out.posts.length >= MOMENTS_LIMITS.perRefresh) break;
      post = {author, text: said, imageTags: '', likes: [], comments: []};
      out.posts.push(post);
    } else if (kind === '配图') {
      if (post && !post.imageTags) post.imageTags = clean(rest).replace(/[一-鿿]+/g, ' ').split(/[,，]/).map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean).join(', ').slice(0, 600);
    } else if (kind === '赞' || kind === '点赞') {
      const list = holder().likes;
      for (const name of rest.split(/[、,，\s]+/)) { const n = known(name); if (n && !list.includes(n)) list.push(n); }
    } else {
      const s = rest.match(SAID), from = s && known(s[1]);
      if (!from) continue;
      const said = clean(s[3]).slice(0, 500);
      if (said && holder().comments.length < 20) holder().comments.push({from, to: target(s[2]), text: said});
    }
  }
  // A post's author does not like their own post.
  for (const p of out.posts) p.likes = p.likes.filter(n => n !== p.author);
  return out;
}

/** Recent story messages as plain lines, for the prompt. */
export function storyLines(chat, limit, user) {
  const out = [];
  for (let i = (chat?.length || 0) - 1; i >= 0 && out.length < limit; i--) {
    const m = chat[i];
    if (!m || m.is_system) continue;
    const said = plainStory(m.mes);
    if (said) out.unshift({name: m.name || (m.is_user ? user : '旁白'), text: said.slice(0, 600)});
  }
  return out;
}
