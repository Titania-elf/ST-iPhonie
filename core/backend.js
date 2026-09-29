import { normalizeSettings, validateSettings, modelRules } from './state.js';
import { normalizeRoute, switchRouteEngine, removeRoute } from './routes.js';
import { DEFAULT_PROMPT, DEFAULT_FORMAT, promptPlan, validatePreset, parseDialogue, isPlaceholderRole } from './protocol.js';
import { TTSParameters } from './parameters.js';
import { LocalKeyStore } from './keys.js';
import { Providers, buildRequest } from './providers.js';
import { AudioCache } from './cache.js';
import { DialoguePlayer } from './player.js';
import { LocalLibrary, PHONE_APPS, PHONE_WALLPAPERS, PHONE_GLYPHS } from './library.js';

export const BACKEND_API_VERSION = '1.0.0';
const ENGINES = ['fish', 'mini', 'eleven'];
const clone = value => structuredClone(value);
const engineCheck = engine => { if (!ENGINES.includes(engine)) throw Error('引擎无效'); };
const modelCheck = (engine, model) => { engineCheck(engine); if (model && !TTSParameters.catalogs[engine].models.includes(model)) throw Error('请选择列表中的模型'); };
const message = error => error instanceof TypeError ? '设置格式无效，请检查字段和条目' : error.message;

/** Framework-independent operations. Host callbacks own SillyTavern persistence and rendering. */
export class TTSBackend {
    constructor({ settings, persist = () => {}, notify = () => {}, change = () => {}, unknown = () => {},
        providers = new Providers(), cache, library, keyStore, sink, indexedDB = globalThis.indexedDB } = {}) {
        this.settings = normalizeSettings(settings);
        validateSettings(this.settings);
        this.persist = persist;
        this.notify = notify;
        this.providers = providers;
        this.cache = cache || new AudioCache(this.settings.scope, notify, indexedDB);
        this.library = library || new LocalLibrary(this.settings.scope, { indexedDB });
        this.keyStore = keyStore || new LocalKeyStore(this.settings.scope);
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
        try { for (const [engine, key] of this.keyStore.load()) this.providers.setKey(engine, key); }
        catch (error) { this.notify(error.message); }
        try {
            const phone = await this.library.getPhone();
            if (!this.closed) this.player.setVolume(phone.volume);
            for (const reference of this.settings.connections.fish.params.references) {
                const record = await this.library.getReference(reference.audio);
                if (record && !this.closed) { const audio = await this.base64(record.blob); if (!this.closed) this.providers.references.set(record.id, audio); }
            }
        } catch (error) { this.notify(error.message); }
        return this;
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
        for (const key of ['cacheEnabled', 'floatingEnabled', 'waveformEnabled']) if (key in patch) {
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
        const formats = [...new Set([this.settings.presets.find(p => p.id === this.settings.activePreset)?.format, ...this.settings.presets.map(p => p.format)].filter(Boolean))];
        for (const format of formats) { const lines = parseDialogue(text, format); if (lines.length) return { format, lines }; }
        return { format: formats[0], lines: [] };
    }
    setKey(engine, key) {
        engineCheck(engine); if (!String(key).trim()) throw Error('请填写密钥，或使用清除密钥');
        this.providers.setKey(engine, this.keyStore.save(engine, key)); this.emit('keys', { engine, configured: true });
    }
    clearKey(engine) { engineCheck(engine); this.keyStore.save(engine, ''); this.providers.setKey(engine, ''); this.emit('keys', { engine, configured: false }); }
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
        catalog.models = catalog.models.map(id => ({ id, supported: !['drama-3-preview', 'eleven_v3_conversational'].includes(id), reason: id === 'drama-3-preview' ? '尚未接入 Fish 兼容通道' : id === 'eleven_v3_conversational' ? '属于实时对话通道' : '' }));
        catalog.groups = catalog.groups.map(group => ({ ...group, fields: group.fields.map(field => ({
            ...field, ...(field.type === 'select' ? { options: TTSParameters.allowed(engine, field, current) } : {}),
            unavailable: TTSParameters.unavailable(engine, field, current),
            ...(field.key === 'references' ? { help: '参考音频保存在当前浏览器，按酒馆账户隔离。' } : {}),
        })) }));
        return { engine, ...catalog, connection: current, tags: TTSParameters.tags(engine, current.model), sourceDate: '2026-09-25' };
    }
    audioInfo(audio) {
        return { key: audio.key, line: clone(audio.line), route: clone(audio.route), bytes: audio.blob.size, fromCache: audio.fromCache };
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
            keyStatus: engine => { engineCheck(engine); return this.providers.keys.has(engine); }, setKey: (engine, key) => this.setKey(engine, key), clearKey: engine => this.clearKey(engine),
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
            favoriteAudio: key => this.favoriteAudio(key), listFavorites: query => this.library.listFavorites(query),
            getFavorite: id => this.library.getFavorite(id), playFavorite: id => this.playFavorite(id),
            deleteFavorite: id => this.mutateLibrary('favorites', 'deleteFavorite', id),
            listPhotos: () => this.library.listPhotos(), addPhoto: value => this.mutateLibrary('photos', 'addPhoto', value),
            getPhoto: id => this.library.getPhoto(id), deletePhoto: id => this.mutateLibrary('photos', 'deletePhoto', id),
            listNotes: () => this.library.listNotes(), saveNote: value => this.mutateLibrary('notes', 'saveNote', value), deleteNote: id => this.mutateLibrary('notes', 'deleteNote', id),
            getPhone: () => this.getPhone(), savePhone: patch => this.savePhone(patch), libraryStats: () => this.library.stats(),
        };
        return Object.freeze({ apiVersion: BACKEND_API_VERSION, defaultPrompt: DEFAULT_PROMPT, defaultFormat: DEFAULT_FORMAT,
            phoneCatalog: Object.freeze({ apps: PHONE_APPS, wallpapers: PHONE_WALLPAPERS, glyphs: PHONE_GLYPHS }),
            ...Object.fromEntries(Object.entries(methods).map(([name, fn]) => [name, (...args) => { this.assertOpen(); return fn(...args); }])),
        });
    }
    async close() {
        if (this.closing) return this.closing;
        this.closed = true; this.prepared = null; this.listeners.clear(); this.providers.clear();
        this.closing = Promise.all([this.player.close(), this.cache.close(), this.library.close()]);
        await this.closing;
    }
}