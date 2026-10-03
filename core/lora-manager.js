// Where the LoRA list comes from.
//
// ComfyUI's own /object_info/LoraLoader is the spine: it is the authoritative list of lora_name strings the
// generator will accept, and it costs ~9 KB where the whole /object_info costs ~5 MB. ComfyUI-Lora-Manager, when
// it is installed, decorates those names with what it has already scanned — preview, model name, folder, base
// model, tags, favourite, trigger words — so the plugin never hashes a 2 GB file or calls Civitai itself.
//
// Three ways to reach ComfyUI, probed in this order and remembered per address:
//   direct  the browser talks to ComfyUI (needs --enable-cors-header, which the aki bundle already passes)
//   plugin  the tavern talks to ComfyUI for us (server-plugin/, copied into the tavern's plugins/ folder)
//   legacy  the old /api/sd/comfy/loras patch, still read where somebody has it, no longer asked for
// A manager on any transport beats a bare name list, and at equal capability the browser's own connection wins.
// None of them reachable leaves 手填 and 从当前工作流识别, which never needed any of this.

export const LORA_PLUGIN_BASE = '/api/plugins/st-iphonie-lora';
const SPINE_PATH = '/object_info/LoraLoader';
const VERSION_PATH = '/api/lm/version-info';
const ROOTS_PATH = '/api/lm/loras/roots';
const LIST_PATH = '/api/lm/loras/list';
const TRIGGER_PATH = '/api/lm/loras/get-trigger-words';
// The browser gives up on a wrong address quickly; through the tavern a cold manager scan is allowed to take longer.
const DIRECT_TIMEOUT = 4000, PLUGIN_TIMEOUT = 20000;
const PAGE_SIZE = 100, MAX_PAGES = 50;
const PROBE_TTL = 60000, CATALOG_TTL = 120000;

const NO_SOURCE = '读不到 LoRA 列表：ComfyUI 没开着，或者浏览器和酒馆都连不上它。想要列表和自动触发词，二选一——① 给 ComfyUI 加启动参数 --enable-cors-header（秋叶整合包默认就带）；② 把插件目录里的 server-plugin/ 拷到酒馆的 plugins/ 下，重启酒馆。在这之前，手填文件名和「从当前工作流识别」照常能用。';
const NO_MANAGER = '自动触发词要装 ComfyUI-Lora-Manager（在 ComfyUI 管理器里搜 Lora Manager，装上重启）。没装就手动填，效果一样。';
const NO_LOADER = 'ComfyUI 里没有 LoraLoader 节点，读不到 LoRA 列表：确认 ComfyUI 正常启动了，或手填文件名。';

// ---------- names ----------
// The two sides spell the same file differently: ComfyUI uses the OS separator (on Windows "风格\x.safetensors"),
// Lora Manager always "/". Everything is compared through loraKey so neither spelling wins.
export const loraKey = name => String(name ?? '').replace(/\\/g, '/').replace(/^[./]+/, '').toLowerCase();
/** The bare file name, no folder and no extension: the only form Lora Manager's trigger-word lookup matches. */
export const loraStem = name => String(name ?? '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
/** The folder part of a lora_name, "" at the root. */
export const loraFolder = name => { const parts = String(name ?? '').replace(/\\/g, '/').split('/'); parts.pop(); return parts.join('/'); };

/** The lora_name options of ComfyUI's LoraLoader (and of the pysssss variant, where that is what is installed). */
export function spineNames(info) {
  const out = new Set();
  for (const node of Object.values(info && typeof info === 'object' ? info : {})) {
    const list = node?.input?.required?.lora_name?.[0];
    if (Array.isArray(list)) for (const item of list) if (typeof item === 'string' && item) out.add(item);
  }
  return [...out];
}

/** A Lora Manager row's path as ComfyUI spells it: its absolute file_path made relative to one of the lora roots. */
export function managerPath(item, roots = []) {
  const full = String(item?.file_path || '').replace(/\\/g, '/');
  for (const root of Array.isArray(roots) ? roots : []) {
    const base = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (base && full.toLowerCase().startsWith(base.toLowerCase() + '/')) return full.slice(base.length + 1);
  }
  // No root matched (a root was dropped, or the manager reports another machine's paths): fall back to what the row
  // says about itself, which is still enough for the stem match in mergeLoraRows.
  const ext = (full.match(/\.[a-z0-9]+$/i) || ['.safetensors'])[0];
  return [String(item?.folder || ''), String(item?.file_name || '') + ext].filter(Boolean).join('/');
}

/**
 * Lora Manager's rows joined onto ComfyUI's name list. Every name ComfyUI reports becomes a row, decorated where the
 * manager knows the file: a lora the manager has not scanned yet still shows up and still loads, and a row the
 * manager has but ComfyUI does not (deleted, or a root ComfyUI no longer reads) is counted and dropped, because
 * picking it would only fail at generation time.
 */
export function mergeLoraRows(spine, items = [], roots = []) {
  const names = (Array.isArray(spine) ? spine : []).filter(n => typeof n === 'string' && n);
  const byPath = new Map(), byStem = new Map();
  for (const name of names) {
    byPath.set(loraKey(name), name);
    const stem = loraStem(name).toLowerCase();
    byStem.set(stem, byStem.has(stem) ? '' : name); // "" marks an ambiguous stem: only a full path may claim it
  }
  const meta = new Map();
  let unmatched = 0;
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue;
    const path = managerPath(item, roots);
    const name = byPath.get(loraKey(path)) || byStem.get(loraStem(path).toLowerCase()) || '';
    if (!name) { unmatched++; continue; }
    if (!meta.has(name)) meta.set(name, item);
  }
  return {rows: names.map(name => loraRow(name, meta.get(name))), unmatched, decorated: meta.size};
}

function loraRow(name, item) {
  return {
    name, stem: loraStem(name),
    display: String(item?.model_name || '').trim() || loraStem(name),
    folder: String(item?.folder || '').trim() || loraFolder(name),
    baseModel: String(item?.base_model || '').trim(),
    preview: String(item?.preview_url || ''),
    favorite: !!item?.favorite,
    usage: Number(item?.usage_count) || 0,
    modified: Number(item?.modified) || 0,
    tags: (Array.isArray(item?.tags) ? item.tags : []).filter(t => typeof t === 'string' && t.trim()).slice(0, 8),
    known: !!item
  };
}

// ---------- the picker's own filtering ----------
// The whole list is in memory (one 9 KB fetch plus the manager's pages), so searching and sorting never go back to
// the network: typing filters instantly even with a few thousand loras.
export const LORA_SORTS = [['name', '名称'], ['folder', '文件夹'], ['usage', '用得最多'], ['recent', '最近加的']];

export function filterLoraRows(rows, {search = '', folder = '', baseModel = '', favoritesOnly = false} = {}) {
  const terms = String(search || '').toLowerCase().split(/\s+/).filter(Boolean);
  return (Array.isArray(rows) ? rows : []).filter(r => {
    if (favoritesOnly && !r.favorite) return false;
    if (folder && r.folder !== folder) return false;
    if (baseModel && r.baseModel !== baseModel) return false;
    if (!terms.length) return true;
    const hay = [r.display, r.name, r.stem, r.folder, r.baseModel, ...(r.tags || [])].join(' ').toLowerCase();
    return terms.every(t => hay.includes(t));
  });
}

export function sortLoraRows(rows, sort = 'name') {
  const list = [...(Array.isArray(rows) ? rows : [])];
  const byName = (a, b) => a.display.localeCompare(b.display, 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN');
  if (sort === 'usage') return list.sort((a, b) => b.usage - a.usage || byName(a, b));
  if (sort === 'recent') return list.sort((a, b) => b.modified - a.modified || byName(a, b));
  if (sort === 'folder') return list.sort((a, b) => a.folder.localeCompare(b.folder, 'zh-CN') || byName(a, b));
  return list.sort(byName);
}

/** The chips above the list: every folder and base model present, each with how many loras it holds. */
export function loraFacets(rows) {
  const folders = new Map(), baseModels = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    folders.set(r.folder, (folders.get(r.folder) || 0) + 1);
    if (r.baseModel) baseModels.set(r.baseModel, (baseModels.get(r.baseModel) || 0) + 1);
  }
  const out = map => [...map].map(([value, count]) => ({value, count})).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'zh-CN'));
  return {folders: out(folders), baseModels: out(baseModels), favorites: (rows || []).filter(r => r.favorite).length};
}

// ---------- transports ----------
const probes = new Map(), catalogs = new Map();
/** Drops what was probed and read for an address (or for everything), so the next read starts over. */
export function forgetLoraCache(url) {
  if (url === undefined) { probes.clear(); catalogs.clear(); return; }
  probes.delete(url); catalogs.delete(url);
}

async function request(send) {
  let response;
  try { response = await send(); }
  catch (error) { throw Object.assign(Error(error?.name === 'TimeoutError' ? '读 ComfyUI 超时' : '连不上'), {code: 'TRANSPORT'}); }
  if (!response.ok) throw Object.assign(Error(`接口返回 ${response.status}`), {code: 'TRANSPORT', status: response.status});
  try { return await response.json(); }
  catch { throw Object.assign(Error('返回的不是 JSON'), {code: 'TRANSPORT'}); }
}

/** A reader for one transport: path → parsed JSON, or a TRANSPORT error that makes the probe try the next way. */
function reader(transport, {fetch = globalThis.fetch, headers = {}, url}) {
  if (transport === 'direct') {
    return path => request(() => fetch(url + path, {headers: {Accept: 'application/json'}, signal: AbortSignal.timeout(DIRECT_TIMEOUT)}));
  }
  return path => request(() => fetch(LORA_PLUGIN_BASE + '/lm', {
    method: 'POST', headers: {'Content-Type': 'application/json', ...headers},
    body: JSON.stringify({url, path}), signal: AbortSignal.timeout(PLUGIN_TIMEOUT)
  }));
}

/** The old tavern patch, read without complaint where it is still installed. */
async function legacyNames({fetch = globalThis.fetch, headers = {}, url}) {
  let response;
  try {
    response = await fetch('/api/sd/comfy/loras', {
      method: 'POST', headers: {'Content-Type': 'application/json', ...headers},
      body: JSON.stringify({url}), signal: AbortSignal.timeout(PLUGIN_TIMEOUT)
    });
  } catch { return []; }
  if (!response.ok) return [];
  const list = await response.json().catch(() => []);
  return (Array.isArray(list) ? list : []).map(m => typeof m === 'string' ? m : String(m?.value || '')).filter(Boolean);
}

async function probe(deps) {
  let spineOnly = null;
  for (const transport of ['direct', 'plugin']) {
    const read = reader(transport, deps);
    try {
      const info = await read(VERSION_PATH);
      if (info?.success && info?.version) return {transport, manager: String(info.version), spine: null};
    } catch { /* 这条路不通，或者那边没装 Lora Manager */ }
    // Remember the first transport that can at least read ComfyUI's own list, in case no manager turns up at all.
    if (!spineOnly) {
      try { const spine = spineNames(await read(SPINE_PATH)); if (spine.length) spineOnly = {transport, manager: '', spine}; }
      catch { /* 换下一种传输 */ }
    }
  }
  if (spineOnly) return spineOnly;
  const legacy = await legacyNames(deps);
  if (legacy.length) return {transport: 'legacy', manager: '', spine: legacy};
  return {transport: 'none', manager: '', spine: []};
}

/** How this address can be read right now: {transport, manager (version or ""), spine}. Cached for a minute. */
export async function loraSource({fetch = globalThis.fetch, headers = {}, url, force = false}) {
  const hit = probes.get(url);
  if (!force && hit && Date.now() - hit.at < PROBE_TTL) return hit.source;
  const source = await probe({fetch, headers, url});
  probes.set(url, {at: Date.now(), source});
  return source;
}

/** A row's preview as something <img src> can use: straight from ComfyUI, or forwarded by the tavern plugin. */
export function previewSrc(transport, url, preview) {
  const path = String(preview || '');
  if (!path.startsWith('/api/lm/')) return '';
  if (transport === 'direct') return url + path;
  if (transport === 'plugin') return `${LORA_PLUGIN_BASE}/file?url=${encodeURIComponent(url)}&path=${encodeURIComponent(path)}`;
  return '';
}

async function managerItems(read) {
  const roots = await read(ROOTS_PATH).then(r => (Array.isArray(r?.roots) ? r.roots : [])).catch(() => []);
  const items = [];
  let truncated = false;
  for (let page = 1; ; page++) {
    const data = await read(`${LIST_PATH}?page=${page}&page_size=${PAGE_SIZE}`);
    const batch = Array.isArray(data?.items) ? data.items : [];
    items.push(...batch);
    if (!batch.length || page >= (Number(data?.total_pages) || 1)) break;
    if (page >= MAX_PAGES) { truncated = true; break; }
  }
  return {items, roots, truncated};
}

async function buildCatalog(deps) {
  const source = await loraSource(deps);
  if (source.transport === 'none') throw Object.assign(Error(NO_SOURCE), {code: 'NOSOURCE'});
  const base = {transport: source.transport, manager: source.manager, truncated: false, unmatched: 0, decorated: 0};
  const plain = spine => { const {rows} = mergeLoraRows(spine, [], []); return {...base, rows, total: rows.length}; };
  if (source.transport === 'legacy') return plain(source.spine);

  const read = reader(source.transport, deps);
  const spine = source.spine?.length ? source.spine : spineNames(await read(SPINE_PATH));
  if (!spine.length) throw Object.assign(Error(NO_LOADER), {code: 'NOLOADER'});
  if (!source.manager) return plain(spine);

  // A manager read that fails here is not worth losing the list over: the names alone still let the user pick.
  let items = [], roots = [], truncated = false;
  try { ({items, roots, truncated} = await managerItems(read)); } catch { items = []; }
  const merged = mergeLoraRows(spine, items, roots);
  return {
    ...base, truncated, unmatched: merged.unmatched, decorated: merged.decorated,
    rows: merged.rows.map(r => ({...r, preview: previewSrc(source.transport, deps.url, r.preview)})),
    total: merged.rows.length
  };
}

/** Everything the picker shows: {transport, manager, rows, total, decorated, unmatched, truncated}. */
export async function loraCatalog({fetch = globalThis.fetch, headers = {}, url, force = false}) {
  const hit = catalogs.get(url);
  if (!force && hit && Date.now() - hit.at < CATALOG_TTL) return hit.catalog;
  const catalog = await buildCatalog({fetch, headers, url, force});
  catalogs.set(url, {at: Date.now(), catalog});
  return catalog;
}

/** The trigger words Lora Manager already scanned for a file: no hashing here, and no Civitai call from here. */
export async function loraTriggerWords({fetch = globalThis.fetch, headers = {}, url, name}) {
  const source = await loraSource({fetch, headers, url});
  if (!source.manager) throw Object.assign(Error(NO_MANAGER), {code: 'NOMANAGER'});
  // The lookup matches the bare file name only: a path, or anything with ".safetensors" still on it, finds nothing.
  const data = await reader(source.transport, {fetch, headers, url})(`${TRIGGER_PATH}?name=${encodeURIComponent(loraStem(name))}`);
  const words = (Array.isArray(data?.trigger_words) ? data.trigger_words : []).map(w => String(w ?? '').trim()).filter(Boolean);
  return {trigger: [...new Set(words)].join(', ')};
}
