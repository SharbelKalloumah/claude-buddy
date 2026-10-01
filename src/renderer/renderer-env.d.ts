// Globals the renderer sees that lib.dom doesn't describe, plus the types for
// three.js, which the pages load straight from node_modules (no bundler).

// three ships no types at its build path, so @types/three supplies them here.
declare module '*/three/build/three.module.js' {
  export * from 'three';
}

/** Exposed by src/preload/widget.ts and src/preload/settings.ts. */
interface Window {
  buddy: BuddyBridge;
  settingsApi: SettingsApi;
}

/** Base class inside an AudioWorkletGlobalScope (see widget/pcm-worklet.ts). */
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void;
