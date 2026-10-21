// Persistent user settings (localStorage, with safe fallbacks).
const KEY = 'hw27.settings';
export const DEFAULT_SETTINGS = {
  quality: 'high', master: 0.8, sfx: 0.9, crowd: 0.7, music: 0.45, commentary: 0.8, voice: false,
  cameraMode: '2k', camHeight: 1, camZoom: 1, camTracking: 1, ftCamera: true,
  shotMeter: true, shotFeedback: 'full', layupTiming: true, autoSwitch: true, replays: true, showHints: true, perfOverlay: false,
  difficulty: 'allstar', quarterMin: 5,
};

export class Settings {
  constructor() {
    this.data = { ...DEFAULT_SETTINGS };
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s) Object.assign(this.data, s);
    } catch { /* storage unavailable */ }
  }
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  }
}
