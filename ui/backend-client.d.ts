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
}
export interface DrawParams {
    model: string; width: number; height: number; steps: number; scale: number;
    sampler: string; schedule: string; /** -1 picks a random seed. */ seed: number; cfgRescale: number; variety: boolean;
}
/** 画风预设: artist and fixed tags sent to NovelAI. */
export interface DrawStyle { id: string; name: string; artist: string; positive: string; negative: string; }
/** 绘图预设: rules injected into the chat request so the model writes <img> tags. */
export interface DrawPreset { id: string; name: string; injection: Injection; entries: PresetEntry[]; }
export interface DrawSettings {
    /** Inject the drawing preset into chat requests. */
    enabled: boolean;
    /** Draw new replies' pictures automatically when free. */
    auto: boolean;
    /** Keep requests inside the free tier (<=28 steps, <=1024x1024). */
    guard: boolean;
    params: DrawParams;
    styles: DrawStyle[]; activeStyle: string;
    presets: DrawPreset[]; activePreset: string;
}
export interface DrawSettingsPatch { enabled?: boolean; auto?: boolean; guard?: boolean; params?: Partial<DrawParams>; activeStyle?: string; activePreset?: string; }
export interface NovelAISubscription { tier: number; active: boolean; unlimited: boolean; anlas: number; checkedAt: number; }
export interface DrawQuote { params: DrawParams; clamped: boolean; /** null when the subscription is unknown. */ free: boolean | null; guard: boolean; }
export interface DrawCharacter { prompt: string; negative?: string; /** 0-24 on a 5x5 grid, -1 lets the model decide. */ position: number; }
export interface DrawInput { prompt: string; negative?: string; characters?: DrawCharacter[]; params?: Partial<DrawParams>; allowPaid?: boolean; name?: string; }
export interface DrawResult { photoId: string; seed: number; params: DrawParams; prompt: string; }
export interface SettingsSnapshot { state: Settings; revision: number; }
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

export type PhoneApp = 'roles' | 'engines' | 'presets' | 'library' | 'gallery' | 'notes' | 'listen' | 'settings';
export type BuiltinWallpaper = 'sky' | 'silver' | 'midnight' | 'rose' | 'sand';
export type PhoneGlyph = 'default' | PhoneApp | 'wave' | 'book' | 'music' | 'camera' | 'sliders' | 'note' | 'person' | 'microphone' | 'star' | 'headphones';
export type Wallpaper = { kind: 'builtin'; key: BuiltinWallpaper } | { kind: 'photo'; photoId: string };
export type AppIcon = { kind: 'glyph'; key: PhoneGlyph } | { kind: 'photo'; photoId: string };
export interface PhonePreferences {
    wallpaper: Wallpaper;
    icons: Partial<Record<PhoneApp, AppIcon>>;
    iconStyle: 'color' | 'glass' | 'mono';
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
    | { type: 'draw'; revision: number; phase?: 'generating' | 'done' | 'error'; message?: string; subscription?: NovelAISubscription };

/** Framework-independent facade. Methods may throw validation/lifecycle errors. */
export interface BackendFacade {
    readonly apiVersion: string;
    readonly defaultPrompt: string;
    readonly defaultFormat: string;
    readonly phoneCatalog: PhoneCatalog;
    readonly picTagFormat: string;
    readonly defaultDrawRule: string;
    readonly drawCatalog: { readonly models: readonly string[]; readonly samplers: readonly string[]; readonly schedules: readonly string[] };
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
    /** A picture the chat asked to open in the drawing app, if any. */
    takeDraw(): (DrawInput & { tag?: string; seed?: number }) | null;
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