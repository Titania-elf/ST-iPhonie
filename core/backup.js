// Backup files: one JSON file holding the chosen parts of the plugin's data, with pictures and audio inside as base64.
// Keys are never written. The file is assembled in pieces, so a large album is not first built as one huge string.

export const BACKUP_FORMAT = 1;
/** The parts a backup can hold, in the order they are shown. settings brings the reference audio and the phone's look. */
export const BACKUP_PARTS = Object.freeze({
  settings: '设置、预设和角色音色',
  chats: '聊天记录',
  notes: '备忘录',
  photos: '相册',
  favorites: '收藏的语音'
});
/** Which library stores each part covers. */
export const PART_STORES = Object.freeze({settings: ['references', 'phone'], notes: ['notes'], photos: ['photos'], favorites: ['favorites'], chats: []});

const fail = message => Object.assign(new Error(message), {code: 'BACKUP'});

async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
function fromBase64(data, type) {
  const text = atob(String(data));
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return new Blob([bytes], {type: String(type || '')});
}
const isBlob = value => value && typeof value.arrayBuffer === 'function' && typeof value.size === 'number';

/** A row as JSON text, its blob (if any) written as {"$blob":{type,data}}. */
async function rowJSON(row) {
  if (!isBlob(row?.blob)) return JSON.stringify(row);
  return JSON.stringify({...row, blob: {$blob: {type: row.blob.type, data: await toBase64(row.blob)}}});
}

/**
 * Builds the backup file.
 * data: {version, settings?: object, library?: {store: rows[]}, chats?: threads[]}
 */
export async function writeBackup({version = '', settings = null, library = {}, chats = null}) {
  const pieces = [JSON.stringify({app: 'ST-iPhonie', kind: 'backup', format: BACKUP_FORMAT, version, createdAt: Date.now()}).slice(0, -1), ',"data":{'];
  const fields = [];
  if (settings) fields.push(['settings', JSON.stringify(settings)]);
  if (chats) fields.push(['chats', JSON.stringify(chats)]);
  for (const [store, rows] of Object.entries(library)) {
    const parts = ['['];
    for (let i = 0; i < rows.length; i++) parts.push(i ? ',' : '', await rowJSON(rows[i]));
    parts.push(']');
    fields.push([store, parts]);
  }
  fields.forEach(([name, value], i) => pieces.push(i ? ',' : '', JSON.stringify(name), ':', ...[value].flat()));
  pieces.push('}}');
  return new Blob(pieces, {type: 'application/json'});
}

/** Reads a backup file back: {version, createdAt, settings, chats, library: {store: rows[]}, summary}. Throws a plain
 *  Chinese message for files that are not ST-iPhonie backups. */
export async function readBackup(file) {
  if (!isBlob(file) || !file.size) throw fail('请选择备份文件');
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch { throw fail('这不是有效的备份文件（读不出内容）'); }
  if (parsed?.app !== 'ST-iPhonie' || parsed.kind !== 'backup' || !parsed.data || typeof parsed.data !== 'object') throw fail('这不是 ST-iPhonie 的备份文件');
  if (parsed.format > BACKUP_FORMAT) throw fail('这个备份来自更新版本的插件，请先更新插件再恢复');
  const library = {};
  for (const store of ['notes', 'photos', 'favorites', 'references', 'phone']) {
    const rows = parsed.data[store];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) throw fail('备份内容损坏：' + store);
    library[store] = rows.map(row => row?.blob?.$blob ? {...row, blob: fromBase64(row.blob.$blob.data, row.blob.$blob.type)} : row);
  }
  const settings = parsed.data.settings && typeof parsed.data.settings === 'object' ? parsed.data.settings : null;
  const chats = Array.isArray(parsed.data.chats) ? parsed.data.chats : null;
  const summary = {
    settings: settings ? {roles: settings.routes?.length || 0, presets: settings.presets?.length || 0} : null,
    chats: chats ? chats.length : null,
    notes: library.notes ? library.notes.length : null,
    photos: library.photos ? library.photos.length : null,
    favorites: library.favorites ? library.favorites.length : null
  };
  return {version: String(parsed.version || ''), createdAt: Number(parsed.createdAt) || 0, settings, chats, library, summary};
}
