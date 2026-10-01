// Lighting rules: maps the widget's Claude state to an LED scene.

import type { SceneRequest } from './led/controller';

export const PREVIEW_MS = 5000;

/** What Lighting needs from the LED controller (the tests pass a stand-in). */
export interface LightingTarget {
  showScene(scene: SceneRequest): Promise<boolean | void>;
  stopAnimation(): Promise<void>;
}

export class Lighting {
  led: LightingTarget;
  getSettings: () => BuddySettings;
  state: BuddyState = 'idle';
  previewTimer: NodeJS.Timeout | undefined;

  constructor(led: LightingTarget, getSettings: () => BuddySettings) {
    this.led = led;
    this.getSettings = getSettings;
  }

  // Called on every state update; only real changes are applied.
  setState(state: BuddyState): void {
    if (state === this.state) return;
    this.state = state;
    this.apply();
  }

  // Re-apply the rule for the current state (after settings change or connecting).
  apply(): Promise<unknown> {
    clearTimeout(this.previewTimer);
    const { enabled, rules } = this.getSettings().led;
    if (!enabled) return this.led.stopAnimation().catch(() => {});
    return this.led.showScene(rules[this.state]).catch(() => {});
  }

  // Show a scene for a few seconds, then go back to the current state's rule.
  preview(scene: SceneRequest): void {
    clearTimeout(this.previewTimer);
    this.led.showScene(scene).catch(() => {});
    this.previewTimer = setTimeout(() => this.apply(), PREVIEW_MS);
  }
}
