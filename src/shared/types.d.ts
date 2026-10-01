// Shapes shared by the main process, the preload bridges and the renderers.
// Global on purpose: the three live in different module systems, so there is
// nothing to import — only types, which never reach the output.

/** The four things Claude Code can be doing, as reported by the hooks. */
type BuddyState = 'idle' | 'working' | 'needs_input' | 'done';

/** A colour as the strip wants it. */
type Rgb = [number, number, number];

/** Sound effect ids; must match SOUNDS in src/renderer/shared/sounds.ts. */
type SoundId =
  | 'none' | 'whistle' | 'siren' | 'doorbell' | 'chime'
  | 'beep' | 'success' | 'tada' | 'pop' | 'click';

/** States that can play a sound. */
type SoundEvent = Exclude<BuddyState, 'idle'>;

/** Light pattern ids; must match PATTERNS in src/main/led/patterns.ts. */
type PatternId = 'none' | 'off' | 'solid' | 'pulse' | 'blink' | 'police';

/** One entry in the settings UI's pattern menu. */
interface LedPattern {
  id: PatternId;
  label: string;
  /** True when the pattern uses the rule's colour. */
  color?: boolean;
}

/** What to show on the strip: a pattern plus the colour it may use. */
interface LightRule {
  pattern: PatternId;
  color: Rgb;
}

/** A single animation frame: a colour held for some milliseconds. */
type LedFrame = [Rgb, number];

type LedStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/** A remembered controller. */
interface LedDevice {
  id: string;
  name: string;
}

/** A controller found by a scan. */
interface DetectedDevice extends LedDevice {
  rssi: number | null;
  connected: boolean;
}

/** The light as the controller currently has it. */
interface LedState {
  status: LedStatus;
  detail: string | null;
  /** null until the user has switched the strip on or off themselves. */
  on: boolean | null;
  rgb: Rgb;
  brightness: number;
  effect: number | null;
  speed: number;
  scene: PatternId | null;
}

interface SoundSettings extends Record<SoundEvent, SoundId> {
  volume: number;
  repeat: boolean;
}

interface VoiceConfig {
  enabled: boolean;
  hotkey: string;
  locale: string;
  autoSend: boolean;
}

interface LedSettings {
  enabled: boolean;
  autoConnect: boolean;
  device: LedDevice | null;
  rules: Record<BuddyState, LightRule>;
}

/** Everything that lives in settings.json. */
interface BuddySettings {
  userName: string;
  /** Master sound switch. */
  sound: boolean;
  sounds: SoundSettings;
  voice: VoiceConfig;
  led: LedSettings;
}

/** A partial update, as the settings window sends it. */
interface SettingsPatch {
  userName?: string;
  sound?: boolean;
  sounds?: Partial<SoundSettings>;
  voice?: Partial<VoiceConfig>;
  led?: {
    enabled?: boolean;
    autoConnect?: boolean;
    device?: LedDevice | null;
    rules?: Partial<Record<BuddyState, Partial<LightRule>>>;
  };
}

/** The master switch folded into the per-event choices, for the widget. */
type SoundConfig = SoundSettings & { enabled: boolean };

/** How the main process answers an invoke: errors come back, they don't throw. */
type IpcResult<T> = { ok: true; result: T } | { ok: false; error: string };

interface VoiceStatus {
  available: boolean;
  accessibility: boolean;
  /** macOS media access status, e.g. 'granted' or 'denied'. */
  microphone: string;
}

/** Everything the settings window needs on open. */
interface SettingsSnapshot {
  settings: BuddySettings;
  patterns: LedPattern[];
  locales: string[];
  led: LedState;
  state: BuddyState;
}

/** window.buddy in the widget (see src/preload/widget.ts). */
interface BuddyBridge {
  onState(cb: (state: BuddyState) => void): void;
  onSounds(cb: (sounds: SoundConfig) => void): void;
  onName(cb: (name: string) => void): void;
  onLedState(cb: (state: LedState) => void): void;
  onVoice(cb: (cfg: VoiceConfig) => void): void;
  onVoiceToggle(cb: () => void): void;
  showContextMenu(): void;
  dragStart(): void;
  dragMove(dx: number, dy: number): void;
  voice: {
    transcribe(wav: ArrayBuffer): Promise<IpcResult<{ text: string }>>;
    status(): Promise<VoiceStatus>;
  };
  openSettings(): void;
}

/** window.settingsApi in the settings window (see src/preload/settings.ts). */
interface SettingsApi {
  load(): Promise<SettingsSnapshot>;
  update(patch: SettingsPatch): Promise<IpcResult<BuddySettings>>;
  detect(): Promise<IpcResult<DetectedDevice[]>>;
  preview(scene: LightRule): Promise<IpcResult<void>>;
  connect(): Promise<IpcResult<void>>;
  disconnect(): Promise<IpcResult<void>>;
  turnOn(): Promise<IpcResult<void>>;
  turnOff(): Promise<IpcResult<void>>;
  setRgb(r: number, g: number, b: number): Promise<IpcResult<void>>;
  setBrightness(pct: number): Promise<IpcResult<void>>;
  hooksStatus(): Promise<{ installed: boolean; file: string }>;
  installHooks(autostart: boolean): Promise<IpcResult<boolean>>;
  removeHooks(): Promise<IpcResult<boolean>>;
  voiceStatus(): Promise<VoiceStatus>;
  requestVoiceAccess(): Promise<IpcResult<{ microphone: string; accessibility: boolean }>>;
  onLedState(cb: (state: LedState) => void): void;
  onSettings(cb: (settings: BuddySettings) => void): void;
}
