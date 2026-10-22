// Persistent user settings (localStorage, with safe fallbacks and schema
// migration so saved preferences survive upgrades).
const KEY = 'hw27.settings';
export const SETTINGS_VERSION = 2;
export const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  quality: 'auto', master: 0.8, sfx: 0.9, crowd: 0.7, music: 0.45, commentary: 0.8, voice: false, muted: false,
  cameraMode: '2k', camHeight: 1, camZoom: 1, camTracking: 1, ftCamera: true,
  shotMeter: true, shotFeedback: 'full', layupTiming: true, autoSwitch: true, replays: true, showHints: true, perfOverlay: false, debugHud: false,
  difficulty: 'allstar', quarterMin: 5, practiceAutoReturn: true,
};

export function migrateSettings(s) {
  const out = { ...s };
  if (!out.version || out.version < 2) {
    // v1 defaulted every machine to "high"; let v2 pick a preset from the GPU instead,
    // unless the player had explicitly chosen something else.
    if (out.quality === 'high') out.quality = 'auto';
    out.version = 2;
  }
  return out;
}

export class Settings {
  constructor() {
    this.data = { ...DEFAULT_SETTINGS };
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && typeof s === 'object') Object.assign(this.data, migrateSettings(s));
    } catch { /* storage unavailable or corrupt: defaults */ }
  }
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  }
}
