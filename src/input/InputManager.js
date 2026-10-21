// Unified keyboard + gamepad input. Produces one "virtual controller" sample
// per simulation step with held states and edge-triggered presses, converts
// screen-relative stick directions into world space using the camera, and
// recognises right-stick flicks, holds (Pro Stick shooting) and rotations.
const STORAGE_KEY = 'hw27.bindings';

export const ACTIONS = {
  moveUp: 'Move up', moveDown: 'Move down', moveLeft: 'Move left', moveRight: 'Move right',
  sprint: 'Sprint', shoot: 'Shoot (hold/release) · pump fake (tap)', pass: 'Pass · call for ball', bounce: 'Bounce pass', lob: 'Lob / alley-oop',
  icon: 'Icon pass (hold + 1-4)', screen: 'Call for screen', steal: 'Steal', jump: 'Jump · block · rebound', stance: 'Defensive stance · protect dribble · post up',
  switchPlayer: 'Switch player', pause: 'Pause', rsUp: 'Dribble move: up (hesitation) · hands up', rsDown: 'Dribble move: down (stepback)',
  rsLeft: 'Dribble move: left', rsRight: 'Dribble move: right', spin: 'Spin move', sizeup: 'Size-up combo', handsUp: 'Hands up (contest)',
  takeCharge: 'Take charge', timeout: 'Timeout', camera: 'Cycle camera',
};

export const DEFAULT_KEYS = {
  moveUp: ['KeyW'], moveDown: ['KeyS'], moveLeft: ['KeyA'], moveRight: ['KeyD'],
  sprint: ['ShiftLeft', 'ShiftRight'], shoot: ['KeyJ'], pass: ['KeyK'], bounce: ['KeyL'], lob: ['KeyI'], icon: ['KeyQ'],
  screen: ['KeyG'], steal: ['KeyF'], jump: ['Space'], stance: ['KeyC'], switchPlayer: ['Tab'], pause: ['Escape', 'KeyP'],
  rsUp: ['ArrowUp'], rsDown: ['ArrowDown'], rsLeft: ['ArrowLeft'], rsRight: ['ArrowRight'], spin: ['KeyR'], sizeup: ['KeyE'],
  handsUp: ['KeyH'], takeCharge: ['KeyV'], timeout: ['KeyT'], camera: ['KeyM'],
};

// Standard Gamepad mapping, following NBA 2K's long-standing Xbox layout:
// A pass / switch, B bounce pass / take charge, X shoot / steal, Y lob / block,
// LB call for screen, RB icon pass, LT post up / intense D, RT sprint,
// View timeout, Menu pause, RS Pro Stick (dribble moves, shooting, hands up).
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

export class InputManager {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.bindings = this.loadBindings();
    this.pad = { connected: false, id: '', axes: [0, 0, 0, 0], buttons: [], prev: [], rsState: null, lastFlick: null, rsHistory: [] };
    this.events = [];
    this.rebinding = null;
    this.onKeyDown = (e) => {
      if (this.rebinding) {
        e.preventDefault();
        const cb = this.rebinding;
        this.rebinding = null;
        cb(e.code);
        return;
      }
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && !isTyping(e)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    };
    this.onKeyUp = (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    };
    this.onBlur = () => { this.keys.clear(); };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.flickQueue = [];
    this.pendingPresses = new Set();
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  loadBindings() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (s) return { ...DEFAULT_KEYS, ...s };
    } catch { /* storage unavailable */ }
    return JSON.parse(JSON.stringify(DEFAULT_KEYS));
  }

  saveBindings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings)); } catch { /* ignore */ }
  }

  resetBindings() {
    this.bindings = JSON.parse(JSON.stringify(DEFAULT_KEYS));
    this.saveBindings();
  }

  rebind(action, cb) {
    this.rebinding = (code) => {
      this.bindings[action] = [code];
      this.saveBindings();
      cb(code);
    };
  }

  held(action) {
    return (this.bindings[action] || []).some((k) => this.keys.has(k));
  }
  wasPressed(action) {
    return (this.bindings[action] || []).some((k) => this.pressed.has(k));
  }
  wasReleased(action) {
    return (this.bindings[action] || []).some((k) => this.released.has(k));
  }

  /** Poll the gamepad once per rendered frame; turns stick motion into flick/hold events. */
  pollPad(now) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    const P = this.pad;
    P.connected = !!gp;
    if (!gp) return;
    P.id = gp.id;
    P.prev = P.buttons;
    P.buttons = gp.buttons.map((b) => (typeof b === 'object' ? b.value : b));
    P.axes = gp.axes.slice(0, 4).map((v) => (Math.abs(v) < 0.18 ? 0 : v));
    for (let i = 0; i < P.buttons.length; i++) {
      const was = (P.prev[i] || 0) > 0.5, is = P.buttons[i] > 0.5;
      if (is && !was) this.pendingPresses.add(`pad${i}`);
    }
    // Right stick gesture recognition.
    const rx = P.axes[2] || 0, ry = P.axes[3] || 0;
    const mag = Math.hypot(rx, ry);
    P.rsHistory.push({ t: now, a: Math.atan2(ry, rx), m: mag });
    while (P.rsHistory.length && now - P.rsHistory[0].t > 300) P.rsHistory.shift();
    if (mag > 0.7) {
      if (!P.rsState) P.rsState = { t0: now, x: rx, y: ry, max: mag, hold: false };
      else {
        if (mag >= P.rsState.max) { P.rsState.x = rx; P.rsState.y = ry; P.rsState.max = mag; }
        if (!P.rsState.hold && now - P.rsState.t0 > 180) P.rsState.hold = true;
        // Rotation: >150 degrees of sweep within 300 ms = spin.
        const h = P.rsHistory.filter((s) => s.m > 0.6);
        if (h.length > 4 && !P.rsState.spun) {
          let sweep = 0;
          for (let i = 1; i < h.length; i++) {
            let d = h[i].a - h[i - 1].a;
            while (d > Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            sweep += d;
          }
          if (Math.abs(sweep) > 2.6) { P.rsState.spun = true; this.pendingPresses.add('rsSpin'); }
        }
      }
    } else if (mag < 0.35 && P.rsState) {
      if (!P.rsState.hold && !P.rsState.spun) this.flickQueue.push({ x: P.rsState.x, y: P.rsState.y, t: now });
      if (P.rsState.hold) this.pendingPresses.add('rsHoldRelease');
      P.rsState = null;
    }
  }

  padHeld(i) { return this.pad.connected && (this.pad.buttons[i] || 0) > 0.5; }
  padPressed(i) { return this.pendingPresses.has(`pad${i}`); }

  /**
   * Build the virtual-controller sample for one simulation step.
   * @param basis {f, r} camera ground basis (world vectors for screen up/right)
   * @param ctx {offense, hasBall, defense}
   */
  sample(basis, ctx) {
    const P = this.pad;
    let sx = 0, sy = 0;
    if (this.held('moveRight')) sx += 1;
    if (this.held('moveLeft')) sx -= 1;
    if (this.held('moveUp')) sy += 1;
    if (this.held('moveDown')) sy -= 1;
    if (P.connected) { sx += P.axes[0] || 0; sy -= P.axes[1] || 0; }
    let m = Math.hypot(sx, sy);
    if (m > 1) { sx /= m; sy /= m; m = 1; }
    const toWorld = (x, y) => ({ x: basis.r.x * x + basis.f.x * y, z: basis.r.z * x + basis.f.z * y });
    const mv = toWorld(sx, sy);

    // Keyboard flicks (arrow taps) and pad flicks.
    let flick = null;
    const arrows = [['rsUp', 0, 1], ['rsDown', 0, -1], ['rsLeft', -1, 0], ['rsRight', 1, 0]];
    let ax = 0, ay = 0;
    for (const [a, x, y] of arrows) {
      if (this.wasPressed(a)) { ax += x; ay += y; }
    }
    if (ax || ay) flick = toWorld(ax, ay);
    if (this.flickQueue.length) {
      const f = this.flickQueue.shift();
      flick = toWorld(f.x, -f.y);
    }
    // Held right-stick / arrow direction (directional layups, hands up).
    let hx = 0, hy = 0;
    for (const [a, x, y] of arrows) if (this.held(a)) { hx += x; hy += y; }
    if (P.connected && P.rsState && P.rsState.hold) { hx += P.axes[2]; hy -= P.axes[3]; }
    const rs = hx || hy ? toWorld(hx, hy) : null;

    // Pro Stick shooting: hold the right stick down (toward the bottom of the screen).
    const proStickShot = P.connected && P.rsState && P.rsState.hold && (P.axes[3] || 0) > 0.6 && ctx.hasBall;
    const shootDown = this.held('shoot') || this.padHeld(PAD.X) && ctx.hasBall || proStickShot || (ctx.freeThrow && this.padHeld(PAD.X));
    const shootPressedKb = this.wasPressed('shoot');
    const shootPressedPad = this.padPressed(PAD.X) && (ctx.hasBall || ctx.offense);
    const proPress = proStickShot && !this.prevPro;
    this.prevPro = proStickShot;

    let icon = null;
    const iconHeld = this.held('icon') || this.padHeld(PAD.RB);
    if (iconHeld) {
      for (let i = 0; i < 4; i++) if (this.pressed.has(`Digit${i + 1}`)) icon = i;
      // Pad: face buttons pick receivers while RB is held.
      if (P.connected) {
        const map = [PAD.A, PAD.B, PAD.X, PAD.Y];
        for (let i = 0; i < 4; i++) if (this.padPressed(map[i])) icon = i;
      }
    }
    const padDef = !ctx.offense;
    const s = {
      moveX: mv.x, moveZ: mv.z,
      sprint: this.held('sprint') || (P.connected && (P.buttons[PAD.RT] || 0) > 0.4),
      stance: this.held('stance') || (P.connected && (P.buttons[PAD.LT] || 0) > 0.4),
      shootDown,
      shootPressed: shootPressedKb || (shootPressedPad && !iconHeld) || proPress,
      pass: this.wasPressed('pass') || (!iconHeld && !padDef && this.padPressed(PAD.A)),
      bounce: this.wasPressed('bounce') || (!iconHeld && !padDef && this.padPressed(PAD.B)),
      lob: this.wasPressed('lob') || (!iconHeld && !padDef && this.padPressed(PAD.Y)),
      icon,
      iconHeld,
      callScreen: this.wasPressed('screen') || this.padPressed(PAD.LB),
      steal: this.wasPressed('steal') || (padDef && this.padPressed(PAD.X)),
      jump: this.wasPressed('jump') || (padDef && this.padPressed(PAD.Y)) || (ctx.loose && this.padPressed(PAD.Y)),
      handsUp: this.held('handsUp') || (padDef && (this.held('rsUp') || (P.connected && (P.axes[3] || 0) < -0.6))),
      flick: ctx.offense ? flick : null,
      rs,
      spin: this.wasPressed('spin') || this.pendingPresses.has('rsSpin'),
      sizeup: this.wasPressed('sizeup'),
      switchPlayer: this.wasPressed('switchPlayer') || (padDef && this.padPressed(PAD.A)),
      takeCharge: this.held('takeCharge') || (padDef && this.padHeld(PAD.B)),
      timeout: this.wasPressed('timeout') || this.padPressed(PAD.VIEW),
      post: this.wasPressed('stance') || (ctx.hasBall && this.padPressed(PAD.LT)),
    };
    // Gamepad LT edges are analogue triggers: emulate press for post toggles.
    if (P.connected) {
      const lt = (P.buttons[PAD.LT] || 0) > 0.4;
      if (lt && !this.prevLT && ctx.hasBall) s.post = true;
      this.prevLT = lt;
    }
    return s;
  }

  /** UI-level presses (pause, camera, confirm, back). */
  ui() {
    return {
      pause: this.wasPressed('pause') || this.padPressed(PAD.MENU),
      camera: this.wasPressed('camera') || this.padPressed(PAD.UP),
      confirm: this.pressed.has('Enter') || this.pressed.has('NumpadEnter') || this.padPressed(PAD.A),
      skip: this.pressed.has('Enter') || this.wasPressed('shoot') || this.padPressed(PAD.A) || this.padPressed(PAD.X),
    };
  }

  /** Clear edge-triggered state after it has been consumed by a sim step. */
  endStep() {
    this.pressed.clear();
    this.released.clear();
    this.pendingPresses.clear();
  }
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
