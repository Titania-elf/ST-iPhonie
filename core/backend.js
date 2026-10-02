import { MomentStore } from './moments-store.js';
import { languageCode } from './languages.js';
import { normalizeMoments, buildMomentsRequest } from './moments.js';
import { normalizeCalls, buildCallRequest } from './call.js';
import { normalizeText, activeText, customRequest, listModels, streamText, asMessages, TEXT_PRESET_ID } from './llm.js';
import { normalizeSync, runSync, SYNC_PARTS } from './sync.js';
import { BACKUP_PARTS, PART_STORES, writeBackup, readBackup, sealKeys, openKeys } from './backup.js';
import { normalizeSettings, validateSettings, modelRules, freshState } from './state.js';
import { normalizeRoute, switchRouteEngine, removeRoute } from './routes.js';
import { DEFAULT_PROMPT, DEFAULT_FORMAT, promptPlan, validatePreset, parseDialogue, isPlaceholderRole, knownFormats } from './protocol.js';
import { TTSParameters } from './parameters.js';
import { KeyStore, keyTail, validateKey, parseTextKeys, joinTextKeys } from './keys.js';
import { Providers, buildRequest } from './providers.js';
import { AudioCache } from './cache.js';
import { DialoguePlayer } from './player.js';
import { LocalLibrary, PHONE_APPS, PHONE_WALLPAPERS, PHONE_GLYPHS, PHONE_SKINS } from './library.js';
import { NovelAIClient, relayUrl, FISH_PATHS, NAI_MODELS, NAI_MODEL_NAMES, NAI_SAMPLERS, NAI_SCHEDULES, buildImageRequest, guardParams, isFree, isV5, normalizeDrawParams } from './novelai.js';
import { PIC_TAG_FORMAT, DEFAULT_DRAW_RULE, DRAW_COUNT_MAX, drawPromptPlan, planRequest, validateDrawPreset, normalizeDraw, defaultDraw, normalizeVibeSettings } from './draw.js';
import { defaultChat, normalizeChatPreset, normalizeContact, validateChatPreset, validateContact, chatContacts, buildChatRequest, activeChatPreset, normalizeVoiceText, normalizeProfile , normalizeAvatars } from './chat.js';
import { ChatStore } from './chats.js';
import { DrawQueue } from './draw-queue.js';
import { CloudQueue, KeyHashQueue, newRoomCode, validRoom, sha256Hex } from './cloud-queue.js';
import { vibeKey, readVibeFile, imageVibe, mergeVibe, encodingFor, withEncoding, vibeSummary, vibeParameters, singleFile, bundleFile, chatu8File, strength as vibeStrength, MAX_FREE_VIBES, VIBE_ANLAS } from './vibes.js';

export const BACKEND_API_VERSION = '1.0.0';
const ENGINES = ['fish', 'mini', 'eleven', 'mimo'];
/** A small JPEG data URI of a base64 picture, for the vibe list; '' where pictures cannot be drawn (no canvas). */
async function vibeThumbnail(base64) {
    try {
        if (typeof createImageBitmap !== 'function' || !globalThis.document?.createElement) return '';
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))]));
        const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close?.();
        return canvas.toDataURL('image/jpeg', 0.82);
    } catch { return ''; }
}
const clone = value => structuredClone(value);
const engineCheck = engine => { if (!ENGINES.includes(engine)) throw Error('引擎无效'); };
// Keys cover the voice engines, NovelAI for drawing, and llm (the phone's own text model).
const keyCheck = engine => { if (engine !== 'nai' && engine !== 'llm') engineCheck(engine); };
const modelCheck = (engine, model) => { engineCheck(engine); if (model && !TTSParameters.catalogs[engine].models.includes(model)) throw Error('请选择列表中的模型'); };
const message = error => error instanceof TypeError ? '设置格式无效，请检查字段和条目' : error.message;

/** Framework-independent operations. Host callbacks own SillyTavern persistence and rendering. */
// Audio files are named after who said what: 诺亚 - 午安，格林小姐.
const audioName = (role, said) => [String(role || '').trim(), String(said || '').replace(/\s+/g, ' ').trim().slice(0, 30)].filter(Boolean).join(' - ') || 'ST-iPhonie 语音';

export class TTSBackend {
    constructor({ settings, persist = () => {}, notify = () => {}, change = () => {}, unknown = () => {},
        providers = new Providers(), cache, library, keyStore, sink, novelai, chats, indexedDB = globalThis.indexedDB, syncStorage = () => globalThis.localStorage } = {}) {
        this.settings = normalizeSettings(settings);
        validateSettings(this.settings);
        this.persist = persist;
        this.notify = notify;
        this.providers = providers;
        // Voice balances (ElevenLabs, Fish) read for the engine cards; a new audio marks them out of date.
        this.balances = new Map();
        // Several Fish keys: when one gives way to the next, the balance shown belongs to the old key.
        providers.onKeySwitch = engine => { this.balances.delete(engine); this.emit('balance', { engine, stale: true, switched: true }); };
        providers.onSpend = engine => { const b = this.balances.get(engine); if (b) b.checkedAt = 0; this.emit('balance', { engine, stale: true }); };
        this.cache = cache || new AudioCache(this.settings.scope, notify, indexedDB);
        this.library = library || new LocalLibrary(this.settings.scope, { indexedDB });
        this.keyStore = keyStore || new KeyStore(this.settings.scope, { indexedDB, onError: message => this.notify(message) });
        this.novelai = novelai || new NovelAIClient();
        this.textKeys = new Map();
        // Saved vibes by id: their summaries (core/vibes.js vibeSummary); the files themselves stay in the library.
        this.vibes = new Map();
        this.chats = chats || new ChatStore(this.settings.scope, { indexedDB });
        this.moments = new MomentStore(this.settings.scope, { indexedDB });
        this.subscription = null;
        // 保存到酒馆: the tavern's file access (set by the tavern side), what this device last saw there, and the state shown in the phone.
        this.syncFiles = null;
        this.syncStorage = syncStorage;
        this.syncState = { busy: false, error: '', lastAt: 0, remote: null, pending: false };
        this.syncTimer = 0;
        this.syncApplying = false;
        this.drawQueue = new DrawQueue({ gap: () => this.settings.draw.queue.gap * 1000, retries: () => this.settings.draw.queue.retries,
            remote: () => this.cloudQueue(), onChange: (queue, { remoteError }) => this.emit('draw', { queue, cloud: remoteError }) });
        this.listeners = new Set();
        this.revision = 0;
        this.closed = false;
        this.prepared = null;
        this.player = new DialoguePlayer({
            settings: () => this.settings, providers, cache: this.cache, ...(sink ? { sink } : {}), unknown,
            change: state => { change(state); this.emit('playback', state); },
            prepared: audio => { this.prepared = audio; this.emit('audio-ready', this.audioInfo(audio)); },
        });
    }
    async initialize() {
        this.assertOpen();
        try { await this.keyStore.open?.(); for (const [engine, key] of this.keyStore.load()) { if (engine === 'nai') this.novelai.setKey(key); else if (engine === 'llm') this.textKeys = parseTextKeys(key); else this.providers.setKey(engine, key); } }
        catch (error) { this.notify(error.message); }
        try {
            const phone = await this.library.getPhone();
            if (!this.closed) this.player.setVolume(phone.volume);
            await this.loadReferences();
            await this.loadVibes();
        } catch (error) { this.notify(error.message); }
        return this;
    }
    /** Reads the Fish reference audio and the MiMo clone samples the settings use into memory, for requests. */
    async loadReferences() {
        for (const reference of [...this.settings.connections.fish.params.references, ...(this.settings.connections.mimo?.params.samples || [])]) {
            const record = await this.library.getReference(reference.audio);
            if (record && !this.closed) { const audio = await this.base64(record.blob); if (!this.closed) this.providers.references.set(record.id, audio); }
        }
    }
    /** A backup file of the chosen parts (core/backup.js BACKUP_PARTS). Keys and the account scope are never written. */
    async exportBackup(parts = Object.keys(BACKUP_PARTS), version = '', { password = '' } = {}) {
        this.assertOpen();
        const want = [...new Set(parts)].filter(part => BACKUP_PARTS[part]);
        if (!want.length) throw Error('请至少选一项要备份的内容');
        const stores = want.flatMap(part => PART_STORES[part]);
        const library = stores.length ? await this.library.exportRows(stores) : {};
        let settings = null;
        if (want.includes('settings')) { settings = this.getState(); delete settings.scope; delete settings.floating; }
        const chats = want.includes('chats') ? await this.chats.exportThreads() : null, moments = want.includes('moments') ? await this.moments.exportPosts() : null;
        // Keys only with a password: sealed here, never written as they are.
        let keys = null;
        if (want.includes('keys')) { const all = Object.fromEntries(this.keyStore.load()); if (!Object.keys(all).length) throw Error('这台浏览器里还没有保存密钥，备份里不用带'); keys = await sealKeys(all, password); }
        // Vibe groups live in the settings; they travel with the vibes too, so a backup of only the vibes keeps them.
        const vibeGroups = want.includes('vibes') ? clone(this.settings.draw.vibe.groups) : null;
        const blob = await writeBackup({ version, settings, library, chats, moments, keys, vibeGroups });
        const day = new Date(), pad = n => String(n).padStart(2, '0');
        return { blob, name: `ST-iPhonie 备份 ${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}` };
    }
    /** What a backup file holds, to show before restoring. */
    async inspectBackup(file) {
        this.assertOpen();
        const backup = await readBackup(file);
        return { version: backup.version, createdAt: backup.createdAt, summary: backup.summary };
    }
    /**
     * Restores the chosen parts of a backup. replace: those kinds of data are emptied first; otherwise rows with the
     * same id are overwritten and the rest kept. Settings are taken whole from the backup; keys, the account scope and
     * the floating ball's place stay. Everything is checked before anything is written.
     */
    async importBackup(file, { parts = [], replace = false, password = '' } = {}) {
        this.assertOpen();
        const backup = await readBackup(file), want = new Set(parts.filter(part => BACKUP_PARTS[part])), done = {};
        if (!want.size) throw Error('请至少选一项要恢复的内容');
        // Keys first: a wrong password stops the restore before anything else changes.
        let keys = null;
        if (want.has('keys') && backup.keys) keys = await openKeys(backup.keys, password);
        let settings = null;
        if (want.has('settings') && backup.settings) {
            settings = normalizeSettings({ ...backup.settings, scope: this.settings.scope, floating: this.settings.floating });
            validateSettings(settings);
        }
        const rows = {};
        for (const part of want) for (const store of PART_STORES[part]) if (backup.library[store]) rows[store] = backup.library[store];
        // One transaction for the library: photos land before the phone's look that uses them, references before the
        // settings that point at them.
        if (Object.keys(rows).length) Object.assign(done, await this.library.importRows(rows, { replace }));
        if (settings) { this.save(settings); done.settings = true; await this.loadReferences(); }
        if (want.has('vibes') && backup.library.vibes) {
            // The groups: replace takes the backup's; merge keeps the current ones and adds or overwrites by id.
            const now = this.settings.draw.vibe, incoming = backup.vibeGroups || [];
            const groups = replace ? incoming : [...now.groups.filter(g => !incoming.some(x => x?.id === g.id)), ...incoming];
            this.saveDraw({ vibe: { groups } });
            await this.loadVibes();
            const use = this.settings.draw.vibe.use;
            if (use.kind === 'vibe' && !this.vibes.has(use.id)) this.saveDraw({ vibe: { use: { kind: '', id: '' } } });
            this.emit('draw', { vibes: true });
            done.vibeGroups = this.settings.draw.vibe.groups.length;
        }
        if (want.has('chats') && backup.chats) { done.chats = await this.chats.importThreads(backup.chats, { replace }); this.emit('chat', { threadId: '' }); }
        if (want.has('moments') && backup.moments) { done.moments = await this.moments.importPosts(backup.moments, { replace }); this.emit('moments', {}); }
        if (keys) { let count = 0; for (const [engine, key] of Object.entries(keys)) { try { this.setKey(engine, key); count++; } catch { /* an engine this version does not know */ } } done.keys = count; }
        for (const collection of ['favorites', 'photos', 'notes']) if (collection in done) this.emit('library', { collection });
        if ('phone' in done || 'photos' in done) this.emit('phone', { preferences: await this.getPhone() });
        return done;
    }
    assertOpen() { if (this.closed) throw Error('插件已关闭，请重新打开设置'); }
    emit(type, data = {}) {
        if (this.closed) return;
        const event = { type, revision: this.revision, ...clone(data) };
        if (!this.syncApplying && (type === 'chat' || type === 'moments' || (type === 'library' && ['notes', 'photos'].includes(data.collection)))) this.scheduleSync();
        for (const listener of this.listeners) { try { listener(clone(event)); } catch { /* One view cannot stop the other subscribers. */ } }
    }
    subscribe(listener) {
        this.assertOpen();
        if (typeof listener !== 'function') throw Error('状态订阅需要回调函数');
        this.listeners.add(listener);
        try { listener({ type: 'playback', revision: this.revision, ...this.player.snapshot() }); } catch { this.listeners.delete(listener); throw Error('界面无法接收播放状态'); }
        return () => this.listeners.delete(listener);
    }
    getState() { this.assertOpen(); return clone(this.settings); }
    getSnapshot() { return { state: this.getState(), revision: this.revision }; }
    save(next, expectedRevision) {
        this.assertOpen();
        if (expectedRevision !== undefined && expectedRevision !== this.revision) throw Error('配置已在别处修改，请重新读取后保存');
        let copy;
        try {
            if (!next || typeof next !== 'object' || !Array.isArray(next.routes) || !Array.isArray(next.presets)) throw Error('设置缺少角色或预设列表');
            copy = normalizeSettings(next);
            copy.scope = this.settings.scope;
            copy.routes = copy.routes.map(route => ({ ...route, id: route.id || crypto.randomUUID(), name: String(route.name || '').trim() }));
            if (new Set(copy.routes.map(route => route.id)).size !== copy.routes.length) throw Error('角色 ID 不可重复');
            if (new Set(copy.presets.map(preset => preset.id)).size !== copy.presets.length) throw Error('预设 ID 不可重复');
            for (const route of copy.routes) {
                modelCheck(route.engine, route.model);
                for (const [engine, binding] of Object.entries(route.bindings || {})) modelCheck(engine, binding.model);
            }
            for (const [engine, connection] of Object.entries(copy.connections)) modelCheck(engine, connection.model);
            validateSettings(copy);
        } catch (error) { throw Error(message(error)); }
        // The host callback completes before the service acknowledges a new settings revision.
        this.persist(clone(copy));
        this.settings = copy;
        this.revision++;
        this.emit('settings', { state: this.getState() });
        return this.getState();
    }
    updateGeneral(patch) {
        if (!patch || typeof patch !== 'object') throw Error('设置格式无效');
        const next = this.getState();
        for (const key of ['voiceEnabled', 'cacheEnabled', 'floatingEnabled', 'waveformEnabled', 'wallpaperMotion']) if (key in patch) {
            if (typeof patch[key] !== 'boolean') throw Error('开关设置无效'); next.general[key] = patch[key];
        }
        if ('defaultLanguage' in patch) {
            if (typeof patch.defaultLanguage !== 'string' || !patch.defaultLanguage.trim() || patch.defaultLanguage.length > 40) throw Error('默认语言无效');
            next.general.defaultLanguage = patch.defaultLanguage.trim();
        }
        return this.save(next);
    }
    saveRoute(value) {
        const next = this.getState();
        if (!value || typeof value.name !== 'string' || !value.name.trim() || isPlaceholderRole(value.name)) throw Error('请填写实际角色名');
        const id = value.id || crypto.randomUUID(), index = next.routes.findIndex(route => route.id === id);
        const route = normalizeRoute({ ...(index >= 0 ? next.routes[index] : { engine: 'fish', voice: '', model: '', language: '' }), ...clone(value), id, name: value.name.trim() });
        if (index >= 0) next.routes[index] = route; else next.routes.push(route);
        next.selected = id;
        this.save(next);
        return clone(this.settings.routes.find(row => row.id === id));
    }
    deleteRoute(id) {
        const route = this.settings.routes.find(row => row.id === id);
        if (route && (this.player.pending === route.name || this.player.queue.some(line => line.role === route.name))) this.player.stop('角色配音已删除');
        return this.save(removeRoute(this.settings, id));
    }
    saveConnection(engine, patch) {
        engineCheck(engine);
        if (!patch || typeof patch !== 'object' || Array.isArray(patch) || ('params' in patch && (!patch.params || typeof patch.params !== 'object' || Array.isArray(patch.params)))) throw Error('引擎设置格式无效');
        patch = clone(patch);
        // Fish relay: an address checked like the NovelAI one ('' = straight to Fish). A new address: the balance is read again.
        if (engine === 'fish' && 'relay' in patch) { patch.relay = relayUrl(patch.relay, undefined, FISH_PATHS); if (patch.relay !== this.settings.connections.fish.relay) this.balances.delete('fish'); }
        else delete patch.relay;
        if (engine === 'fish' && 'relayApi' in patch) { if (!['fish', 'openai'].includes(patch.relayApi)) throw Error('中转接口格式无效'); this.balances.delete('fish'); }
        else if (engine !== 'fish') delete patch.relayApi;
        const next = this.getState();
        next.connections[engine] = { ...next.connections[engine], ...patch, params: { ...next.connections[engine].params, ...clone(patch.params || {}) } };
        this.save(next);
        return clone(this.settings.connections[engine]);
    }
    savePreset(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('预设格式无效');
        const next = this.getState(), preset = clone(value);
        preset.id ||= crypto.randomUUID();
        validatePreset(preset);
        const index = next.presets.findIndex(item => item.id === preset.id);
        if (index < 0) next.presets.push(preset); else next.presets[index] = preset;
        this.save(next);
        return clone(preset);
    }
    deletePreset(id) {
        const next = this.getState();
        if (!next.presets.some(preset => preset.id === id)) return next;
        if (next.presets.length === 1) throw Error('请至少保留一个提示词预设');
        next.presets = next.presets.filter(preset => preset.id !== id);
        return this.save(next);
    }
    selectPreset(id) {
        const next = this.getState();
        if (!next.presets.some(preset => preset.id === id)) throw Error('预设不存在');
        next.activePreset = id;
        return this.save(next);
    }
    previewPrompt(preset) {
        const state = preset ? { ...this.settings, activePreset: preset.id, presets: [clone(preset)] } : this.settings;
        return promptPlan(state, modelRules(state)).map(entry => entry.text).join('\n\n');
    }
    parse(text) {
        const formats = knownFormats(this.settings);
        for (const format of formats) { const lines = parseDialogue(text, format); if (lines.length) return { format, lines }; }
        return { format: formats[0], lines: [] };
    }
    setKey(engine, key) {
        keyCheck(engine); if (!String(key).trim()) throw Error('请填写密钥，或使用清除密钥');
        // The text model: a stored list (from a backup) replaces every preset's key; a plain key is the active preset's.
        if (engine === 'llm') { if (String(key).includes('\t')) this.storeTextKeys(parseTextKeys(key)); else this.setTextKey(this.settings.text.active, key); return; }
        const saved = this.keyStore.save(engine, key);
        if (engine === 'nai') { this.novelai.setKey(saved); this.subscription = null; } else { this.providers.setKey(engine, saved); this.balances.delete(engine); }
        this.emit('keys', { engine, configured: true });
    }
    /** Voice engines keep several keys: new ones are added after those saved (repeats once). Returns how many were new. */
    addKeys(engine, value) {
        engineCheck(engine);
        const fresh = validateKey(engine, value).split('\n').filter(Boolean);
        if (!fresh.length) throw Error('请填写密钥');
        const saved = this.savedKeys(engine), added = fresh.filter(key => !saved.includes(key));
        if (!added.length) throw Error(fresh.length > 1 ? '这些密钥都已经保存过了' : '这个密钥已经保存过了');
        this.setKey(engine, [...saved, ...added].join('\n'));
        return added.length;
    }
    /** Deletes one saved key by its place in the list (0-based); the last one deleted clears the engine's key. */
    removeKey(engine, index) {
        engineCheck(engine);
        const saved = this.savedKeys(engine);
        if (!Number.isInteger(index) || !saved[index]) throw Error('这个密钥已经不在了');
        saved.splice(index, 1);
        if (saved.length) this.setKey(engine, saved.join('\n')); else this.clearKey(engine);
    }
    /**
     * The user picks the key to use: it is used at once and moved to the front of the list, so it is still the one used
     * after the page is opened again. The others keep their order and still take over when it is refused.
     */
    useKey(engine, index) {
        engineCheck(engine);
        const saved = this.savedKeys(engine), key = saved[index];
        if (!Number.isInteger(index) || !key) throw Error('这个密钥已经不在了');
        if (index > 0) this.setKey(engine, [key, ...saved.filter((_, i) => i !== index)].join('\n'));
        this.providers.useKey(engine, key); this.balances.delete(engine);
        this.emit('keys', { engine, configured: true });
    }
    savedKeys(engine) { return (this.providers.keys.get(engine) || '').split('\n').filter(Boolean); }
    /** The saved keys of a voice engine as the phone shows them: last characters, in use, refused this time. Never the keys. */
    keyList(engine) { engineCheck(engine); return this.providers.keyList(engine); }
    /** The text model's keys, one per connection preset. */
    setTextKey(id, key) {
        if (!TEXT_PRESET_ID.test(String(id))) throw Error('文字模型预设无效');
        const value = [...parseTextKeys(String(key ?? '').replace(/\t/g, ' ')).values()][0];
        if (!value) throw Error('请填写密钥，或使用清除密钥');
        this.storeTextKeys(new Map(this.textKeys).set(id, value));
    }
    clearTextKey(id) { const map = new Map(this.textKeys); map.delete(id); this.storeTextKeys(map); }
    /** The last characters of a preset's key ('••••' for a key too short to show any), '' without one. */
    textKeyHint(id) { const key = this.textKeys.get(id); return key ? keyTail(key) || '••••' : ''; }
    storeTextKeys(map) { this.keyStore.save('llm', joinTextKeys(map)); this.textKeys = map; this.emit('keys', { engine: 'llm', configured: map.has(this.settings.text.active) }); }
    clearKey(engine) {
        keyCheck(engine);
        if (engine === 'llm') { this.clearTextKey(this.settings.text.active); return; }
        this.keyStore.save(engine, '');
        if (engine === 'nai') { this.novelai.setKey(''); this.subscription = null; } else { this.providers.setKey(engine, ''); this.balances.delete(engine); }
        this.emit('keys', { engine, configured: false });
    }
    /** What is left on a voice account (ElevenLabs credits, Fish API balance); null without a key. Cached for a minute. */
    async voiceBalance(engine, refresh = false) {
        keyCheck(engine);
        if (!['eleven', 'fish'].includes(engine)) throw Error('这家引擎没有提供余额查询');
        if (!this.keyStatus(engine)) return null;
        const cached = this.balances.get(engine);
        if (!refresh && cached && Date.now() - cached.checkedAt < 60 * 1000) return clone(cached.value);
        const value = await this.providers.balance(engine, this.settings.connections[engine]);
        this.balances.set(engine, { value, checkedAt: Date.now() });
        this.emit('balance', { engine, balance: clone(value) });
        return clone(value);
    }
    /** The last 4 characters of the saved key ('' without one), so the user can tell which key is in use. */
    keyHint(engine) { keyCheck(engine); if (engine !== 'nai' && engine !== 'llm') return keyTail(this.providers.currentKey(engine)); if (engine === 'llm') return this.textKeyHint(this.settings.text.active); try { return keyTail(this.keyStore.load().get(engine) || ''); } catch { return ''; } }
    /** For a voice engine with keys: how many, which one is in use (1-based) and how many were refused while this page is open. */
    keyPool(engine) { engineCheck(engine); return this.providers.keyPool(engine); }
    keyStatus(engine) { keyCheck(engine); return engine === 'nai' ? this.novelai.configured : engine === 'llm' ? this.textKeys.has(this.settings.text.active) : this.providers.keys.has(engine); }

    // ---------- 保存到酒馆 ----------
    /** The tavern's user files: {read(name, {blob}), write(name, data), remove(name)}. Without it, syncing is off. */
    setSyncFiles(files) { this.syncFiles = files; }
    #syncMemory(value) {
        const key = 'st-iphonie-sync:' + this.settings.scope;
        try {
            const storage = this.syncStorage();
            if (value === undefined) return JSON.parse(storage?.getItem(key) || 'null') || {};
            storage?.setItem(key, JSON.stringify(value));
        } catch { /* private window: this device starts from the tavern's copy again next time */ }
        return {};
    }
    #device() {
        try {
            const storage = this.syncStorage();
            let id = storage?.getItem('st-iphonie-device');
            if (!id) { id = crypto.randomUUID(); storage?.setItem('st-iphonie-device', id); }
            return id;
        } catch { return 'unknown'; }
    }
    syncStatus() {
        const { running, ...state } = this.syncState;
        return clone({ enabled: this.settings.sync.enabled, available: !!this.syncFiles, parts: SYNC_PARTS, ...state, memoryAt: this.#syncMemory().savedAt || 0 });
    }
    saveSync(patch) {
        const next = this.getState();
        next.sync = normalizeSync({ ...next.sync, ...(patch || {}) });
        const saved = this.save(next).sync;
        if (saved.enabled) this.scheduleSync(200);
        return saved;
    }
    /** Syncs soon (changes come in bursts: a chat reply is several writes). */
    scheduleSync(delay = 4000) {
        if (!this.settings.sync.enabled || !this.syncFiles || this.closed) return;
        clearTimeout(this.syncTimer);
        this.syncState.pending = true;
        this.syncTimer = setTimeout(() => { this.syncNow().catch(() => {}); }, delay);
    }
    /** One sync with the tavern: takes what changed there, writes what changed here. */
    async syncNow({ deviceName = '' } = {}) {
        this.assertOpen();
        if (!this.syncFiles) throw Error('在酒馆里打开小手机时才能保存到酒馆');
        if (this.syncState.busy) return this.syncState.running;
        clearTimeout(this.syncTimer);
        const stores = {
            read: async part => part === 'chats' ? this.chats.exportThreads() : part === 'moments' ? this.moments.exportPosts() : (await this.library.exportRows([part]))[part],
            write: async (part, items, options) => {
                if (part === 'chats') await this.chats.importThreads(items, options);
                else if (part === 'moments') await this.moments.importPosts(items, options);
                else await this.library.importRows({ [part]: items }, options);
            },
            photoBlob: row => row.blob,
        };
        this.syncState = { ...this.syncState, busy: true, pending: false, error: '' };
        this.emit('sync', this.syncStatus());
        this.syncState.running = (async () => {
            try {
                this.syncApplying = true;
                const result = await runSync({ stores, files: this.syncFiles, memory: this.#syncMemory(), device: this.#device(), deviceName: deviceName || this.syncDeviceName || '' });
                this.#syncMemory(result.memory);
                this.syncState = { ...this.syncState, busy: false, error: '', lastAt: Date.now(), remote: result.remote, lastResult: { pulled: result.pulled, pushed: result.pushed, merged: result.merged } };
                for (const part of [...result.pulled, ...result.merged]) {
                    if (part === 'chats') this.emit('chat', { threadId: '' });
                    else if (part === 'moments') this.emit('moments', {});
                    else this.emit('library', { collection: part });
                }
                if ([...result.pulled, ...result.merged].includes('photos')) this.emit('phone', { preferences: await this.getPhone() });
                return clone(result);
            } catch (error) {
                this.syncState = { ...this.syncState, busy: false, error: error.message || '同步失败' };
                throw error;
            } finally {
                this.syncApplying = false;
                delete this.syncState.running;
                this.emit('sync', this.syncStatus());
            }
        })();
        return this.syncState.running;
    }

    // ---------- 文字模型 ----------
    /** Text model options: {source:'tavern'|'custom', url, model, temperature, maxTokens}. */
    /** The text settings with a change applied: presets, active and source as given; url, model, temperature, maxTokens and name edit the preset in use. */
    textWith(patch) {
        const p = patch && typeof patch === 'object' ? patch : {};
        const text = normalizeText({ ...this.settings.text, ...Object.fromEntries(['source', 'active', 'presets'].filter(key => key in p).map(key => [key, clone(p[key])])) });
        const active = text.presets.find(x => x.id === text.active);
        for (const key of ['name', 'url', 'model', 'temperature', 'maxTokens']) if (key in p) active[key] = p[key];
        return normalizeText(text);
    }
    saveText(patch) {
        const next = this.getState();
        next.text = this.textWith(patch);
        // A deleted preset takes its key with it.
        const ids = new Set(next.text.presets.map(x => x.id)), kept = new Map([...this.textKeys].filter(([id]) => ids.has(id)));
        const saved = this.save(next).text;
        if (kept.size !== this.textKeys.size) this.storeTextKeys(kept);
        return saved;
    }
    /**
     * Writes phone text (chat, 朋友圈, calls, picture plans) with the chosen model. context: the tavern context, used
     * when the source is the tavern's model. request: {prompt, responseLength?, ...} as for generateRaw.
     */
    async generateText(context, request) {
        const text = activeText(this.settings.text);
        if (text.source === 'custom') return customRequest({ text, key: this.textKeys.get(text.id) || '', prompt: request.prompt, responseLength: request.responseLength });
        if (!context?.generateRaw) throw Error('当前酒馆版本不支持后台生成');
        // The chat-completion request the tavern builds is kept, so an empty answer can be asked again as a stream:
        // "假流式" channels only answer streamed requests, and the tavern's background generation never streams.
        const source = context.eventSource, event = context.eventTypes?.CHAT_COMPLETION_SETTINGS_READY, last = JSON.stringify(asMessages(request.prompt).at(-1)?.content ?? '');
        let payload = null;
        const keep = data => { if (!payload && data?.type === 'quiet' && JSON.stringify(data.messages?.at?.(-1)?.content ?? '') === last) payload = clone(data); };
        if (source?.on && event) source.on(event, keep);
        let empty = false;
        try {
            const text = await context.generateRaw(request);
            if (String(text ?? '').trim() || !payload) return text;
            empty = true;
        } catch (error) {
            if (!payload || !/no message generated|empty/i.test(String(error?.message || ''))) throw error;
            empty = true;
        } finally { source?.removeListener?.(event, keep); }
        if (empty) return this.streamTavern(context, payload);
    }
    /** Sends the tavern's chat-completion request again with streaming on, and reads the whole answer. */
    async streamTavern(context, payload) {
        if (typeof context.getRequestHeaders !== 'function') throw Error('模型没有返回内容');
        let response;
        try { response = await fetch('/api/backends/chat-completions/generate', { method: 'POST', headers: context.getRequestHeaders(), cache: 'no-cache', body: JSON.stringify({ ...payload, stream: true }) }); }
        catch { throw Error('模型没有返回内容，改用流式请求也没连上'); }
        if (!response.ok) throw Error(`模型没有返回内容，改用流式请求也失败了（HTTP ${response.status}）`);
        const text = await streamText(response);
        if (!text.trim()) throw Error('模型没有返回内容（普通请求和流式请求都试过了）');
        return text;
    }
    /** Model ids of the custom API (also a free connection check). `draft`: options not saved yet. */
    textModels(draft) { const text = activeText(this.textWith(draft)); return listModels({ text, key: this.textKeys.get(text.id) || '' }); }

    // ---------- Drawing ----------
    saveDraw(patch) {
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Error('绘图设置格式无效');
        const next = this.getState(), draw = next.draw;
        if ('queue' in patch) draw.queue = normalizeDraw({ queue: { ...draw.queue, ...clone(patch.queue) } }).queue;
        for (const key of ['enabled', 'auto', 'guard', 'fold', 'strip']) if (key in patch) { if (typeof patch[key] !== 'boolean') throw Error('开关设置无效'); draw[key] = patch[key]; }
        if ('mode' in patch) { if (!['separate', 'inline'].includes(patch.mode)) throw Error('配图方式无效'); draw.mode = patch.mode; }
        if ('vibe' in patch) draw.vibe = normalizeVibeSettings({ ...draw.vibe, ...clone(patch.vibe || {}) });
        if ('relay' in patch) {
            const relay = patch.relay && typeof patch.relay === 'object' ? patch.relay : {};
            draw.relay = { url: 'url' in relay ? relayUrl(relay.url) : draw.relay.url, assumeOpus: 'assumeOpus' in relay ? !!relay.assumeOpus : draw.relay.assumeOpus };
            this.subscription = null;
        }
        if ('params' in patch) draw.params = normalizeDrawParams({ ...draw.params, ...clone(patch.params) });
        if ('activeStyle' in patch) { if (!draw.styles.some(s => s.id === patch.activeStyle)) throw Error('画风预设不存在'); draw.activeStyle = patch.activeStyle; }
        if ('activePreset' in patch) { if (!draw.presets.some(p => p.id === patch.activePreset)) throw Error('绘图预设不存在'); draw.activePreset = patch.activePreset; }
        this.save(next);
        return clone(this.settings.draw);
    }
    saveStyle(value) {
        if (!value || typeof value !== 'object' || !String(value.name || '').trim()) throw Error('请填写画风名称');
        const next = this.getState(), style = { id: value.id || crypto.randomUUID(), name: String(value.name).trim(), artist: String(value.artist || ''), positive: String(value.positive || ''), negative: String(value.negative || '') };
        const index = next.draw.styles.findIndex(s => s.id === style.id);
        if (index < 0) next.draw.styles.push(style); else next.draw.styles[index] = style;
        this.save(next);
        return clone(this.settings.draw.styles.find(s => s.id === style.id));
    }
    deleteStyle(id) {
        const next = this.getState();
        if (next.draw.styles.length === 1) throw Error('请至少保留一个画风预设');
        next.draw.styles = next.draw.styles.filter(s => s.id !== id);
        return this.save(next).draw;
    }
    saveDrawPreset(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('绘图预设格式无效');
        const next = this.getState(), preset = normalizeDraw({ presets: [{ ...clone(value), id: value.id || crypto.randomUUID() }] }).presets[0];
        validateDrawPreset(preset);
        const index = next.draw.presets.findIndex(p => p.id === preset.id);
        if (index < 0) next.draw.presets.push(preset); else next.draw.presets[index] = preset;
        this.save(next);
        return clone(preset);
    }
    deleteDrawPreset(id) {
        const next = this.getState();
        if (next.draw.presets.length === 1) throw Error('请至少保留一个绘图预设');
        next.draw.presets = next.draw.presets.filter(p => p.id !== id);
        return this.save(next).draw;
    }
    previewDrawPrompt(preset) {
        const draft = preset ? normalizeDraw({ presets: [clone(preset)] }).presets[0] : null;
        if (draft) validateDrawPreset(draft);
        const draw = this.settings.draw, used = draft || draw.presets.find(p => p.id === draw.activePreset) || draw.presets[0];
        // 'separate' mode: the request made after a reply, with a stand-in for the reply.
        if (draw.mode === 'separate') return planRequest(this.settings, { message: '（这里是刚写好的正文，第一段）\n（第二段……每一段前面会标上 [P1]、[P2]）', preset: used })
            .map(m => `【${m.role}】\n${m.content}`).join('\n\n');
        return drawPromptPlan(this.settings, used).map(entry => entry.text).join('\n\n');
    }
    async naiSubscription(refresh = false) {
        this.assertOpen();
        if (!this.novelai.configured) return null;
        if (!refresh && this.subscription && Date.now() - this.subscription.checkedAt < 10 * 60 * 1000) return clone(this.subscription);
        this.novelai.relay = this.settings.draw.relay.url;
        this.subscription = await this.novelai.subscription();
        this.emit('draw', { subscription: this.subscription });
        return clone(this.subscription);
    }
    /**
     * The relay (or NovelAI itself) checked from the phone: the drawing route by an empty request that draws nothing,
     * and the subscription. {relay, draw: {ok, status}, subscription: {ok, tier} | {ok: false, status, message}}.
     */
    async naiProbe() {
        this.assertOpen();
        if (!this.novelai.configured) throw Error('还没有填写 NovelAI 密钥');
        this.novelai.relay = this.settings.draw.relay.url;
        const draw = await this.novelai.probe();
        let subscription;
        try { const s = await this.naiSubscription(true); subscription = { ok: true, tier: s.tier }; }
        catch (error) { subscription = { ok: false, status: error.status || 0, message: error.message }; }
        return { relay: !!this.settings.draw.relay.url, draw, subscription };
    }
    /** Whether params cost Anlas. free: true (covered), false (costs Anlas), null (subscription unknown). */
    drawQuote(params) {
        const requested = normalizeDrawParams(params || this.settings.draw.params);
        const effective = this.settings.draw.guard ? guardParams(requested) : requested;
        // Through a relay that does not pass the subscription on, the user may say the account is Opus: small non-V5 images count as free.
        const relay = this.settings.draw.relay, subscription = this.subscription || (relay.url && relay.assumeOpus ? { unlimited: true, active: true, usage: null, assumed: true } : null);
        // Vibes: encoding one (first use) and every vibe past four cost Anlas, so such a picture is not free.
        const vibes = this.vibePlan(effective.model), vibeAnlas = (vibes.encode + vibes.extra) * VIBE_ANLAS, free = isFree(effective, subscription);
        return { params: effective, clamped: JSON.stringify(effective) !== JSON.stringify(requested), free: vibeAnlas && free !== false ? false : free, guard: this.settings.draw.guard,
            v5: isV5(effective.model), usage: this.subscription?.usage ? clone(this.subscription.usage) : null, vibes, vibeAnlas };
    }
    // ---------- Vibes ----------
    async loadVibes() { const rows = await this.library.listVibes(); this.vibes = new Map(rows.map(row => [row.id, { ...row.meta, id: row.id, name: row.name }])); }
    listVibes() { return [...this.vibes.values()].map(clone); }
    async vibeDoc(id) {
        const row = await this.library.getVibe(id);
        if (!row) throw Error('这个 Vibe 已经不在了');
        try { return JSON.parse(await row.blob.text()); } catch { throw Error('这个 Vibe 的数据坏了，请删掉重新导入'); }
    }
    async storeVibe(doc) {
        if (!doc.thumbnail && doc.image) { const thumb = await vibeThumbnail(doc.image); if (thumb) doc = { ...doc, thumbnail: thumb }; }
        const summary = vibeSummary(doc);
        await this.library.saveVibe({ id: doc.id, name: doc.name, meta: summary, blob: new Blob([JSON.stringify(doc)], { type: 'application/json' }) });
        this.vibes.set(doc.id, summary);
        return summary;
    }
    /**
     * Imports vibe files (.naiv4vibe, .naiv4vibebundle, 智绘姬 exports) and pictures. A vibe already saved gains what it
     * lacked (encodings, image); groups in the files become groups here. names: a vibe already saved also takes the name
     * 智绘姬 gives it (importing from 智绘姬 again). {added, updated, renamed, groups, errors: [{name, message}]}.
     */
    async importVibes(files, { names = false } = {}) {
        this.assertOpen();
        const result = { added: 0, updated: 0, renamed: 0, groups: 0, errors: [] }, groups = [];
        for (const file of [...(files || [])]) {
            const name = String(file?.name || 'vibe');
            try {
                const picture = /^image\//.test(file.type || '') && !/\.naiv4vibe/i.test(name) || /\.(png|jpe?g|webp|avif|gif)$/i.test(name) && !/\.naiv4vibe/i.test(name);
                const found = picture ? { vibes: [await imageVibe(name, await this.base64(file))], groups: [] } : await readVibeFile(name, await file.text());
                for (const doc of found.vibes) {
                    if (this.vibes.has(doc.id)) {
                        const merged = mergeVibe(await this.vibeDoc(doc.id), doc);
                        if (names && found.named?.includes(doc.id) && merged.name !== doc.name) { merged.name = doc.name; result.renamed++; }
                        await this.storeVibe(merged); result.updated++;
                    }
                    else { await this.storeVibe(doc); result.added++; }
                }
                groups.push(...found.groups);
            } catch (error) { result.errors.push({ name, message: error.message }); }
        }
        if (groups.length) {
            const next = this.getState(), taken = new Set(next.draw.vibe.groups.map(g => g.name));
            for (const group of groups) {
                const same = next.draw.vibe.groups.some(g => g.name === group.name && JSON.stringify(g.items.map(i => [i.vibe, i.strength])) === JSON.stringify(group.items.map(i => [i.id, i.strength])));
                if (same) continue;
                // A group of that name left empty (its vibes were deleted, to import them again): fill it rather than make a copy.
                const empty = next.draw.vibe.groups.find(g => g.name === group.name && !g.items.length);
                if (empty) { empty.items = group.items.map(i => ({ vibe: i.id, strength: i.strength })); result.groups++; continue; }
                let name = group.name, n = 1;
                while (taken.has(name)) name = `${group.name} (${++n})`;
                taken.add(name);
                next.draw.vibe.groups.push({ id: crypto.randomUUID(), name, items: group.items.map(i => ({ vibe: i.id, strength: i.strength })) });
                result.groups++;
            }
            next.draw.vibe = normalizeVibeSettings(next.draw.vibe);
            this.save(next);
        }
        this.emit('draw', { vibes: true });
        return result;
    }
    /** Renames a vibe or sets its own strength (used when it is used alone, and as the default when added to a group). */
    async updateVibe(id, patch = {}) {
        const doc = await this.vibeDoc(id);
        if ('name' in patch) { const name = String(patch.name || '').trim().slice(0, 80); if (!name) throw Error('请填写 Vibe 名字'); doc.name = name; }
        if ('strength' in patch) doc.importInfo.strength = vibeStrength(patch.strength, doc.importInfo.strength);
        const summary = await this.storeVibe(doc);
        this.emit('draw', { vibes: true });
        return clone(summary);
    }
    /** Deletes a vibe, and takes it out of every group (and out of use). */
    async deleteVibe(id) { await this.deleteVibes([id]); }
    /** Deletes several vibes at once (one save, one redraw). Returns how many were deleted. */
    async deleteVibes(ids) {
        this.assertOpen();
        const gone = new Set([...(ids || [])].map(String).filter(id => this.vibes.has(id)));
        for (const id of gone) { await this.library.deleteVibe(id); this.vibes.delete(id); }
        const next = this.getState(), v = next.draw.vibe;
        for (const group of v.groups) group.items = group.items.filter(item => !gone.has(item.vibe));
        if (v.use.kind === 'vibe' && gone.has(v.use.id)) v.use = { kind: '', id: '' };
        this.save(next);
        this.emit('draw', { vibes: true });
        return gone.size;
    }
    /** A file to save: {vibe: id} → .naiv4vibe; {group: id} → .naiv4vibebundle; {all: true} → everything, in the 智绘姬 form. */
    async exportVibes(target = {}) {
        const safe = name => String(name).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'vibe';
        if (target.vibe) { const doc = await this.vibeDoc(target.vibe); // Not marked as JSON: saving would add .json after .naiv4vibe.
            return { name: safe(doc.name) + '.naiv4vibe', blob: new Blob([singleFile(doc)], { type: 'application/octet-stream' }) }; }
        if (target.group) {
            const group = this.settings.draw.vibe.groups.find(g => g.id === target.group);
            if (!group) throw Error('这个 Vibe 组已经不在了');
            const entries = [];
            for (const item of group.items) if (this.vibes.has(item.vibe)) entries.push({ doc: await this.vibeDoc(item.vibe), strength: item.strength });
            if (!entries.length) throw Error('这个组里没有 Vibe');
            return { name: safe(group.name) + '.naiv4vibebundle', blob: new Blob([bundleFile(entries)], { type: 'application/octet-stream' }) };
        }
        const docs = new Map();
        for (const id of this.vibes.keys()) docs.set(id, await this.vibeDoc(id));
        if (!docs.size) throw Error('还没有 Vibe');
        const groups = this.settings.draw.vibe.groups.map(g => ({ name: g.name, items: g.items.map(i => ({ id: i.vibe, strength: i.strength })) }));
        return { name: `vibes-${new Date().toISOString().slice(0, 10)}.json`, blob: new Blob([chatu8File(groups, docs)], { type: 'application/json' }) };
    }
    /**
     * The vibes a picture with this model would use (see VibePlan in ui/backend-client.d.ts). The free-tier guard keeps
     * the first four; a vibe without an encoding for the model is encoded first (2 Anlas), or left out without a picture.
     */
    vibePlan(model) {
        const v = this.settings.draw.vibe, empty = { on: false, model: !!vibeKey(model), used: [], skipped: [], over: 0, encode: 0, extra: 0 };
        if (!v.enabled || !v.use.kind) return empty;
        const items = v.use.kind === 'group' ? (v.groups.find(g => g.id === v.use.id)?.items || []).map(i => ({ id: i.vibe, strength: i.strength }))
            : [{ id: v.use.id, strength: this.vibes.get(v.use.id)?.strength ?? 0.6 }];
        const key = vibeKey(model), used = [], skipped = [];
        for (const item of items) {
            const s = this.vibes.get(item.id);
            if (!s) { skipped.push({ name: '已删除的 Vibe', why: 'missing' }); continue; }
            if (!key) { skipped.push({ name: s.name, why: 'model' }); continue; }
            const encoded = s.keys.includes(key);
            if (!encoded && !s.image) { skipped.push({ name: s.name, why: 'no-encoding' }); continue; }
            used.push({ id: item.id, name: s.name, strength: item.strength, encode: !encoded });
        }
        const over = this.settings.draw.guard ? Math.max(0, used.length - MAX_FREE_VIBES) : 0;
        if (over) used.length = MAX_FREE_VIBES;
        return { on: true, model: !!key, used, skipped, over, encode: used.filter(u => u.encode).length, extra: Math.max(0, used.length - MAX_FREE_VIBES) };
    }
    /** The encodings to send, encoding (and keeping) those missing for the model first. */
    async vibeEncodings(used, model, signal) {
        const key = vibeKey(model), list = [];
        for (const u of used) {
            let doc = await this.vibeDoc(u.id), encoding = encodingFor(doc, key);
            if (!encoding) {
                this.novelai.relay = this.settings.draw.relay.url;
                encoding = await this.novelai.encodeVibe(doc.image, model, doc.importInfo.information_extracted, signal);
                doc = await withEncoding(doc, key, doc.importInfo.information_extracted, encoding);
                await this.storeVibe(doc);
                if (this.subscription) this.subscription.checkedAt = 0;
                this.emit('draw', { vibes: true });
            }
            list.push({ encoding, strength: u.strength });
        }
        return list;
    }
    /** Generates one image and keeps it in the album. Requests wait in the NovelAI queue (see draw-queue.js).
     *  key identifies the job in the queue (the same key joins the job already waiting); label is shown in the line. */
    generateImage({ prompt, negative = '', characters = [], params, allowPaid = false, name = '', key, label = '' } = {}) {
        this.assertOpen();
        if (!String(prompt || '').trim()) return Promise.reject(Error('请先写提示词'));
        const quote = this.drawQuote(params);
        if (quote.free === false && !allowPaid) return Promise.reject(Error('这张图会扣 Anlas，需要确认后再生成'));
        const request = buildImageRequest({ prompt, negative, characters, params: quote.params });
        const job = this.drawQueue.add({ key, label: label || String(prompt).slice(0, 40), task: async signal => {
            this.assertOpen();
            this.emit('draw', { phase: 'generating' });
            if (quote.vibes.used.length) Object.assign(request.body.parameters, vibeParameters(await this.vibeEncodings(quote.vibes.used, request.params.model, signal)));
            this.novelai.relay = this.settings.draw.relay.url;
            const blob = await this.novelai.generate(request.body, signal);
            this.assertOpen();
            const photo = await this.library.addPhoto({ name: (name || 'NovelAI') + '-' + request.seed + '.png', blob });
            this.emit('library', { collection: 'photos' });
            this.emit('draw', { phase: 'done' });
            // Paid images change the Anlas balance and V5 images use up the allowance: read the subscription again next time.
            if (this.subscription && (quote.free === false || isV5(request.params.model))) this.subscription.checkedAt = 0;
            return { photoId: photo.id, seed: request.seed, params: request.params, prompt: request.body.input, blob };
        } });
        job.catch(error => { this.emit('draw', { phase: error.cancelled ? 'cancelled' : 'error', message: error.message }); });
        return job;
    }
    // ---------- Chat ----------
    /** The voice tag format used for voice messages: the active voice preset's format. */
    voiceFormat() { return (this.settings.presets.find(p => p.id === this.settings.activePreset) || this.settings.presets[0]).format || DEFAULT_FORMAT; }
    saveChatPreset(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('聊天预设格式无效');
        const next = this.getState(), preset = validateChatPreset(normalizeChatPreset({ ...clone(value), id: value.id || crypto.randomUUID() }));
        const index = next.chat.presets.findIndex(p => p.id === preset.id);
        if (index < 0) next.chat.presets.push(preset); else next.chat.presets[index] = preset;
        this.save(next);
        return clone(preset);
    }
    deleteChatPreset(id) {
        const next = this.getState();
        if (next.chat.presets.length === 1) throw Error('请至少保留一个聊天预设');
        next.chat.presets = next.chat.presets.filter(p => p.id !== id);
        return this.save(next).chat;
    }
    selectChatPreset(id) {
        const next = this.getState();
        if (!next.chat.presets.some(p => p.id === id)) throw Error('聊天预设不存在');
        next.chat.activePreset = id;
        return this.save(next).chat;
    }
    saveContact(value) {
        const next = this.getState(), contact = validateContact(normalizeContact(clone(value || {})), next.routes);
        if (next.chat.contacts.some(c => c.name === contact.name && c.id !== contact.id)) throw Error('已经有同名的联系人');
        const index = next.chat.contacts.findIndex(c => c.id === contact.id);
        if (index < 0) next.chat.contacts.push(contact); else next.chat.contacts[index] = contact;
        this.save(next);
        return clone(contact);
    }
    /** Phone chat options: {voiceText: {mode, auto}, profile: {name, status, statusText, signature, bubble, frame, background, backgroundPhoto}, starred: [name]}. */
    saveChatOptions(patch) {
        const next = this.getState();
        if (patch?.voiceText) next.chat.voiceText = normalizeVoiceText({ ...next.chat.voiceText, ...patch.voiceText });
        if (patch?.profile) next.chat.profile = normalizeProfile({ ...next.chat.profile, ...patch.profile });
        if (Array.isArray(patch?.starred)) next.chat.starred = patch.starred;
        // avatars: {name: choice | null}; null goes back to the tavern's avatar (or the first letter).
        if (patch?.avatars && typeof patch.avatars === 'object') { const merged = { ...next.chat.avatars }; for (const [name, a] of Object.entries(patch.avatars)) { if (a) merged[name] = a; else delete merged[name]; } next.chat.avatars = normalizeAvatars(merged); }
        return this.save(next).chat;
    }
    deleteContact(id) {
        const next = this.getState();
        next.chat.contacts = next.chat.contacts.filter(c => c.id !== id);
        return this.save(next).chat;
    }
    previewChatPrompt(preset) {
        const p = validateChatPreset(normalizeChatPreset(clone(preset || activeChatPreset(this.settings.chat))));
        const contact = chatContacts(this.settings)[0] || { name: '联系人', persona: '', voice: false };
        const thread = { type: 'dm', name: contact.name, members: [contact.name], messages: [{ from: 'me', kind: 'text', text: '（这里是手机里的聊天记录）' }] };
        const member = { ...contact, card: contact.persona ? '' : '（酒馆角色卡里的设定）' }, story = [{ name: '（最近的剧情）', text: '……' }], text = request => request.map(m => `【${m.role}】\n${m.content}`).join('\n\n');
        const other = { name: '另一位联系人', persona: '', card: '（酒馆角色卡里的设定）', voice: false };
        const group = { type: 'group', name: '群聊', members: [contact.name, other.name], messages: thread.messages };
        const lore = p.lore !== false ? '（这里是触发的世界书条目：常驻的，以及名字、最近的正文和聊天里命中关键词的）' : '';
        return ['━━ 私聊 ━━', text(buildChatRequest({ preset: p, thread, members: [member], story, user: '{{user}}', voiceFormat: this.voiceFormat(), lore })),
            '━━ 群聊 ━━', text(buildChatRequest({ preset: p, thread: group, members: [member, other], story, user: '{{user}}', voiceFormat: this.voiceFormat(), lore })),
            '━━ 朋友圈（刷新时） ━━', text(buildMomentsRequest({ preset: p, people: [member, other], story, user: '{{user}}', images: this.settings.moments.images, lore })),
            '━━ 电话（接通后第一句） ━━', text(buildCallRequest({ preset: p, mode: 'incoming', contact: { ...member, voice: true }, history: thread.messages, story, user: '{{user}}', voiceFormat: this.voiceFormat(), voiceRules: '（这里是这个角色的语音引擎朗读规则）', lore }))].join('\n\n');
    }
    /** 来电 options: {auto, every, dailyMax, ring}. */
    saveCalls(patch) {
        const next = this.getState(), allowed = ['auto', 'every', 'dailyMax', 'ring'];
        next.calls = normalizeCalls({ ...next.calls, ...Object.fromEntries(Object.entries(patch || {}).filter(([key]) => allowed.includes(key))) });
        return this.save(next).calls;
    }
    // ---------- 朋友圈 ----------
    /** Moments options: {auto, every, dailyMax, images, replyToMe}. */
    saveMoments(patch) {
        const next = this.getState(), allowed = ['auto', 'every', 'dailyMax', 'images', 'replyToMe'];
        next.moments = normalizeMoments({ ...next.moments, ...Object.fromEntries(Object.entries(patch || {}).filter(([key]) => allowed.includes(key))) });
        return this.save(next).moments;
    }
    /** Runs a change to the moments and tells the phone. */
    async momentsMutate(task) {
        this.assertOpen();
        const result = await task();
        this.emit('moments', {});
        return result;
    }
    async chatMutate(threadId, task) {
        this.assertOpen();
        const result = await task();
        this.emit('chat', { threadId });
        return result;
    }
    /** Plays one voice message through the normal player (cache, favourites and the island all work). */
    speak(line) {
        const lines = (Array.isArray(line) ? line : [line]).filter(l => l?.role && l.text);
        if (!lines.length) throw Error('这条语音没有内容');
        return this.player.start(lines.map(l => ({ role: l.role, emotion: l.emotion || 'calm', text: l.text, translation: l.translation || '' })), () => !this.closed);
    }
    /** Album photos made by the drawing app or in-text pictures (named NovelAI-<seed>.png / chat-<seed>.png). */
    async generatedPhotos() {
        const rows = (await this.library.listPhotos()).filter(row => /^(?:NovelAI|chat)-\d+\.png$/.test(row.name));
        return { count: rows.length, bytes: rows.reduce((n, row) => n + (row.size || 0), 0), ids: rows.map(row => row.id) };
    }
    async deleteGeneratedPhotos() {
        const { ids } = await this.generatedPhotos();
        for (const id of ids) await this.library.deletePhoto(id);
        this.emit('library', { collection: 'photos' });
        this.emit('phone', { preferences: await this.getPhone() });
        return ids.length;
    }
    /** The shared cloud queue from the drawing settings, or null when it is off or incomplete. */
    cloudQueue() {
        const c = this.settings.draw.queue.cloud;
        if (!c.enabled || !c.url) return null;
        if (c.kind === 'keyhash') {
            if (!(this.cloud instanceof KeyHashQueue) || !this.cloud.matches(c)) this.cloud = new KeyHashQueue(c, { keyHash: () => this.naiKeyHash() });
            return this.cloud;
        }
        if (!validRoom(c.room)) return null;
        if (!(this.cloud instanceof CloudQueue) || !this.cloud.matches(c)) this.cloud = new CloudQueue(c);
        return this.cloud;
    }
    /** SHA-256 of the NovelAI key, for queues that group people by key. Cached per key. */
    async naiKeyHash() {
        const key = this.novelai.key;
        if (!key) return '';
        if (this.keyHashFor !== key) { this.keyHashValue = await sha256Hex(key); this.keyHashFor = key; }
        return this.keyHashValue;
    }
    /** Checks the cloud queue address and room: {ok, length, holder} or {ok: false, message}. */
    async testCloudQueue(value) {
        const c = { ...this.settings.draw.queue.cloud, ...clone(value || {}) };
        try {
            const queue = c.kind === 'keyhash' ? new KeyHashQueue(c, { keyHash: () => this.naiKeyHash() }) : new CloudQueue(c);
            const s = await queue.status();
            return { ok: true, length: s.length, holder: s.holder, cooldown: s.cooldown };
        }
        catch (error) { return { ok: false, message: error.message }; }
    }
    async base64(blob) {
        const bytes = new Uint8Array(await blob.arrayBuffer()); let text = '';
        for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(text);
    }
    async reference(file) {
        const record = await this.library.saveReference({ name: file?.name || '参考音频', blob: file });
        const audio = await this.base64(file);
        this.assertOpen();
        this.providers.references.set(record.id, audio);
        return record.id;
    }
    async deleteReference(id) {
        const next = this.getState();
        next.connections.fish.params.references = next.connections.fish.params.references.filter(reference => reference.audio !== id);
        next.connections.mimo.params.samples = next.connections.mimo.params.samples.filter(sample => sample.audio !== id);
        this.save(next); await this.library.deleteReference(id); this.providers.references.delete(id);
    }
    getEngineSchema(engine, connection = this.settings.connections[engine]) {
        engineCheck(engine); modelCheck(engine, connection.model);
        const current = clone(connection); TTSParameters.normalize(engine, current);
        const catalog = clone(TTSParameters.catalogs[engine]);
        catalog.models = catalog.models.map(id => ({ id, supported: id !== 'drama-3-preview', reason: id === 'drama-3-preview' ? '尚未接入 Fish 兼容通道' : '' }));
        catalog.groups = catalog.groups.map(group => ({ ...group, fields: group.fields.map(field => ({
            ...field, ...(field.type === 'select' ? { options: TTSParameters.allowed(engine, field, current) } : {}),
            unavailable: TTSParameters.unavailable(engine, field, current),
            ...(field.key === 'references' ? { help: '参考音频保存在当前浏览器，按酒馆账户隔离。' } : {}),
            ...(field.key === 'samples' ? { help: '上传 mp3 或 wav（编码后不超过 10 MB），起个名字，角色的音色填这个名字。保存在当前浏览器，按酒馆账户隔离。' } : {}),
        })) }));
        return { engine, ...catalog, connection: current, tags: TTSParameters.tags(engine, current.model), tagNote: TTSParameters.tagNote(engine, current.model), sounds: current.model === 's1' && engine === 'fish' ? [...TTSParameters.vocab.FISH_S1_TONES, ...TTSParameters.vocab.FISH_S1_SOUNDS] : [], sourceDate: '2026-09-30' };
    }
    audioInfo(audio) {
        return { key: audio.key, line: clone(audio.line), route: clone(audio.route), bytes: audio.blob.size, fromCache: audio.fromCache };
    }
    /** The audio of a favorite ({favorite: id}), a cached line ({key}) or a line as spoken now ({line}), with a file name. */
    async audioFile({ favorite, key, line } = {}) {
        this.assertOpen();
        if (favorite) {
            const row = await this.library.getFavorite(favorite);
            if (!row?.blob) throw Error('这段收藏已经不在了');
            return { blob: row.blob, name: audioName(row.role, row.translation || row.text) };
        }
        if (!key && line) key = await this.player.lineKey(line);
        const prepared = key && this.prepared?.key === key ? this.prepared : null;
        const record = prepared || !key ? null : await this.cache.getRecord(key);
        const blob = prepared?.blob || record?.blob;
        if (!blob?.size) throw Error('这句还没有生成语音，先播放一次再下载');
        const said = prepared?.line || record?.metadata?.line || line || {};
        return { blob, name: audioName(said.role, said.translation || said.text) };
    }
    async favoriteAudio(key) {
        this.assertOpen();
        const prepared = this.prepared?.key === key ? this.prepared : null;
        const row = prepared ? null : await this.cache.getRecord(key);
        const blob = prepared?.blob || row?.blob;
        if (!blob) throw Error('音频已不在缓存中，请先手动播放一次');
        const line = prepared?.line || row?.metadata?.line || {};
        const route = prepared?.route || row?.metadata?.route || {};
        if (!route.engine) throw Error('旧版缓存缺少角色信息，请先手动播放这句台词再收藏');
        const favorite = await this.library.saveFavorite({ id: 'audio-' + key, requestKey: key, blob, role: line.role || route.name || '未标注角色', text: line.text || '旧版缓存音频', translation: line.translation || '', engine: route.engine || '', model: route.model || '', voice: route.voice || '' });
        this.emit('library', { collection: 'favorites' });
        return favorite;
    }
    async playFavorite(id) {
        this.assertOpen();
        // Unlock is called during the original click, before the database await.
        this.player.stop('准备播放收藏');
        const unlock = Promise.resolve(this.player.sink.unlock());
        const epoch = this.player.epoch;
        const [favorite] = await Promise.all([this.library.getFavorite(id), unlock]);
        this.assertOpen();
        if (epoch !== this.player.epoch) return;
        if (!favorite) throw Error('收藏不存在');
        this.player.playBlob(favorite.blob, { speaker: favorite.role, engine: favorite.engine, requestKey: favorite.requestKey,
            line: { role: favorite.role, text: favorite.text, translation: favorite.translation, emotion: '' } });
    }
    audition(route) {
        const temporary = this.getState();
        route = normalizeRoute(clone(route));
        if (!route.name?.trim() || isPlaceholderRole(route.name)) throw Error('请填写实际角色名');
        route.name = route.name.trim();
        temporary.routes = temporary.routes.filter(row => row.name !== route.name); temporary.routes.push(route);
        const revision = this.revision;
        const text = ({ zh: '雨还没停，再坐一会儿吧。', en: 'The rain has not stopped. Stay a little longer.', ja: '雨はまだ止んでいません。もう少しここにいましょう。', ko: '비가 아직 그치지 않았어요.' })[languageCode(route.language || temporary.general.defaultLanguage)] || 'Hello.';
        this.player.start([{ role: route.name, emotion: 'calm', text, translation: '' }], () => !this.closed && revision === this.revision, temporary);
    }
    async clearCache() {
        this.player.stop('缓存已清理'); this.prepared = null;
        await this.cache.clear(); this.assertOpen(); this.player.played.clear();
        this.emit('library', { collection: 'cache' }); return this.cache.stats();
    }
    async getPhone() { return { ...await this.library.getPhone(), theme: this.settings.theme }; }
    async savePhone(patch) {
        const { theme, ...local } = clone(patch);
        if (theme !== undefined && !['system', 'light', 'dark'].includes(theme)) throw Error('主题无效');
        const phone = await this.library.savePhone(local);
        if (theme !== undefined) this.save({ ...this.getState(), theme });
        this.assertOpen();
        this.player.setVolume(phone.volume);
        this.emit('phone', { preferences: { ...phone, theme: this.settings.theme } });
        return { ...phone, theme: this.settings.theme };
    }
    async mutateLibrary(collection, method, ...args) {
        const result = await this.library[method](...args.map(clone));
        this.emit('library', { collection });
        if (method === 'deletePhoto') this.emit('phone', { preferences: await this.getPhone() });
        return result;
    }
    api() {
        const methods = {
            getState: () => this.getState(), getSnapshot: () => this.getSnapshot(), save: (next, revision) => this.save(next, revision),
            updateGeneral: patch => this.updateGeneral(patch), saveRoute: route => this.saveRoute(route), deleteRoute: id => this.deleteRoute(id),
            switchRouteEngine, validRoleName: name => typeof name === 'string' && !!name.trim() && !isPlaceholderRole(name),
            saveConnection: (engine, patch) => this.saveConnection(engine, patch),
            savePreset: preset => this.savePreset(preset), deletePreset: id => this.deletePreset(id), selectPreset: id => this.selectPreset(id),
            validatePreset: preset => { try { validatePreset(preset); return ''; } catch (error) { return message(error); } },
            previewPrompt: preset => this.previewPrompt(preset), promptPlan: () => clone(promptPlan(this.settings, modelRules(this.settings))), parse: text => this.parse(text),
            voiceBalance: (engine, refresh) => this.voiceBalance(engine, refresh), keyStatus: engine => this.keyStatus(engine), keyHint: engine => this.keyHint(engine), keyPool: engine => this.keyPool(engine), keyList: engine => this.keyList(engine), addKeys: (engine, value) => this.addKeys(engine, value), removeKey: (engine, index) => this.removeKey(engine, index), useKey: (engine, index) => this.useKey(engine, index), setKey: (engine, key) => this.setKey(engine, key), clearKey: engine => this.clearKey(engine),
            saveDraw: patch => this.saveDraw(patch), saveStyle: style => this.saveStyle(style), deleteStyle: id => this.deleteStyle(id),
            saveDrawPreset: preset => this.saveDrawPreset(preset), deleteDrawPreset: id => this.deleteDrawPreset(id), previewDrawPrompt: preset => this.previewDrawPrompt(preset),
            naiSubscription: refresh => this.naiSubscription(refresh), naiProbe: () => this.naiProbe(), fishProbe: () => { this.assertOpen(); keyCheck('fish'); return this.providers.probeFish(clone(this.settings.connections.fish)); },
            listVibes: () => this.listVibes(), importVibes: (files, options) => this.importVibes(files, clone(options || {})), updateVibe: (id, patch) => this.updateVibe(id, clone(patch || {})), deleteVibe: id => this.deleteVibe(id), deleteVibes: ids => this.deleteVibes([...(ids || [])]), exportVibes: target => this.exportVibes(clone(target || {})), vibePlan: model => clone(this.vibePlan(model || this.settings.draw.params.model)), drawQuote: params => this.drawQuote(params),
            generateImage: input => this.generateImage(input).then(({ blob, ...result }) => result),
            drawQueue: () => this.drawQueue.list(), cancelDraw: key => this.drawQueue.cancel(key), cancelAllDraws: () => this.drawQueue.cancelAll(),
            cloudQueueError: () => this.drawQueue.remoteError, testCloudQueue: value => this.testCloudQueue(value), newRoomCode: () => newRoomCode(),
            reference: file => this.reference(file), listReferences: () => this.library.listReferences(), deleteReference: id => this.deleteReference(id),
            engineSchema: (engine, connection) => this.getEngineSchema(engine, connection),
            validateConnection: (engine, connection) => { try { modelCheck(engine, connection.model); return TTSParameters.validate(engine, connection); } catch (error) { return message(error); } },
            voices: (engine, connection, query) => { engineCheck(engine); return this.providers.voices(engine, connection || this.settings.connections[engine], query); },
            previewRequest: (engine, connection, route, line) => { const request = buildRequest(engine, connection || this.settings.connections[engine], route, line, this.providers.references); if (request.body.provider?.options?.['fish-audio']?.references) for (const ref of request.body.provider.options['fish-audio'].references) ref.audio = '[本地参考音频]'; if (request.body.audio?.voice?.startsWith?.('data:')) request.body.audio.voice = '[本地克隆样本：' + route.voice + ']'; return request; },
            status: () => this.player.snapshot(), subscribe: listener => this.subscribe(listener), levels: () => this.player.sink.levels(),
            pendingRole: () => this.player.pending, stop: () => this.player.stop(), toggle: () => this.player.toggle(), resume: () => this.player.continuePending(),
            audition: route => this.audition(route), lineState: line => this.player.lineState(line),
            setVolume: value => this.savePhone({ volume: value }), getVolume: () => this.player.getVolume(),
            cacheStats: () => this.cache.stats(), clearCache: () => this.clearCache(), listAudio: () => this.cache.list(),
            deleteAudio: async key => { if (this.player.requestKey === key) this.player.stop('音频已删除'); if (this.prepared?.key === key) this.prepared = null; await this.cache.remove(key); this.emit('library', { collection: 'cache' }); },
            latestAudio: () => this.prepared ? this.audioInfo(this.prepared) : null,
            favoriteAudio: key => this.favoriteAudio(key), audioFile: ref => this.audioFile(ref),
            backupParts: () => ({ ...BACKUP_PARTS }), exportBackup: (parts, version, options) => typeof version === 'object' && version ? this.exportBackup(parts, '', version) : this.exportBackup(parts, version, options || {}), inspectBackup: file => this.inspectBackup(file), importBackup: (file, options) => this.importBackup(file, options), listFavorites: query => this.library.listFavorites(query),
            getFavorite: id => this.library.getFavorite(id), playFavorite: id => this.playFavorite(id),
            deleteFavorite: id => this.mutateLibrary('favorites', 'deleteFavorite', id),
            listPhotos: () => this.library.listPhotos(), addPhoto: value => this.mutateLibrary('photos', 'addPhoto', value),
            getPhoto: id => this.library.getPhoto(id), deletePhoto: id => this.mutateLibrary('photos', 'deletePhoto', id),
            listNotes: () => this.library.listNotes(), saveNote: value => this.mutateLibrary('notes', 'saveNote', value), deleteNote: id => this.mutateLibrary('notes', 'deleteNote', id),
            getPhone: () => this.getPhone(), savePhone: patch => this.savePhone(patch), libraryStats: () => this.library.stats(),
            generatedPhotos: () => this.generatedPhotos().then(({ count, bytes }) => ({ count, bytes })), deleteGeneratedPhotos: () => this.deleteGeneratedPhotos(),
            saveMoments: patch => this.saveMoments(clone(patch)), saveCalls: patch => this.saveCalls(clone(patch)),
            saveText: patch => this.saveText(clone(patch)), setTextKey: (id, key) => this.setTextKey(id, key), clearTextKey: id => this.clearTextKey(id), textKeyHint: id => this.textKeyHint(id), textModels: draft => this.textModels(clone(draft || {})),
            syncStatus: () => this.syncStatus(), saveSync: patch => this.saveSync(clone(patch)), syncNow: () => this.syncNow().then(() => this.syncStatus()),
            listMoments: () => this.moments.list(), getMoment: id => this.moments.get(id),
            postMoment: ({ text, photoId } = {}) => this.momentsMutate(async () => (await this.moments.add([{ author: 'me', source: 'me', text, photoId }]))[0]),
            likeMoment: (id, on = true) => this.momentsMutate(() => this.moments.like(id, 'me', on)),
            commentMoment: (id, { text, to } = {}) => this.momentsMutate(() => this.moments.comment(id, { from: 'me', text, to })),
            deleteMoment: id => this.momentsMutate(() => this.moments.remove(id)), deleteMomentComment: (id, commentId) => this.momentsMutate(() => this.moments.removeComment(id, commentId)),
            clearMoments: () => this.momentsMutate(() => this.moments.clear()),
            saveChatPreset: preset => this.saveChatPreset(preset), deleteChatPreset: id => this.deleteChatPreset(id), selectChatPreset: id => this.selectChatPreset(id),
            previewChatPrompt: preset => this.previewChatPrompt(preset), validateChatPreset: preset => { try { validateChatPreset(normalizeChatPreset(clone(preset))); return ''; } catch (error) { return message(error); } },
            saveChatOptions: patch => this.saveChatOptions(clone(patch)), saveContact: contact => this.saveContact(contact), deleteContact: id => this.deleteContact(id), chatContacts: () => clone(chatContacts(this.settings)),
            listThreads: () => this.chats.list(), getThread: id => this.chats.get(id), chatUnread: () => this.chats.unread(),
            createThread: value => this.chatMutate(null, () => this.chats.create(clone(value))),
            updateThread: (id, patch) => this.chatMutate(id, () => this.chats.update(id, clone(patch))),
            deleteThread: id => this.chatMutate(id, () => this.chats.remove(id)),
            appendChat: (id, messages, options) => this.chatMutate(id, () => this.chats.append(id, clone(messages), clone(options || {}))),
            deleteChatMessages: (id, ids) => this.chatMutate(id, () => this.chats.removeMessages(id, clone(ids))),
            updateChatMessage: (id, messageId, patch) => this.chatMutate(id, () => this.chats.updateMessage(id, messageId, clone(patch || {}))),
            markThreadRead: id => this.chatMutate(id, () => this.chats.markRead(id)),
            speak: line => this.speak(clone(line)), voiceFormat: () => this.voiceFormat(),
        };
        return Object.freeze({ apiVersion: BACKEND_API_VERSION, defaultPrompt: DEFAULT_PROMPT, defaultFormat: DEFAULT_FORMAT,
            picTagFormat: PIC_TAG_FORMAT, defaultDrawRule: DEFAULT_DRAW_RULE, drawCountMax: DRAW_COUNT_MAX, defaultChatPreset: Object.freeze((({ id, ...rest }) => rest)(defaultChat().presets[0])),
            // The shipped presets of each kind, without ids: for 恢复默认 in the preset app.
            defaultVoicePreset: Object.freeze((({ id, ...rest }) => rest)(freshState().presets[0])), defaultDrawPreset: Object.freeze((({ id, ...rest }) => rest)(defaultDraw().presets[0])),
            drawCatalog: Object.freeze({ models: NAI_MODELS, modelNames: NAI_MODEL_NAMES, samplers: NAI_SAMPLERS, schedules: NAI_SCHEDULES }),
            phoneCatalog: Object.freeze({ apps: PHONE_APPS, wallpapers: PHONE_WALLPAPERS, glyphs: PHONE_GLYPHS, skins: PHONE_SKINS }),
            ...Object.fromEntries(Object.entries(methods).map(([name, fn]) => [name, (...args) => { this.assertOpen(); return fn(...args); }])),
        });
    }
    async close() {
        if (this.closing) return this.closing;
        this.closed = true; this.prepared = null; this.listeners.clear(); this.providers.clear();
        this.chats.close();
        clearTimeout(this.syncTimer);
        this.moments.close();
        this.drawQueue.cancelAll();
        this.closing = Promise.all([this.player.close(), this.cache.close(), this.library.close(), Promise.resolve(this.keyStore.flush?.()).then(() => this.keyStore.close?.())]);
        await this.closing;
    }
}