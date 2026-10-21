// Procedurally painted textures (canvas): skin, faces, hair, uniforms,
// hardwood, the basketball, nets and LED boards. All original artwork.
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tex(c, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  return t;
}

function shade(hex, f) {
  const c = new THREE.Color(hex);
  if (f >= 0) c.lerp(new THREE.Color('#ffffff'), f); else c.multiplyScalar(1 + f);
  return `#${c.getHexString()}`;
}

const skinCache = new Map();
export function makeSkinTexture(tone, seed) {
  if (skinCache.has(tone)) return skinCache.get(tone);
  const c = canvas(256, 256);
  const x = c.getContext('2d');
  x.fillStyle = tone;
  x.fillRect(0, 0, 256, 256);
  const r = rng(seed);
  // Mottling and pores.
  for (let i = 0; i < 2200; i++) {
    const a = r() * 0.06;
    x.fillStyle = r() < 0.5 ? `rgba(90,40,30,${a})` : `rgba(255,220,200,${a * 0.8})`;
    const s = 1 + r() * 4;
    x.fillRect(r() * 256, r() * 256, s, s);
  }
  const t = tex(c, true, true);
  skinCache.set(tone, t);
  return t;
}

/** Face map in the head sphere's UV space (face centred at u = 0.25). */
export function makeFaceTexture(tone, def, seed) {
  const W = 512, H = 256;
  const c = canvas(W, H);
  const x = c.getContext('2d');
  x.fillStyle = tone;
  x.fillRect(0, 0, W, H);
  const r = rng(seed);
  for (let i = 0; i < 1600; i++) {
    x.fillStyle = `rgba(80,40,30,${r() * 0.05})`;
    x.fillRect(r() * W, r() * H, 2, 2);
  }
  const U = (u) => u * W, V = (v) => (1 - v) * H;
  const dark = shade(tone, -0.45);
  const darker = shade(tone, -0.65);
  // Eye sockets: soft shadow.
  for (const du of [-0.054, 0.054]) {
    const g = x.createRadialGradient(U(0.25 + du), V(0.54), 1, U(0.25 + du), V(0.54), 18);
    g.addColorStop(0, 'rgba(30,15,10,0.45)');
    g.addColorStop(1, 'rgba(30,15,10,0)');
    x.fillStyle = g;
    x.fillRect(U(0.25 + du) - 20, V(0.54) - 20, 40, 40);
    // Upper eyelid line.
    x.strokeStyle = 'rgba(20,10,8,0.7)';
    x.lineWidth = 2;
    x.beginPath();
    x.ellipse(U(0.25 + du), V(0.545), 10, 4, 0, Math.PI * 1.05, Math.PI * 1.95);
    x.stroke();
  }
  // Eyebrows.
  x.strokeStyle = def.skin >= 3 ? '#120c08' : '#2a1a10';
  x.lineCap = 'round';
  for (const k of [-1, 1]) {
    x.lineWidth = 4.5;
    x.beginPath();
    x.moveTo(U(0.25 + k * 0.028), V(0.585));
    x.quadraticCurveTo(U(0.25 + k * 0.055), V(0.6), U(0.25 + k * 0.083), V(0.583));
    x.stroke();
  }
  // Nose shading and nostrils.
  x.fillStyle = 'rgba(40,20,15,0.35)';
  for (const k of [-1, 1]) { x.beginPath(); x.ellipse(U(0.25 + k * 0.016), V(0.43), 4, 2.5, 0, 0, Math.PI * 2); x.fill(); }
  const ng = x.createLinearGradient(U(0.235), 0, U(0.265), 0);
  ng.addColorStop(0, 'rgba(30,15,10,0.18)'); ng.addColorStop(0.5, 'rgba(255,230,210,0.08)'); ng.addColorStop(1, 'rgba(30,15,10,0.18)');
  x.fillStyle = ng;
  x.fillRect(U(0.235), V(0.53), U(0.03), V(0.43) - V(0.53));
  // Lips.
  const lip = shade(tone, def.skin >= 3 ? -0.25 : -0.12);
  x.fillStyle = def.skin >= 3 ? lip : '#b06a5c';
  x.beginPath(); x.ellipse(U(0.25), V(0.37), 17, 4.5, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = 'rgba(20,8,6,0.6)';
  x.fillRect(U(0.25) - 16, V(0.365), 32, 1.5);
  // Facial hair shading.
  if (def.beard && def.beard !== 'none') {
    const alpha = def.beard === 'stubble' ? 0.35 : 0.6;
    for (let i = 0; i < 2600; i++) {
      const u = 0.25 + (r() - 0.5) * 0.24;
      const v = 0.2 + r() * 0.22;
      const du = Math.abs(u - 0.25);
      if (v > 0.33 && v < 0.4 && du < 0.04) continue; // keep lips clear
      if (v > 0.4 && du < 0.05) { if (v > 0.405) continue; }
      x.fillStyle = `rgba(15,10,8,${alpha * r()})`;
      x.fillRect(U(u), V(v), 1.5, 2);
    }
  }
  // Scalp shadow under short hair.
  const sg = x.createLinearGradient(0, V(1), 0, V(0.66));
  sg.addColorStop(0, darker); sg.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = sg;
  x.globalAlpha = 0.55;
  x.fillRect(0, 0, W, V(0.66));
  x.globalAlpha = 1;
  // Ear shading on the sides.
  x.fillStyle = dark;
  x.globalAlpha = 0.15;
  x.fillRect(U(0.0) - 6, V(0.55), 12, 30);
  x.fillRect(U(0.5) - 6, V(0.55), 12, 30);
  x.globalAlpha = 1;
  return tex(c);
}

const hairCache = new Map();
export function makeHairTexture(style) {
  if (hairCache.has(style)) return hairCache.get(style);
  const c = canvas(256, 256);
  const x = c.getContext('2d');
  const r = rng(style.length * 977);
  x.fillStyle = '#141010';
  x.fillRect(0, 0, 256, 256);
  if (style === 'buzz' || style === 'fade' || style === 'beard') {
    // Short stubble: partial alpha speckle.
    x.clearRect(0, 0, 256, 256);
    for (let i = 0; i < 26000; i++) {
      x.fillStyle = `rgba(${15 + r() * 15},${10 + r() * 10},${8 + r() * 8},${0.55 + r() * 0.45})`;
      x.fillRect(r() * 256, r() * 256, 1.5, 1.5);
    }
  } else {
    for (let i = 0; i < 9000; i++) {
      const l = 20 + r() * 30;
      x.fillStyle = `rgba(${20 + l},${14 + l * 0.7},${10 + l * 0.5},${0.4})`;
      x.fillRect(r() * 256, r() * 256, 1 + r() * 2, 3 + r() * 6);
    }
    if (style === 'braids') {
      x.strokeStyle = 'rgba(0,0,0,0.6)';
      x.lineWidth = 3;
      for (let i = 0; i < 256; i += 18) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.stroke(); }
    }
    if (style === 'twists' || style === 'afro') {
      for (let i = 0; i < 900; i++) {
        x.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.3})`;
        x.beginPath(); x.arc(r() * 256, r() * 256, 1 + r() * 2.5, 0, Math.PI * 2); x.fill();
      }
    }
  }
  const t = tex(c, true, true);
  t.repeat.set(2, 2);
  hairCache.set(style, t);
  return t;
}

/** Jersey in the torso loft UV space (front centre u = 0.75, back u = 0.25, sides u = 0/0.5). */
export function makeJerseyTexture(colors, num, last, teamName) {
  const W = 1024, H = 512;
  const c = canvas(W, H);
  const x = c.getContext('2d');
  const [base, second, trim] = colors;
  x.fillStyle = base;
  x.fillRect(0, 0, W, H);
  // Fabric mesh texture.
  const r = rng(num * 31 + 7);
  for (let i = 0; i < 9000; i++) {
    x.fillStyle = `rgba(0,0,0,${r() * 0.05})`;
    x.fillRect(r() * W, r() * H, 2, 2);
  }
  // Side panels.
  x.fillStyle = second;
  for (const u of [0, 0.5, 1]) x.fillRect(u * W - 26, 0, 52, H);
  x.fillStyle = trim;
  for (const u of [0, 0.5, 1]) { x.fillRect(u * W - 30, 0, 4, H); x.fillRect(u * W + 26, 0, 4, H); }
  // Hem trim.
  x.fillStyle = second;
  x.fillRect(0, H - 14, W, 14);
  // Armholes (cut out) with trim.
  const cut = (cx, cy, rx, ry) => {
    x.save();
    x.fillStyle = second;
    x.beginPath(); x.ellipse(cx, cy, rx + 9, ry + 9, 0, 0, Math.PI * 2); x.fill();
    x.globalCompositeOperation = 'destination-out';
    x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); x.fill();
    x.restore();
  };
  for (const u of [0, 0.5, 1]) cut(u * W, 0, 92, 150);
  // Neckline: V at the front, scoop at the back.
  x.save();
  x.fillStyle = second;
  x.beginPath(); x.moveTo(0.75 * W - 90, 0); x.lineTo(0.75 * W, 92); x.lineTo(0.75 * W + 90, 0); x.fill();
  x.beginPath(); x.ellipse(0.25 * W, 0, 92, 42, 0, 0, Math.PI * 2); x.fill();
  x.globalCompositeOperation = 'destination-out';
  x.beginPath(); x.moveTo(0.75 * W - 78, 0); x.lineTo(0.75 * W, 78); x.lineTo(0.75 * W + 78, 0); x.fill();
  x.beginPath(); x.ellipse(0.25 * W, 0, 80, 32, 0, 0, Math.PI * 2); x.fill();
  x.restore();
  // Front wordmark and numbers.
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillStyle = second;
  x.strokeStyle = trim;
  x.lineWidth = 5;
  x.font = 'italic 900 50px "Arial Black", Impact, sans-serif';
  const word = (teamName || '').toUpperCase().slice(0, 10);
  x.strokeText(word, 0.75 * W, 175);
  x.fillText(word, 0.75 * W, 175);
  x.font = '900 120px "Arial Black", Impact, sans-serif';
  x.lineWidth = 8;
  x.strokeText(String(num), 0.75 * W, 290);
  x.fillText(String(num), 0.75 * W, 290);
  // Back name and number.
  x.font = '900 46px "Arial Black", Impact, sans-serif';
  x.lineWidth = 4;
  x.strokeText(last.toUpperCase(), 0.25 * W, 112);
  x.fillText(last.toUpperCase(), 0.25 * W, 112);
  x.font = '900 170px "Arial Black", Impact, sans-serif';
  x.lineWidth = 9;
  x.strokeText(String(num), 0.25 * W, 265);
  x.fillText(String(num), 0.25 * W, 265);
  return tex(c);
}

/** Referee shirt: grey with black side panels, collar trim and a number on the back. */
export function makeOfficialTexture(num) {
  const W = 512, H = 256;
  const c = canvas(W, H);
  const x = c.getContext('2d');
  x.fillStyle = '#9ea3ab';
  x.fillRect(0, 0, W, H);
  x.fillStyle = '#16171b';
  for (const u of [0, 0.5, 1]) x.fillRect(u * W - 18, 0, 36, H);
  x.fillRect(0.75 * W - 50, 0, 100, 10);
  x.fillRect(0.25 * W - 50, 0, 100, 10);
  x.font = '900 70px "Arial Black", Impact, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(num), 0.25 * W, 110);
  x.font = '900 26px "Arial Black", Impact, sans-serif';
  x.fillText(String(num), 0.82 * W, 70);
  return tex(c);
}

export function makeShortsTexture(colors, teamName) {
  const W = 512, H = 512;
  const c = canvas(W, H);
  const x = c.getContext('2d');
  const [base, second, trim] = colors;
  x.fillStyle = base;
  x.fillRect(0, 0, W, H);
  // Waistband (v 0..0.3 is the waistband ring; canvas bottom = v 0).
  x.fillStyle = second;
  x.fillRect(0, H * 0.7 + H * 0.2, W, H * 0.1);
  // Side stripes on each leg (u 0/0.5/1 are the outer/inner sides).
  for (const u of [0, 0.5, 1]) {
    x.fillStyle = second;
    x.fillRect(u * W - 22, 0, 44, H * 0.7);
    x.fillStyle = trim;
    x.fillRect(u * W - 26, 0, 4, H * 0.7);
    x.fillRect(u * W + 22, 0, 4, H * 0.7);
  }
  // Hem.
  x.fillStyle = second;
  x.fillRect(0, 0, W, 16);
  void teamName;
  return tex(c);
}

// ---------------------------------------------------------------------------
// Court and arena
// ---------------------------------------------------------------------------
export function makeBallTexture() {
  const W = 1024, H = 512;
  const c = canvas(W, H);
  const x = c.getContext('2d');
  x.fillStyle = '#c4581f';
  x.fillRect(0, 0, W, H);
  const r = rng(99);
  // Pebbled leather.
  for (let i = 0; i < 60000; i++) {
    const a = r() * 0.18;
    x.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,190,140,${a * 0.6})`;
    x.beginPath(); x.arc(r() * W, r() * H, 0.8 + r() * 1.2, 0, Math.PI * 2); x.fill();
  }
  // Channels (seams) for an equirectangular ball map.
  x.strokeStyle = '#1b0f08';
  x.lineWidth = 7;
  x.beginPath(); x.moveTo(0, H / 2); x.lineTo(W, H / 2); x.stroke();
  for (const u of [0.25, 0.75]) { x.beginPath(); x.moveTo(u * W, 0); x.lineTo(u * W, H); x.stroke(); }
  for (const u0 of [0, 0.5]) {
    x.beginPath();
    for (let i = 0; i <= 100; i++) {
      const v = i / 100;
      const u = u0 + 0.25 + 0.17 * Math.sin(v * Math.PI) * (u0 === 0 ? 1 : -1);
      if (i === 0) x.moveTo(u * W, v * H); else x.lineTo(u * W, v * H);
    }
    x.stroke();
  }
  x.fillStyle = 'rgba(20,10,5,0.75)';
  x.font = 'bold 22px sans-serif';
  x.fillText('HARDWOOD 27', W * 0.36, H * 0.42);
  return tex(c);
}

export function makeNetTexture() {
  const c = canvas(128, 128);
  const x = c.getContext('2d');
  x.clearRect(0, 0, 128, 128);
  x.strokeStyle = '#f7f7f7';
  x.lineWidth = 5;
  // Diamond lattice; the mesh UVs repeat it around the net.
  x.beginPath();
  x.moveTo(0, 0); x.lineTo(128, 128);
  x.moveTo(128, 0); x.lineTo(0, 128);
  x.stroke();
  const t = tex(c, true, true);
  return t;
}

export function makeLedTexture(lines, colors) {
  const c = canvas(2048, 64);
  const x = c.getContext('2d');
  x.fillStyle = '#050608';
  x.fillRect(0, 0, 2048, 64);
  let px = 0;
  let i = 0;
  while (px < 2048) {
    const txt = lines[i % lines.length];
    const col = colors[i % colors.length];
    x.fillStyle = col;
    x.font = '900 40px "Arial Black", Impact, sans-serif';
    x.textBaseline = 'middle';
    const w = x.measureText(txt).width;
    x.fillText(txt, px + 30, 34);
    px += w + 120;
    i++;
  }
  // LED pixel grid.
  x.fillStyle = 'rgba(0,0,0,0.35)';
  for (let yy = 0; yy < 64; yy += 4) x.fillRect(0, yy, 2048, 1);
  for (let xx = 0; xx < 2048; xx += 4) x.fillRect(xx, 0, 1, 64);
  const t = tex(c, true, true);
  return t;
}

export { canvas, rng, tex, shade };
