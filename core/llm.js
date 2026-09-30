// 文字模型: which model writes the phone's text (chat replies, 朋友圈, calls, picture plans). 'tavern' uses the model the
// tavern is connected to (generateRaw), as before; 'custom' calls an OpenAI-compatible Chat Completions API directly
// from the browser with its own address, key and model. The story itself always stays on the tavern's model.
// The key lives with the other keys (core/keys.js, engine 'llm') and never appears in settings, requests shown to
// the user, or error messages.

export const TEXT_LIMITS = Object.freeze({maxTokens: [64, 32000], temperature: [0, 2], timeout: 120000});

export function defaultText() {
  return {source: 'tavern', url: '', model: '', temperature: 0.9, maxTokens: 1200};
}
const count = (value, [min, max], fallback, round = true) => { const n = round ? Math.round(Number(value)) : Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };
export function normalizeText(value) {
  const base = defaultText();
  if (!value || typeof value !== 'object') return base;
  return {source: value.source === 'custom' ? 'custom' : 'tavern', url: String(value.url || '').trim().slice(0, 500), model: String(value.model || '').trim().slice(0, 200),
    temperature: Math.round(count(value.temperature, TEXT_LIMITS.temperature, base.temperature, false) * 100) / 100, maxTokens: count(value.maxTokens, TEXT_LIMITS.maxTokens, base.maxTokens)};
}

/** The API base: what the user typed without a trailing slash or a pasted /chat/completions or /models. */
export function apiBase(url) {
  let base = String(url || '').trim().replace(/\/+$/, '');
  base = base.replace(/\/(chat\/completions|completions|models)$/i, '');
  if (!/^https?:\/\/[^\s/]+/i.test(base)) throw Error('请填写接口地址，例如 https://api.openai.com/v1');
  return base;
}

/** The messages to send: prompts are message lists already; a plain string becomes one user message. */
export function asMessages(prompt) {
  if (Array.isArray(prompt)) return prompt.filter(m => m && typeof m.content === 'string').map(m => ({role: ['system', 'user', 'assistant'].includes(m.role) ? m.role : 'user', content: m.content}));
  return [{role: 'user', content: String(prompt ?? '')}];
}

export function chatBody(text, prompt, responseLength) {
  if (!text.model) throw Error('请先在「引擎 → 文字模型」里填写模型名');
  return {model: text.model, messages: asMessages(prompt), temperature: text.temperature, max_tokens: Math.min(text.maxTokens, responseLength || text.maxTokens), stream: false};
}

/** The reply text of a Chat Completions answer (reasoning kept apart by the provider is left out). */
export function replyText(json) {
  const choice = json?.choices?.[0];
  const content = choice?.message?.content ?? choice?.text;
  if (Array.isArray(content)) return content.map(part => typeof part === 'string' ? part : part?.text || '').join('');
  if (typeof content === 'string') return content;
  throw Error('接口返回的内容里没有回复文字');
}

/** A readable reason for a failed request. The key is never part of it. */
export function failure(status, body, key = '') {
  let detail = '';
  try { const json = typeof body === 'string' ? JSON.parse(body) : body; detail = json?.error?.message || json?.message || json?.detail || ''; } catch { detail = String(body || '').slice(0, 200); }
  detail = String(detail).slice(0, 300);
  if (key) detail = detail.split(key).join('••••');
  const reason = {401: '密钥无效或已过期', 403: '这个密钥没有权限', 404: '地址或模型名不对', 408: '接口超时了', 413: '请求内容太长', 429: '请求太频繁或额度用完了', 500: '接口服务出错了', 502: '接口服务暂时不可用', 503: '接口服务暂时不可用'}[status] || `接口返回错误 ${status}`;
  return Error(`文字模型：${reason}${detail ? '（' + detail + '）' : ''}`);
}

/**
 * Calls the custom API. fetch is passed in (tests). A network error in a browser is usually the API refusing web
 * pages (CORS) or a wrong address; the message says so.
 */
export async function customRequest({text, key, prompt, responseLength, fetch: send = globalThis.fetch, signal}) {
  const base = apiBase(text.url), body = chatBody(text, prompt, responseLength);
  const timeout = AbortSignal.timeout ? AbortSignal.timeout(TEXT_LIMITS.timeout) : undefined;
  let response;
  try {
    response = await send(base + '/chat/completions', {method: 'POST', headers: {'Content-Type': 'application/json', ...(key ? {Authorization: 'Bearer ' + key} : {})}, body: JSON.stringify(body),
      signal: signal && timeout && AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal || timeout});
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw Error('文字模型：等太久了，接口没有回应');
    throw Error('文字模型：连不上这个接口。可能是地址写错了，或者这个接口不允许网页直接访问（CORS）');
  }
  const raw = await response.text();
  if (!response.ok) throw failure(response.status, raw, key);
  let json;
  try { json = JSON.parse(raw); } catch { throw Error('文字模型：接口返回的不是 JSON，地址可能填错了'); }
  return replyText(json);
}

/** Model ids the API lists (GET /models): for picking a model and checking the connection. Listing costs nothing. */
export async function listModels({text, key, fetch: send = globalThis.fetch}) {
  const base = apiBase(text.url);
  let response;
  try { response = await send(base + '/models', {headers: key ? {Authorization: 'Bearer ' + key} : {}}); }
  catch { throw Error('文字模型：连不上这个接口。可能是地址写错了，或者这个接口不允许网页直接访问（CORS）'); }
  const raw = await response.text();
  if (!response.ok) throw failure(response.status, raw, key);
  let json;
  try { json = JSON.parse(raw); } catch { throw Error('文字模型：接口返回的不是 JSON，地址可能填错了'); }
  const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : Array.isArray(json) ? json : [];
  return [...new Set(list.map(m => typeof m === 'string' ? m : m?.id || m?.name).filter(Boolean).map(String))].sort().slice(0, 500);
}
