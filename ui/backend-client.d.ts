/** Public API returned by the installed ST-iPhonie panel bridge (backend API 1.0.0 plus drawing). */
export type Engine = 'fish' | 'mini' | 'eleven';
/** Keys cover the voice engines and NovelAI. */
export type KeyEngine = Engine | 'nai';
export type Theme = 'system' | 'light' | 'dark';
export type InjectionPosition = 'in_chat' | 'in_prompt' | 'before_prompt';
export type MessageRole = 'system' | 'user' | 'assistant';

export interface VoiceBinding { voice: string; model: string; }
export interface Route {
    id?: string;
    name: string;
    engine: Engine;
    voice: string;
    /** Empty string follows the engine connection's model. */
    model: string;
    /** Empty string follows general.defaultLanguage. */
    language?: string;
    bindings: Partial<Record<Engine, VoiceBinding>>;
    /** Fixed appearance tags added when this character appears in a picture. */
    appearance?: string;
}
export type RouteInput = Pick<Route, 'name'> & Partial<Omit<Route, 'name'>>;
export type RequestRoute = Pick<Route, 'voice'> & Partial<Omit<Route, 'voice'>>;
export interface Connection {
    model: string;
    region?: 'cn' | 'uw' | 'global';
    /** Keys are the engine schema field keys, including dotted names. */
    params: Record<string, unknown>;
    parametersVersion?: number;
}
export type ConnectionPatch = Partial<Connection>;
export interface GeneralSettings {
    defaultLanguage: string;
    cacheEnabled: boolean;
    floatingEnabled: boolean;
    waveformEnabled: boolean;
}
export interface Injection {
    position: InjectionPosition;
    depth: number;
    role: MessageRole;
}
export interface PresetEntry {
    id: string;
    title: string;
    enabled: boolean;
    text: string;
    /** Omit to inherit the preset's insertion configuration. */
    injection?: Injection;
}
export interface Preset {
    id: string;
    name: string;
    format: string;
    injection: Injection;
    entries: PresetEntry[];
}
export type PresetInput = Omit<Preset, 'id'> & { id?: string };
export interface Settings {
    version: 1;
    scope: string;
    enabled: boolean;
    theme: Theme;
    general: GeneralSettings;
    selected: string;
    activePreset: string;
    routes: Route[];
    connections: Record<Engine, Connection>;
    presets: Preset[];
    floating?: { side: 'left' | 'right'; y: number };
    draw: DrawSettings;
    chat: ChatSettings;
}
export interface DrawParams {
    model: string; width: number; height: number; steps: number; scale: number;
    sampler: string; schedule: string; /** -1 picks a random seed. */ seed: number; cfgRescale: number; variety: boolean;
}
/** 画风预设: artist and fixed tags sent to NovelAI. */
export interface DrawStyle { id: string; name: string; artist: string; positive: string; negative: string; }
/** 绘图预设: rules injected into the chat request so the model writes <img> tags. */
export interface DrawPreset { id: string; name: string; /** Pictures per reply, 1 to drawCountMax. */ count: number; injection: Injection; entries: PresetEntry[]; }
export interface DrawSettings {
    /** Inject the drawing preset into chat requests. */
    enabled: boolean;
    /** Draw new replies' pictures automatically when free. */
    auto: boolean;
    /** Keep requests inside the free tier (<=28 steps, <=1024x1024). */
    guard: boolean;
    /** Pictures in the chat start folded. */
    fold: boolean;
    queue: DrawQueueSettings;
    params: DrawParams;
    styles: DrawStyle[]; activeStyle: string;
    presets: DrawPreset[]; activePreset: string;
}
export interface DrawSettingsPatch { enabled?: boolean; auto?: boolean; guard?: boolean; fold?: boolean; queue?: Partial<DrawQueueSettings>; params?: Partial<DrawParams>; activeStyle?: string; activePreset?: string; }
/** gap: seconds between two NovelAI requests (0-60). retries: how often an "account busy" (429) is retried (0-10). */
export interface DrawQueueSettings { gap: number; retries: number; }
/** A NovelAI job: waiting in line, keeping the gap (spacing), waiting after a 429 (busy), or running. */
export interface DrawJob { key: string; label: string; state: 'waiting' | 'spacing' | 'busy' | 'running'; attempt: number; until: number; position: number; }
/** unlimited: an active Opus subscription (free small images). usage: the V5 allowance, when NovelAI reports it. */
export interface NovelAISubscription { tier: number; active: boolean; unlimited: boolean; usage: { percent: number; negative: boolean } | null; anlas: number; checkedAt: number; }
export interface DrawQuote { params: DrawParams; clamped: boolean; /** null when the subscription is unknown. */ free: boolean | null; guard: boolean; v5: boolean; usage: NovelAISubscription['usage']; }
export interface DrawCharacter { prompt: string; negative?: string; /** 0-24 on a 5x5 grid, -1 lets the model decide. */ position: number; }
export interface DrawInput { prompt: string; negative?: string; characters?: DrawCharacter[]; params?: Partial<DrawParams>; allowPaid?: boolean; name?: string; /** Queue key; the same key joins the waiting job. */ key?: string; label?: string; }
export interface DrawResult { photoId: string; seed: number; params: DrawParams; prompt: string; }
export interface SettingsSnapshot { state: Settings; revision: number; }

/** 聊天预设: how phone contacts reply, how much they see, and how a chat is brought into the story. */
export interface ChatPreset {
    id: string; name: string;
    /** Recent story messages the reply prompt includes (0-40). */ context: number;
    /** Recent chat messages the reply prompt includes (2-200). */ history: number;
    /** Template for 带进剧情; must contain {{聊天记录}}. */ bring: string;
    /** Where the brought chat is injected into the next story request. */ injection: Injection;
    entries: Array<{ id: string; title: string; enabled: boolean; text: string }>;
}
/** A contact added by hand; story roles come from the 角色 App. */
export interface Contact { id: string; name: string; persona: string; }
export interface ChatSettings { presets: ChatPreset[]; activePreset: string; contacts: Contact[]; }
export interface ChatContact { name: string; source: 'role' | 'manual'; id?: string; voice: boolean; engine: Engine | 'none'; language: string; persona: string; }
export interface ChatMessage { id: string; from: 'me' | string; kind: 'text' | 'voice' | 'photo' | 'system'; text: string; translation?: string; emotion?: string; photoId?: string; at: number; }
export interface ChatThread { id: string; type: 'dm' | 'group'; name: string; members: string[]; unread: number; createdAt: number; updatedAt: number; messages: ChatMessage[]; }
export interface ChatThreadSummary extends Omit<ChatThread, 'messages'> { count: number; last: ChatMessage | null; }
export type ChatMessageInput = Omit<ChatMessage, 'id' | 'at'>;
export interface PromptPlanEntry {
    key: string;
    text: string;
    /** SillyTavern's insertion-position number. */
    position: 0 | 1 | 2;
    depth: number;
    /** SillyTavern's role number: system 0, user 1, assistant 2. */
    role: 0 | 1 | 2;
}

export interface DialogueLine {
    role: string;
    emotion: string;
    /** Complete original-language text, including supported speech tags. */
    text: string;
    translation: string;
    start?: number;
    end?: number;
    uiIndex?: number;
}
export interface ParsedDialogueLine extends DialogueLine { start: number; end: number; }
export interface ParsedDialogue { format: string | undefined; lines: ParsedDialogueLine[]; }
export type PlaybackPhase = 'idle' | 'waiting' | 'generating' | 'playing' | 'paused' | 'error';
export type LineState = 'ungenerated' | 'ready' | 'played';
export interface PlaybackSnapshot {
    phase: PlaybackPhase;
    message: string;
    index: number;
    total: number;
    engine: Engine | '';
    speaker: string;
    line: DialogueLine | null;
    source: 'dialogue' | 'favorite';
    requestKey: string | null;
    volume: number;
}
export interface ReadyAudio {
    key: string;
    line: DialogueLine;
    route: Route;
    bytes: number;
    fromCache: boolean;
}
export interface RequestPreview {
    engine: Engine;
    url: string;
    body: Record<string, unknown>;
    format: string;
    sampleRate: number;
    channels: number;
}

export type ParameterType = 'number' | 'select' | 'boolean' | 'text' | 'lines' | 'textarea' | 'rows' | 'file';
export type ParameterOption = [value: string | number, label: string | number];
export interface ParameterField {
    key: string;
    label: string;
    type: ParameterType;
    value: unknown;
    help: string;
    min?: number;
    max?: number;
    step?: number;
    optional?: boolean;
    options?: ParameterOption[];
    columns?: ParameterField[];
    /** Empty means available; otherwise contains the reason this field is disabled. */
    unavailable?: string;
}
export interface EngineSchema {
    engine: Engine;
    model: string;
    models: Array<{ id: string; supported: boolean; reason: string }>;
    source: string;
    sourceDate: string;
    groups: Array<{ id: string; title: string; fields: ParameterField[] }>;
    connection: Connection;
    tags: string[];
}
export interface VoiceQuery { search?: string; page?: number; token?: string; }
export interface VoiceList {
    voices: Array<{ id: string; name: string }>;
    more: boolean;
    token: string;
    note: string;
}

export type PhoneApp = 'roles' | 'engines' | 'presets' | 'library' | 'gallery' | 'notes' | 'listen' | 'settings' | 'draw' | 'chat';
export type BuiltinWallpaper = 'sky' | 'silver' | 'midnight' | 'rose' | 'sand' | 'aero';
/** Look of the whole phone: colours, cards, buttons and icons. Each skin also has a matching wallpaper of the same key. */
export type PhoneSkin = 'sky' | 'aero';
export type PhoneGlyph = 'default' | PhoneApp | 'wave' | 'book' | 'music' | 'camera' | 'sliders' | 'note' | 'person' | 'microphone' | 'star' | 'headphones';
export type Wallpaper = { kind: 'builtin'; key: BuiltinWallpaper } | { kind: 'photo'; photoId: string };
export type AppIcon = { kind: 'glyph'; key: PhoneGlyph } | { kind: 'photo'; photoId: string };
export interface PhonePreferences {
    wallpaper: Wallpaper;
    icons: Partial<Record<PhoneApp, AppIcon>>;
    iconStyle: 'color' | 'glass' | 'mono';
    skin: PhoneSkin;
    lockOnOpen: boolean;
    volume: number;
    theme: Theme;
}
export interface PhonePatch extends Partial<Omit<PhonePreferences, 'icons'>> {
    /** Entries merge with saved icons; null resets only that app's icon. */
    icons?: Partial<Record<PhoneApp, AppIcon | null>>;
}
export interface PhoneCatalog {
    readonly apps: readonly PhoneApp[];
    readonly wallpapers: readonly BuiltinWallpaper[];
    readonly glyphs: readonly PhoneGlyph[];
    readonly skins: readonly PhoneSkin[];
}
export interface LocalTimestamps { createdAt: number; updatedAt: number; }
export interface Note extends LocalTimestamps { id: string; title: string; text: string; }
export interface NoteInput { id?: string; title?: string; text?: string; }
export interface MediaMetadata extends LocalTimestamps {
    id: string;
    name: string;
    type: string;
    size: number;
}
export interface Photo extends MediaMetadata { blob: Blob; }
export interface PhotoInput { name?: string; blob: Blob; }
export type ReferenceMetadata = MediaMetadata;
export interface FavoriteMetadata extends LocalTimestamps {
    id: string;
    requestKey: string;
    role: string;
    text: string;
    translation: string;
    engine: Engine;
    model: string;
    voice: string;
    type: string;
    size: number;
}
export interface Favorite extends FavoriteMetadata { blob: Blob; }
export interface FavoriteQuery { role?: string; }
export interface AudioMetadata {
    /** Earlier plugin cache entries can have no metadata. */
    line?: DialogueLine;
    route?: Partial<Pick<Route, 'name' | 'engine' | 'model' | 'voice'>>;
    requestKey?: string;
}
export interface CachedAudio { key: string; at: number; bytes: number; metadata: AudioMetadata; }
export interface CacheStats { count: number; bytes: number; available: boolean; }
export interface LibraryStats { bytes: number; limit: number; notes: number; photos: number; favorites: number; references: number; }
export type LibraryCollection = 'favorites' | 'cache' | 'photos' | 'notes';

export type BackendEvent =
    | ({ type: 'playback'; revision: number } & PlaybackSnapshot)
    | ({ type: 'audio-ready'; revision: number } & ReadyAudio)
    | { type: 'settings'; revision: number; state: Settings }
    | { type: 'keys'; revision: number; engine: Engine; configured: boolean }
    | { type: 'library'; revision: number; collection: LibraryCollection }
    | { type: 'phone'; revision: number; preferences: PhonePreferences }
    | { type: 'draw'; revision: number; phase?: 'generating' | 'done' | 'error' | 'cancelled'; message?: string; subscription?: NovelAISubscription; queue?: DrawJob[] }
    /** A chat changed; typing is set while a reply is being generated. threadId is null when a chat was created. */
    | { type: 'chat'; revision: number; threadId: string | null; typing?: boolean; bring?: boolean };

/** Framework-independent facade. Methods may throw validation/lifecycle errors. */
export interface BackendFacade {
    readonly apiVersion: string;
    readonly defaultPrompt: string;
    readonly defaultFormat: string;
    readonly phoneCatalog: PhoneCatalog;
    readonly picTagFormat: string;
    readonly defaultDrawRule: string;
    readonly drawCountMax: number;
    readonly defaultChatPreset: Omit<ChatPreset, 'id'>;
    readonly drawCatalog: { readonly models: readonly string[]; readonly modelNames: Readonly<Record<string, string>>; readonly samplers: readonly string[]; readonly schedules: readonly string[] };
    getState(): Settings;
    getSnapshot(): SettingsSnapshot;
    save(next: Settings, expectedRevision?: number): Settings;
    updateGeneral(patch: Partial<GeneralSettings>): Settings;
    saveRoute(route: RouteInput): Route;
    deleteRoute(id: string): Settings;
    /** Returns a changed draft; it does not save the route. */
    switchRouteEngine(route: RouteInput, engine: Engine): Route;
    validRoleName(name: unknown): boolean;
    saveConnection(engine: Engine, patch: ConnectionPatch): Connection;
    savePreset(preset: PresetInput): Preset;
    deletePreset(id: string): Settings;
    selectPreset(id: string): Settings;
    /** Returns an empty string when valid, otherwise a displayable error. */
    validatePreset(preset: PresetInput): string;
    previewPrompt(preset?: Preset): string;
    promptPlan(): PromptPlanEntry[];
    parse(text: string): ParsedDialogue;
    keyStatus(engine: KeyEngine): boolean;
    setKey(engine: KeyEngine, key: string): void;
    clearKey(engine: KeyEngine): void;
    saveDraw(patch: DrawSettingsPatch): DrawSettings;
    saveStyle(style: Omit<DrawStyle, 'id'> & { id?: string }): DrawStyle;
    deleteStyle(id: string): DrawSettings;
    saveDrawPreset(preset: Omit<DrawPreset, 'id'> & { id?: string }): DrawPreset;
    deleteDrawPreset(id: string): DrawSettings;
    /** Text injected for the active drawing preset, or for the given draft. */
    previewDrawPrompt(preset?: DrawPreset): string;
    /** Cached for ten minutes unless refresh is true; null without a NovelAI key. */
    naiSubscription(refresh?: boolean): Promise<NovelAISubscription | null>;
    /** Jobs waiting for NovelAI, first one running. */
    drawQueue(): DrawJob[];
    cancelDraw(key: string): boolean;
    cancelAllDraws(): void;
    drawQuote(params?: Partial<DrawParams>): DrawQuote;
    /** Generates one image and saves it to the album. Rejects paid requests unless allowPaid. */
    generateImage(input: DrawInput): Promise<DrawResult>;
    reference(file: Blob & { readonly name?: string }): Promise<string>;
    listReferences(): Promise<ReferenceMetadata[]>;
    deleteReference(id: string): Promise<void>;
    engineSchema(engine: Engine, connection?: Connection): EngineSchema;
    validateConnection(engine: Engine, connection: Connection): string;
    voices(engine: Engine, connection?: Connection | null, query?: VoiceQuery): Promise<VoiceList>;
    previewRequest(engine: Engine, connection: Connection | null | undefined, route: RequestRoute, line: DialogueLine): RequestPreview;
    status(): PlaybackSnapshot;
    /** Immediately sends the current playback state; call the result when unmounting. */
    subscribe(listener: (event: BackendEvent) => void): () => boolean;
    levels(): number[];
    pendingRole(): string | null;
    stop(): void;
    toggle(): void | Promise<void>;
    resume(): void | Promise<void>;
    audition(route: RouteInput): void;
    lineState(line: DialogueLine): Promise<LineState>;
    /** Persists the volume; valid values are 0 through 1. */
    setVolume(value: number): Promise<PhonePreferences>;
    getVolume(): number;
    cacheStats(): Promise<CacheStats>;
    clearCache(): Promise<CacheStats>;
    listAudio(): Promise<CachedAudio[]>;
    deleteAudio(key: string): Promise<void>;
    latestAudio(): ReadyAudio | null;
    favoriteAudio(key: string): Promise<Favorite>;
    listFavorites(query?: FavoriteQuery): Promise<FavoriteMetadata[]>;
    getFavorite(id: string): Promise<Favorite | null>;
    /** Resolves after lookup and playback handoff, not after audio playback ends. */
    playFavorite(id: string): Promise<void>;
    deleteFavorite(id: string): Promise<boolean>;
    listPhotos(): Promise<MediaMetadata[]>;
    addPhoto(value: PhotoInput): Promise<Photo>;
    getPhoto(id: string): Promise<Photo | null>;
    deletePhoto(id: string): Promise<boolean>;
    listNotes(): Promise<Note[]>;
    saveNote(value: NoteInput): Promise<Note>;
    deleteNote(id: string): Promise<boolean>;
    getPhone(): Promise<PhonePreferences>;
    savePhone(patch: PhonePatch): Promise<PhonePreferences>;
    libraryStats(): Promise<LibraryStats>;
    /** Album photos made by drawing (the workbench and in-text pictures). */
    generatedPhotos(): Promise<{ count: number; bytes: number }>;
    /** Deletes those photos from the album; returns how many were deleted. Imported photos stay. */
    deleteGeneratedPhotos(): Promise<number>;
    saveChatPreset(preset: Partial<ChatPreset> & { name: string }): ChatPreset;
    deleteChatPreset(id: string): ChatSettings;
    selectChatPreset(id: string): ChatSettings;
    /** Reply prompt with sample chat content, for the preset editor. */
    previewChatPrompt(preset?: ChatPreset): string;
    /** Empty string when the preset is valid. */
    validateChatPreset(preset: ChatPreset): string;
    saveContact(contact: Partial<Contact> & { name: string }): Contact;
    deleteContact(id: string): ChatSettings;
    /** Story roles (角色 App) first, then manual contacts. */
    chatContacts(): ChatContact[];
    listThreads(): Promise<ChatThreadSummary[]>;
    getThread(id: string): Promise<ChatThread | null>;
    chatUnread(): Promise<number>;
    createThread(value: { type: 'dm' | 'group'; members: string[]; name?: string }): Promise<ChatThread>;
    updateThread(id: string, patch: { name?: string; members?: string[] }): Promise<ChatThread>;
    deleteThread(id: string): Promise<boolean>;
    /** read: the chat is on screen, so new replies do not count as unread. */
    appendChat(id: string, messages: ChatMessageInput[], options?: { read?: boolean }): Promise<ChatThread>;
    deleteChatMessages(id: string, ids: string[]): Promise<ChatThread>;
    markThreadRead(id: string): Promise<ChatThread>;
    /** Plays a voice message through the normal player. */
    speak(line: { role: string; text: string; emotion?: string; translation?: string }): Promise<void> | void;
    /** The voice tag format voice messages use (the active voice preset's format). */
    voiceFormat(): string;
}

export interface LatestMessage { id: number; lines: ParsedDialogueLine[]; }
/** Installed-panel API: facade plus actions that access the current SillyTavern chat. */
export interface BackendAPI extends BackendFacade {
    /** Closes the settings panel; it does not dispose the backend or stop audio. */
    close(): void;
    /** id is -1 when there is no readable assistant dialogue. */
    latest(): LatestMessage;
    /** Omit lineIndex to play the whole message. Generation requires an explicit user action. */
    play(messageId: number, lineIndex?: number): void;
    /** Latest chat messages, newest first, for choosing where to insert a picture. */
    recentMessages(): Array<{ id: number; name: string; user: boolean; preview: string }>;
    /** Uploads an album photo to the tavern and attaches it to the message. */
    insertImage(messageId: number, photoId: string): Promise<{ id: number; url: string }>;
    /** Asks the chat model for picture tags describing the latest scene. */
    suggestPrompt(): Promise<string>;
    /** Pictures stored in the open tavern chat. */
    chatPictureStats(): { count: number };
    /** Deletes every picture of the open chat from the tavern; their tags show "点击生成" again. */
    clearChatPictures(): Promise<{ count: number; failed: number }>;
    /** A picture the chat asked to open in the drawing app, if any. */
    takeDraw(): (DrawInput & { tag?: string; seed?: number }) | null;
    /** Generates the contacts' next messages with the tavern's connected model and stores them. */
    chatReply(threadId: string): Promise<ChatThread>;
    /** Prepares chat messages to be injected once into the next story reply. */
    chatBring(threadId: string, messageIds: string[]): Promise<{ threadId: string; name: string; count: number; text: string }>;
    chatPendingBring(): { threadId: string; name: string; count: number } | null;
    chatCancelBring(): void;
    /** True while a reply for this chat is being generated. */
    chatTyping(threadId: string): boolean;
}
export interface PanelHostBridge { connect(source: Window): BackendAPI; }

declare global {
    interface Window {
        __stTtsPanelBridge?: PanelHostBridge;
        /** Legacy callbacks remain supported; new views should use subscribe(). */
        stTtsUpdate?: (state: PlaybackSnapshot) => void;
        stTtsOpenRole?: (routeId: string) => void;
        stTtsPanelVisibility?: (visible: boolean) => void;
        stTtsOpenDraw?: () => void;
    }
}
/** Connect only from the installed plugin's settings iframe. Defaults to its window. */
export declare function connectBackend(view?: Window): BackendAPI;