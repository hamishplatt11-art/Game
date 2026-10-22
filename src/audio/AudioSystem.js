// Procedural Web Audio: every sound is synthesised at runtime (no recorded
// or licensed samples). Buses: sfx, crowd, music, commentary (voice).
export class AudioSystem {
  constructor(settings) {
    this.ctx = null;
    this.settings = settings;
    this.started = false;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    // Bus compressor + limiter so crowd swells, horns and commentary never clip.
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18; this.comp.knee.value = 12; this.comp.ratio.value = 3.5;
    this.comp.attack.value = 0.01; this.comp.release.value = 0.25;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002; this.limiter.release.value = 0.1;
    this.master.connect(this.comp);
    this.comp.connect(this.limiter);
    this.limiter.connect(ctx.destination);
    this.bus = {};
    for (const b of ['sfx', 'crowd', 'music', 'voice']) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.bus[b] = g;
    }
    this.applyVolumes();
    // Shared noise buffer.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return true;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    this.master.gain.value = s.muted ? 0 : s.master;
    this.bus.sfx.gain.value = s.sfx;
    this.bus.crowd.gain.value = s.crowd;
    this.bus.music.gain.value = s.music;
    this.bus.voice.gain.value = s.commentary;
  }

  noiseSrc() {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    n.loopStart = Math.random();
    return n;
  }

  env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  play(name, o = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const c = this.ctx, t = c.currentTime, out = this.bus.sfx;
    const vol = o.vol ?? 1;
    switch (name) {
      case 'bounce': {
        const osc = c.createOscillator(), g = c.createGain();
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(55, t + 0.12);
        this.env(g, t, 0.003, 0.5 * vol, 0.14);
        osc.connect(g).connect(out);
        osc.start(t); osc.stop(t + 0.2);
        const n = this.noiseSrc(), f = c.createBiquadFilter(), ng = c.createGain();
        f.type = 'lowpass'; f.frequency.value = 1400;
        this.env(ng, t, 0.001, 0.25 * vol, 0.04);
        n.connect(f).connect(ng).connect(out);
        n.start(t); n.stop(t + 0.08);
        break;
      }
      case 'squeak': {
        const osc = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
        osc.type = 'triangle';
        const base = 1700 + Math.random() * 900;
        osc.frequency.setValueAtTime(base, t);
        osc.frequency.linearRampToValueAtTime(base * (1.15 + Math.random() * 0.3), t + 0.09);
        const lfo = c.createOscillator(), lg = c.createGain();
        lfo.frequency.value = 55 + Math.random() * 30; lg.gain.value = 120;
        lfo.connect(lg).connect(osc.frequency);
        f.type = 'bandpass'; f.frequency.value = base * 1.1; f.Q.value = 3;
        this.env(g, t, 0.01, 0.07 * vol, 0.1);
        osc.connect(f).connect(g).connect(out);
        osc.start(t); lfo.start(t); osc.stop(t + 0.15); lfo.stop(t + 0.15);
        break;
      }
      case 'rim': {
        for (const [fr, a] of [[540, 0.25], [1230, 0.18], [1980, 0.12], [2710, 0.08], [3400, 0.05]]) {
          const osc = c.createOscillator(), g = c.createGain();
          osc.frequency.value = fr * (0.98 + Math.random() * 0.04);
          this.env(g, t, 0.002, a * vol, 0.35 + Math.random() * 0.2);
          osc.connect(g).connect(out);
          osc.start(t); osc.stop(t + 0.7);
        }
        break;
      }
      case 'board': {
        const n = this.noiseSrc(), f = c.createBiquadFilter(), g = c.createGain();
        f.type = 'lowpass'; f.frequency.value = 600;
        this.env(g, t, 0.002, 0.5 * vol, 0.12);
        n.connect(f).connect(g).connect(out);
        n.start(t); n.stop(t + 0.2);
        const osc = c.createOscillator(), og = c.createGain();
        osc.frequency.value = 190;
        this.env(og, t, 0.002, 0.25 * vol, 0.18);
        osc.connect(og).connect(out);
        osc.start(t); osc.stop(t + 0.25);
        break;
      }
      case 'swish': {
        const n = this.noiseSrc(), f = c.createBiquadFilter(), g = c.createGain();
        f.type = 'bandpass'; f.Q.value = 1.4;
        f.frequency.setValueAtTime(5200, t);
        f.frequency.exponentialRampToValueAtTime(2200, t + 0.35);
        this.env(g, t, 0.02, 0.35 * vol, 0.38);
        n.connect(f).connect(g).connect(out);
        n.start(t); n.stop(t + 0.5);
        break;
      }
      case 'catch': {
        const n = this.noiseSrc(), f = c.createBiquadFilter(), g = c.createGain();
        f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.8;
        this.env(g, t, 0.001, 0.3 * vol, 0.05);
        n.connect(f).connect(g).connect(out);
        n.start(t); n.stop(t + 0.08);
        break;
      }
      case 'whistle': {
        const g = c.createGain();
        this.env(g, t, 0.01, 0.16 * vol, o.long ? 0.7 : 0.38);
        const trill = c.createOscillator(), tg = c.createGain();
        trill.frequency.value = 32; tg.gain.value = 0.5;
        const am = c.createGain(); am.gain.value = 0.5;
        trill.connect(tg).connect(am.gain);
        for (const fr of [2950, 3180]) {
          const osc = c.createOscillator();
          osc.frequency.value = fr;
          osc.connect(am);
          osc.start(t); osc.stop(t + 0.9);
        }
        am.connect(g).connect(out);
        trill.start(t); trill.stop(t + 0.9);
        break;
      }
      case 'buzzer': {
        const g = c.createGain(), f = c.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 2200;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.22 * vol, t + 0.02);
        g.gain.setValueAtTime(0.22 * vol, t + 1.1);
        g.gain.linearRampToValueAtTime(0.0001, t + 1.25);
        for (const [type, fr] of [['sawtooth', 165], ['square', 247]]) {
          const osc = c.createOscillator();
          osc.type = type; osc.frequency.value = fr;
          osc.connect(f);
          osc.start(t); osc.stop(t + 1.3);
        }
        f.connect(g).connect(out);
        break;
      }
      case 'cheer':
      case 'groan':
      case 'ooh': {
        const n = this.noiseSrc(), f = c.createBiquadFilter(), g = c.createGain();
        f.type = 'bandpass';
        f.frequency.value = name === 'groan' ? 420 : name === 'ooh' ? 650 : 1100;
        f.Q.value = 0.7;
        const dur = (o.dur || 2.2);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.5 * vol, t + (name === 'cheer' ? 0.25 : 0.4));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        if (name === 'groan') f.frequency.exponentialRampToValueAtTime(250, t + dur);
        n.connect(f).connect(g).connect(this.bus.crowd);
        n.start(t); n.stop(t + dur + 0.1);
        break;
      }
      default:
        break;
    }
  }

  startCrowd() {
    if (!this.ctx || this.crowdNode) return;
    const c = this.ctx;
    const n = this.noiseSrc(), f = c.createBiquadFilter(), f2 = c.createBiquadFilter(), g = c.createGain();
    f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.4;
    f2.type = 'lowpass'; f2.frequency.value = 2500;
    g.gain.value = 0.12;
    // Slow murmur modulation.
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = 0.17; lg.gain.value = 0.03;
    lfo.connect(lg).connect(g.gain);
    n.connect(f).connect(f2).connect(g).connect(this.bus.crowd);
    n.start(); lfo.start();
    this.crowdNode = { n, g, lfo };
  }

  setCrowdLevel(level) {
    if (!this.crowdNode) return;
    const t = this.ctx.currentTime;
    this.crowdNode.g.gain.setTargetAtTime(0.08 + level * 0.25, t, 0.4);
  }

  stopCrowd() {
    if (!this.crowdNode) return;
    try { this.crowdNode.n.stop(); this.crowdNode.lfo.stop(); } catch { /* stopped */ }
    this.crowdNode = null;
  }

  /** Simple original groove (kick/snare/hat/bass/pads) for menus and breaks. */
  startMusic(style = 'menu') {
    if (!this.ctx || this.music) return;
    const c = this.ctx;
    const bpm = style === 'menu' ? 92 : 104;
    const beat = 60 / bpm;
    const out = this.bus.music;
    const chords = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]];
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    let next = c.currentTime + 0.1, step = 0;
    const tick = () => {
      while (next < c.currentTime + 0.4) {
        const t = next;
        const bar = Math.floor(step / 16) % 4;
        const s16 = step % 16;
        if (s16 % 4 === 0 || s16 === 10) { // kick
          const o = c.createOscillator(), g = c.createGain();
          o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
          this.env(g, t, 0.002, 0.5, 0.2); o.connect(g).connect(out); o.start(t); o.stop(t + 0.25);
        }
        if (s16 === 4 || s16 === 12) { // snare
          const n = this.noiseSrc(), f = c.createBiquadFilter(), g = c.createGain();
          f.type = 'highpass'; f.frequency.value = 1500;
          this.env(g, t, 0.002, 0.25, 0.15); n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + 0.2);
        }
        if (s16 % 2 === 0) { // hat
          const n = this.noiseSrc(), f = c.createBiquadFilter(), g = c.createGain();
          f.type = 'highpass'; f.frequency.value = 7000;
          this.env(g, t, 0.001, s16 % 4 === 2 ? 0.08 : 0.04, 0.04); n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + 0.06);
        }
        if (s16 === 0 || s16 === 7 || s16 === 10) { // bass
          const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
          o.type = 'sawtooth'; o.frequency.value = hz(chords[bar][0] - 24);
          f.type = 'lowpass'; f.frequency.value = 400;
          this.env(g, t, 0.01, 0.18, beat * 0.9); o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + beat);
        }
        if (s16 === 0) { // pad chord
          for (const m of chords[bar]) {
            const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
            o.type = 'triangle'; o.frequency.value = hz(m);
            f.type = 'lowpass'; f.frequency.value = 1500;
            g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.035, t + 0.3); g.gain.linearRampToValueAtTime(0.0001, t + beat * 4);
            o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + beat * 4 + 0.1);
          }
        }
        next += beat / 4;
        step++;
      }
    };
    this.music = setInterval(tick, 100);
    tick();
  }

  stopMusic() {
    if (this.music) clearInterval(this.music);
    this.music = null;
  }

  /** Optional spoken commentary using the browser's speech synthesis (original text). */
  say(text) {
    if (!this.settings.voice || this.settings.muted || !window.speechSynthesis) return;
    if (window.speechSynthesis.speaking) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.12;
    u.volume = Math.min(1, this.settings.commentary * this.settings.master);
    window.speechSynthesis.speak(u);
  }
}
