import { BACKUP_PARTS, PART_STORES, writeBackup, readBackup } from './backup.js';
import { normalizeSettings, validateSettings, modelRules, freshState } from './state.js';
import { normalizeRoute, switchRouteEngine, removeRoute } from './routes.js';
import { DEFAULT_PROMPT, DEFAULT_FORMAT, promptPlan, validatePreset, parseDialogue, isPlaceholderRole, knownFormats } from './protocol.js';
import { TTSParameters } from './parameters.js';
import { LocalKeyStore } from './keys.js';
import { Providers, buildRequest } from './providers.js';
import { AudioCache } from './cache.js';
import { DialoguePlayer } from './player.js';
import { LocalLibrary, PHONE_APPS, PHONE_WALLPAPERS, PHONE_GLYPHS, PHONE_SKINS } from './library.js';
import { NovelAIClient, NAI_MODELS, NAI_MODEL_NAMES, NAI_SAMPLERS, NAI_SCHEDULES, buildImageRequest, guardParams, isFree, isV5, normalizeDrawParams } from './novelai.js';
import { PIC_TAG_FORMAT, DEFAULT_DRAW_RULE, DRAW_COUNT_MAX, drawPromptPlan, planRequest, validateDrawPreset, normalizeDraw, defaultDraw } from './draw.js';
import { defaultChat, normalizeChatPreset, normalizeContact, validateChatPreset, validateContact, chatContacts, buildChatRequest, activeChatPreset, normalizeVoiceText } from './chat.js';
import { ChatStore } from './chats.js';
import { DrawQueue } from './draw-queue.js';
import { CloudQueue, KeyHashQueue, newRoomCode, validRoom, sha256Hex } from './cloud-queue.js';

export const BACKEND_API_VERSION = '1.0.0';
const ENGINES = ['fish', 'mini', 'eleven'];
const clone = value => structuredClone(value);
const engineCheck = engine => { if (!ENGINES.includes(engine)) throw Error('引擎无效'); };
// Keys cover the voice engines plus NovelAI for drawing.
const keyCheck = engine => { if (engine !== 'nai') engineCheck(engine); };
const modelCheck = (engine, model) => { engineCheck(engine); if (model && !TTSParameters.catalogs[engine].models.includes(model)) throw Error('请选择列表中的模型'); };
const message = error => error instanceof TypeError ? '设置格式无效，请检查字段和条目' : error.message;

/** Framework-independent operations. Host callbacks own SillyTavern persistence and rendering. */
// Audio files are named after who said what: 诺亚 - 午安，格林小姐.
const audioName = (role, said) => [String(role || '').trim(), String(said || '').replace(/\s+/g, ' ').trim().slice(0, 30)].filter(Boolean).join(' - ') || 'ST-iPhonie 语音';

export class TTSBackend {
    constructor({ settings, persist = () => {}, notify = () => {}, change = () => {}, unknown = () => {},
        providers = new Providers(), cache, library, keyStore, sink, novelai, chats, indexedDB = globalThis.indexedDB } = {}) {
        this.settings = normalizeSettings(settings);
        validateSettings(this.settings);
        this.persist = persist;
        this.notify = notify;
        this.providers = providers;
        // Voice balances (ElevenLabs, Fish) read for the engine cards; a new audio marks them out of date.
        this.balances = new Map();
        providers.onSpend = engine => { const b = this.balances.get(engine); if (b) b.checkedAt = 0; this.emit('balance', { engine, stale: true }); };
        this.cache = cache || new AudioCache(this.settings.scope, notify, indexedDB);
        this.library = library || new LocalLibrary(this.settings.scope, { indexedDB });
        this.keyStore = keyStore || new LocalKeyStore(this.settings.scope);
        this.novelai = novelai || new NovelAIClient();
        this.chats = chats || new ChatStore(this.settings.scope, { indexedDB });
        this.subscription = null;
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
        try { for (const [engine, key] of this.keyStore.load()) { if (engine === 'nai') this.novelai.setKey(key); else this.providers.setKey(engine, key); } }
        catch (error) { this.notify(error.message); }
        try {
            const phone = await this.library.getPhone();
            if (!this.closed) this.player.setVolume(phone.volume);
            await this.loadReferences();
        } catch (error) { this.notify(error.message); }
        return this;
    }
    /** Reads the Fish reference audio the settings use into memory, for requests. */
    async loadReferences() {
        for (const reference of this.settings.connections.fish.params.references) {
            const record = await this.library.getReference(reference.audio);
            if (record && !this.closed) { const audio = await this.base64(record.blob); if (!this.closed) this.providers.references.set(record.id, audio); }
        }
    }
    /** A backup file of the chosen parts (core/backup.js BACKUP_PARTS). Keys and the account scope are never written. */
    async exportBackup(parts = Object.keys(BACKUP_PARTS), version = '') {
        this.assertOpen();
        const want = [...new Set(parts)].filter(part => BACKUP_PARTS[part]);
        if (!want.length) throw Error('请至少选一项要备份的内容');
        const stores = want.flatMap(part => PART_STORES[part]);
        const library = stores.length ? await this.library.exportRows(stores) : {};
        let settings = null;
        if (want.includes('settings')) { settings = this.getState(); delete settings.scope; delete settings.floating; }
        const chats = want.includes('chats') ? await this.chats.exportThreads() : null;
        const blob = await writeBackup({ version, settings, library, chats });
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
    async importBackup(file, { parts = [], replace = false } = {}) {
        this.assertOpen();
        const backup = await readBackup(file), want = new Set(parts.filter(part => BACKUP_PARTS[part])), done = {};
        if (!want.size) throw Error('请至少选一项要恢复的内容');
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
        if (want.has('chats') && backup.chats) { done.chats = await this.chats.importThreads(backup.chats, { replace }); this.emit('chat', { threadId: '' }); }
        for (const collection of ['favorites', 'photos', 'notes']) if (collection in done) this.emit('library', { collection });
        if ('phone' in done || 'photos' in done) this.emit('phone', { preferences: await this.getPhone() });
        return done;
    }
    assertOpen() { if (this.closed) throw Error('插件已关闭，请重新打开设置'); }
    emit(type, data = {}) {
        if (this.closed) return;
        const event = { type, revision: this.revision, ...clone(data) };
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
        for (const key of ['voiceEnabled', 'cacheEnabled', 'floatingEnabled', 'waveformEnabled']) if (key in patch) {
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
        const next = this.getState();
        next.connections[engine] = { ...next.connections[engine], ...clone(patch), params: { ...next.connections[engine].params, ...clone(patch.params || {}) } };
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
        const saved = this.keyStore.save(engine, key);
        if (engine === 'nai') { this.novelai.setKey(saved); this.subscription = null; } else { this.providers.setKey(engine, saved); this.balances.delete(engine); }
        this.emit('keys', { engine, configured: true });
    }
    clearKey(engine) {
        keyCheck(engine); this.keyStore.save(engine, '');
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
        const value = await this.providers.balance(engine);
        this.balances.set(engine, { value, checkedAt: Date.now() });
        this.emit('balance', { engine, balance: clone(value) });
        return clone(value);
    }
    keyStatus(engine) { keyCheck(engine); return engine === 'nai' ? this.novelai.configured : this.providers.keys.has(engine); }

    // ---------- Drawing ----------
    saveDraw(patch) {
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Error('绘图设置格式无效');
        const next = this.getState(), draw = next.draw;
        if ('queue' in patch) draw.queue = normalizeDraw({ queue: { ...draw.queue, ...clone(patch.queue) } }).queue;
        for (const key of ['enabled', 'auto', 'guard', 'fold', 'strip']) if (key in patch) { if (typeof patch[key] !== 'boolean') throw Error('开关设置无效'); draw[key] = patch[key]; }
        if ('mode' in patch) { if (!['separate', 'inline'].includes(patch.mode)) throw Error('配图方式无效'); draw.mode = patch.mode; }
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
        this.subscription = await this.novelai.subscription();
        this.emit('draw', { subscription: this.subscription });
        return clone(this.subscription);
    }
    /** Whether params cost Anlas. free: true (covered), false (costs Anlas), null (subscription unknown). */
    drawQuote(params) {
        const requested = normalizeDrawParams(params || this.settings.draw.params);
        const effective = this.settings.draw.guard ? guardParams(requested) : requested;
        return { params: effective, clamped: JSON.stringify(effective) !== JSON.stringify(requested), free: isFree(effective, this.subscription), guard: this.settings.draw.guard,
            v5: isV5(effective.model), usage: this.subscription?.usage ? clone(this.subscription.usage) : null };
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
    /** Phone chat options: {voiceText: {mode, auto}}. */
    saveChatOptions(patch) {
        const next = this.getState();
        if (patch?.voiceText) next.chat.voiceText = normalizeVoiceText({ ...next.chat.voiceText, ...patch.voiceText });
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
        return buildChatRequest({ preset: p, thread, members: [{ ...contact, card: contact.persona ? '' : '（酒馆角色卡里的设定）' }], story: [{ name: '（最近的剧情）', text: '……' }], user: '{{user}}', voiceFormat: this.voiceFormat() })
            .map(m => `【${m.role}】\n${m.content}`).join('\n\n');
    }
    async chatMutate(threadId, task) {
        this.assertOpen();
        const result = await task();
        this.emit('chat', { threadId });
        return result;
    }
    /** Plays one voice message through the normal player (cache, favourites and the island all work). */
    speak(line) {
        if (!line?.role || !line.text) throw Error('这条语音没有内容');
        return this.player.start([{ role: line.role, emotion: line.emotion || 'calm', text: line.text, translation: line.translation || '' }], () => !this.closed);
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
        const text = ({ zh: '雨还没停，再坐一会儿吧。', en: 'The rain has not stopped. Stay a little longer.', ja: '雨はまだ止んでいません。もう少しここにいましょう。', ko: '비가 아직 그치지 않았어요.' })[route.language || temporary.general.defaultLanguage] || 'Hello.';
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
            voiceBalance: (engine, refresh) => this.voiceBalance(engine, refresh), keyStatus: engine => this.keyStatus(engine), setKey: (engine, key) => this.setKey(engine, key), clearKey: engine => this.clearKey(engine),
            saveDraw: patch => this.saveDraw(patch), saveStyle: style => this.saveStyle(style), deleteStyle: id => this.deleteStyle(id),
            saveDrawPreset: preset => this.saveDrawPreset(preset), deleteDrawPreset: id => this.deleteDrawPreset(id), previewDrawPrompt: preset => this.previewDrawPrompt(preset),
            naiSubscription: refresh => this.naiSubscription(refresh), drawQuote: params => this.drawQuote(params),
            generateImage: input => this.generateImage(input).then(({ blob, ...result }) => result),
            drawQueue: () => this.drawQueue.list(), cancelDraw: key => this.drawQueue.cancel(key), cancelAllDraws: () => this.drawQueue.cancelAll(),
            cloudQueueError: () => this.drawQueue.remoteError, testCloudQueue: value => this.testCloudQueue(value), newRoomCode: () => newRoomCode(),
            reference: file => this.reference(file), listReferences: () => this.library.listReferences(), deleteReference: id => this.deleteReference(id),
            engineSchema: (engine, connection) => this.getEngineSchema(engine, connection),
            validateConnection: (engine, connection) => { try { modelCheck(engine, connection.model); return TTSParameters.validate(engine, connection); } catch (error) { return message(error); } },
            voices: (engine, connection, query) => { engineCheck(engine); return this.providers.voices(engine, connection || this.settings.connections[engine], query); },
            previewRequest: (engine, connection, route, line) => { const request = buildRequest(engine, connection || this.settings.connections[engine], route, line, this.providers.references); if (request.body.provider?.options?.['fish-audio']?.references) for (const ref of request.body.provider.options['fish-audio'].references) ref.audio = '[本地参考音频]'; return request; },
            status: () => this.player.snapshot(), subscribe: listener => this.subscribe(listener), levels: () => this.player.sink.levels(),
            pendingRole: () => this.player.pending, stop: () => this.player.stop(), toggle: () => this.player.toggle(), resume: () => this.player.continuePending(),
            audition: route => this.audition(route), lineState: line => this.player.lineState(line),
            setVolume: value => this.savePhone({ volume: value }), getVolume: () => this.player.getVolume(),
            cacheStats: () => this.cache.stats(), clearCache: () => this.clearCache(), listAudio: () => this.cache.list(),
            deleteAudio: async key => { if (this.player.requestKey === key) this.player.stop('音频已删除'); if (this.prepared?.key === key) this.prepared = null; await this.cache.remove(key); this.emit('library', { collection: 'cache' }); },
            latestAudio: () => this.prepared ? this.audioInfo(this.prepared) : null,
            favoriteAudio: key => this.favoriteAudio(key), audioFile: ref => this.audioFile(ref),
            backupParts: () => ({ ...BACKUP_PARTS }), exportBackup: (parts, version) => this.exportBackup(parts, version), inspectBackup: file => this.inspectBackup(file), importBackup: (file, options) => this.importBackup(file, options), listFavorites: query => this.library.listFavorites(query),
            getFavorite: id => this.library.getFavorite(id), playFavorite: id => this.playFavorite(id),
            deleteFavorite: id => this.mutateLibrary('favorites', 'deleteFavorite', id),
            listPhotos: () => this.library.listPhotos(), addPhoto: value => this.mutateLibrary('photos', 'addPhoto', value),
            getPhoto: id => this.library.getPhoto(id), deletePhoto: id => this.mutateLibrary('photos', 'deletePhoto', id),
            listNotes: () => this.library.listNotes(), saveNote: value => this.mutateLibrary('notes', 'saveNote', value), deleteNote: id => this.mutateLibrary('notes', 'deleteNote', id),
            getPhone: () => this.getPhone(), savePhone: patch => this.savePhone(patch), libraryStats: () => this.library.stats(),
            generatedPhotos: () => this.generatedPhotos().then(({ count, bytes }) => ({ count, bytes })), deleteGeneratedPhotos: () => this.deleteGeneratedPhotos(),
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
        this.drawQueue.cancelAll();
        this.closing = Promise.all([this.player.close(), this.cache.close(), this.library.close()]);
        await this.closing;
    }
}