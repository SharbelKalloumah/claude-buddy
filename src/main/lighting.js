// Lighting rules: maps the widget's Claude state to an LED scene.

const PREVIEW_MS = 5000;

class Lighting {
  constructor(led, getSettings) {
    this.led = led;
    this.getSettings = getSettings;
    this.state = 'idle';
    this.previewTimer = null;
  }

  // Called on every state update; only real changes are applied.
  setState(state) {
    if (state === this.state) return;
    this.state = state;
    this.apply();
  }

  // Re-apply the rule for the current state (after settings change or connecting).
  apply() {
    clearTimeout(this.previewTimer);
    const { enabled, rules } = this.getSettings().led;
    if (!enabled) return this.led.stopAnimation().catch(() => {});
    return this.led.showScene(rules[this.state]).catch(() => {});
  }

  // Show a scene for a few seconds, then go back to the current state's rule.
  preview(scene) {
    clearTimeout(this.previewTimer);
    this.led.showScene(scene).catch(() => {});
    this.previewTimer = setTimeout(() => this.apply(), PREVIEW_MS);
  }
}

module.exports = { Lighting, PREVIEW_MS };
