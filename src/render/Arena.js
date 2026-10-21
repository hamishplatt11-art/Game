// Arena: regulation hardwood (markings drawn to NBA Rule 1 dimensions), hoops
// (backboard, rim, padded stanchion, shot clocks), cloth nets, bowl seating
// with an instanced animated crowd, LED boards, scorer's table, benches,
// jumbotron and lighting. An outdoor variant is used for Blacktop.
import * as THREE from 'three';
import {
  COURT_L, COURT_W, HALF_L, HALF_W, HOOP_X, RIM_H, RIM_R, RIM_TUBE, BOARD_X, BOARD_W, BOARD_H, BOARD_BOTTOM, BOARD_THICK,
  THREE_R, CORNER_Z, CORNER_STRAIGHT_DX, LANE_W, FT_LINE_FROM_BASELINE, FT_CIRCLE_R, RESTRICTED_R, CENTER_CIRCLE_R, FT, IN,
} from '../sim/constants.js';
import { canvas, rng, tex, makeLedTexture } from './Textures.js';
import { NetView } from './NetView.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const APRON_L = 2.6, APRON_W = 2.5;
const FLOOR_L = COURT_L + APRON_L * 2, FLOOR_W = COURT_W + APRON_W * 2;

export class Arena {
  constructor(scene, opts) {
    this.scene = scene;
    this.opts = opts;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.outdoor = opts.outdoor;
    this.quality = opts.quality;
    this.nets = [];
    this.updaters = [];
    this.home = opts.home;
    this.away = opts.away;
    this.buildFloor();
    for (let i = 0; i < 2; i++) this.buildHoop(i);
    if (this.outdoor) this.buildOutdoor();
    else {
      this.buildBowl();
      this.buildCourtside();
      this.buildCeiling();
    }
    this.buildLights();
  }

  // ---------------------------------------------------------------------
  // Floor
  // ---------------------------------------------------------------------
  buildFloor() {
    const ppm = this.quality === 'low' ? 64 : this.quality === 'medium' ? 96 : 128;
    const W = Math.round(FLOOR_L * ppm), H = Math.round(FLOOR_W * ppm);
    const c = canvas(W, H);
    const x = c.getContext('2d');
    const X = (wx) => (wx + FLOOR_L / 2) * ppm;
    const Z = (wz) => (wz + FLOOR_W / 2) * ppm;
    const M = (m) => m * ppm;
    const r = rng(42);
    const paint = this.home.court?.paint || '#0b4f8a';
    const accent = this.home.court?.accent || '#f2b41c';
    if (this.outdoor) {
      // Asphalt with a painted court.
      x.fillStyle = '#3a3c40';
      x.fillRect(0, 0, W, H);
      for (let i = 0; i < W * H / 60; i++) {
        const v = 40 + r() * 50;
        x.fillStyle = `rgba(${v},${v},${v + 4},${0.5})`;
        x.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
      }
      x.fillStyle = '#2d5e8a';
      x.fillRect(X(-HALF_L), Z(-HALF_W), M(COURT_L), M(COURT_W));
      x.fillStyle = '#a2412e';
      for (const s of [-1, 1]) {
        x.beginPath();
        x.arc(X(s * HOOP_X), Z(0), M(THREE_R), 0, Math.PI * 2);
        x.save(); x.clip(); x.fillRect(X(s > 0 ? HOOP_X - THREE_R : -HALF_L), Z(-CORNER_Z), M(THREE_R + 1.6), M(CORNER_Z * 2)); x.restore();
      }
    } else {
      // Maple strip flooring: 2.25" boards running the length of the court, staggered joints.
      const boardW = 2.25 * IN;
      const base = [201, 154, 96];
      for (let zz = -FLOOR_W / 2; zz < FLOOR_W / 2; zz += boardW) {
        let xx = -FLOOR_L / 2 - r() * 2;
        while (xx < FLOOR_L / 2) {
          const len = 0.9 + r() * 1.8;
          const v = (r() - 0.5) * 26;
          x.fillStyle = `rgb(${base[0] + v},${base[1] + v * 0.85},${base[2] + v * 0.6})`;
          x.fillRect(X(xx), Z(zz), M(len) + 1, M(boardW) + 1);
          x.fillStyle = 'rgba(60,35,15,0.25)';
          x.fillRect(X(xx), Z(zz), 1, M(boardW));
          xx += len;
        }
        x.fillStyle = 'rgba(70,40,20,0.18)';
        x.fillRect(0, Z(zz), W, 1);
      }
      // Grain streaks.
      for (let i = 0; i < W * H / 900; i++) {
        x.fillStyle = `rgba(110,65,30,${r() * 0.07})`;
        x.fillRect(r() * W, r() * H, 6 + r() * 40, 1);
      }
      // Apron stain outside the boundary.
      x.fillStyle = 'rgba(40,20,10,0.55)';
      x.fillRect(0, 0, W, Z(-HALF_W));
      x.fillRect(0, Z(HALF_W), W, H - Z(HALF_W));
      x.fillRect(0, 0, X(-HALF_L), H);
      x.fillRect(X(HALF_L), 0, W - X(HALF_L), H);
      // Painted keys and three-point "halo".
      x.globalAlpha = 0.9;
      x.fillStyle = paint;
      for (const s of [-1, 1]) {
        const bx = s * HALF_L;
        x.fillRect(Math.min(X(bx), X(bx - s * FT_LINE_FROM_BASELINE)), Z(-LANE_W / 2), M(FT_LINE_FROM_BASELINE), M(LANE_W));
      }
      x.globalAlpha = 1;
      // Centre court logo.
      x.fillStyle = paint;
      x.beginPath(); x.arc(X(0), Z(0), M(CENTER_CIRCLE_R), 0, Math.PI * 2); x.fill();
      x.fillStyle = accent;
      x.beginPath(); x.arc(X(0), Z(0), M(2 * FT), 0, Math.PI * 2); x.fill();
      x.save();
      x.translate(X(0), Z(0));
      x.fillStyle = '#ffffff';
      x.font = `900 ${M(0.42)}px "Arial Black", Impact, sans-serif`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(this.home.abbr, 0, 0);
      x.restore();
      // Baseline wordmarks on the apron.
      x.fillStyle = 'rgba(255,255,255,0.85)';
      x.font = `900 ${M(0.9)}px "Arial Black", Impact, sans-serif`;
      for (const s of [-1, 1]) {
        x.save();
        x.translate(X(s * (HALF_L + 1.3)), Z(0));
        x.rotate(s * Math.PI / 2);
        x.fillText(this.home.name.toUpperCase(), -x.measureText(this.home.name.toUpperCase()).width / 2, M(0.3));
        x.restore();
      }
    }
    // --- Lines (2" wide) ---
    const lw = M(2 * IN);
    x.strokeStyle = '#ffffff';
    x.fillStyle = '#ffffff';
    x.lineWidth = lw;
    x.lineCap = 'butt';
    const line = (x0, z0, x1, z1) => { x.beginPath(); x.moveTo(X(x0), Z(z0)); x.lineTo(X(x1), Z(z1)); x.stroke(); };
    // Boundary.
    x.strokeRect(X(-HALF_L) + lw / 2, Z(-HALF_W) + lw / 2, M(COURT_L) - lw, M(COURT_W) - lw);
    line(0, -HALF_W, 0, HALF_W);
    x.beginPath(); x.arc(X(0), Z(0), M(CENTER_CIRCLE_R), 0, Math.PI * 2); x.stroke();
    x.beginPath(); x.arc(X(0), Z(0), M(2 * FT), 0, Math.PI * 2); x.stroke();
    for (const s of [-1, 1]) {
      const hx = s * HOOP_X, bx = s * HALF_L;
      const ftx = bx - s * FT_LINE_FROM_BASELINE;
      // Three-point line: corner straights + arc.
      line(bx, -CORNER_Z, hx - s * CORNER_STRAIGHT_DX, -CORNER_Z);
      line(bx, CORNER_Z, hx - s * CORNER_STRAIGHT_DX, CORNER_Z);
      const a0 = Math.atan2(CORNER_Z, -s * CORNER_STRAIGHT_DX);
      const a1 = Math.atan2(-CORNER_Z, -s * CORNER_STRAIGHT_DX);
      x.beginPath();
      if (s > 0) x.arc(X(hx), Z(0), M(THREE_R), a0, a1, false);
      else x.arc(X(hx), Z(0), M(THREE_R), a1, a0, false);
      x.stroke();
      // Lane.
      x.strokeRect(Math.min(X(bx), X(ftx)), Z(-LANE_W / 2), M(FT_LINE_FROM_BASELINE), M(LANE_W));
      // Free-throw circle: solid outer half, dashed inner half.
      x.beginPath();
      x.arc(X(ftx), Z(0), M(FT_CIRCLE_R), s > 0 ? Math.PI / 2 : -Math.PI / 2, s > 0 ? Math.PI * 1.5 : Math.PI / 2);
      x.stroke();
      x.setLineDash([M(1.3 * FT), M(1.3 * FT)]);
      x.beginPath();
      x.arc(X(ftx), Z(0), M(FT_CIRCLE_R), s > 0 ? -Math.PI / 2 : Math.PI / 2, s > 0 ? Math.PI / 2 : Math.PI * 1.5);
      x.stroke();
      x.setLineDash([]);
      // Restricted area arc (4 ft from the hoop centre) to the backboard face.
      x.beginPath();
      if (s > 0) x.arc(X(hx), Z(0), M(RESTRICTED_R), Math.PI / 2, Math.PI * 1.5);
      else x.arc(X(hx), Z(0), M(RESTRICTED_R), -Math.PI / 2, Math.PI / 2);
      x.stroke();
      line(hx, -RESTRICTED_R, s * BOARD_X, -RESTRICTED_R);
      line(hx, RESTRICTED_R, s * BOARD_X, RESTRICTED_R);
      // Lane space marks (7', 8' block, 11', 14' from the baseline).
      for (const d of [7, 11, 14]) {
        const mx = bx - s * d * FT;
        line(mx, -LANE_W / 2, mx, -LANE_W / 2 - 0.5 * FT);
        line(mx, LANE_W / 2, mx, LANE_W / 2 + 0.5 * FT);
      }
      x.fillRect(Math.min(X(bx - s * 7 * FT), X(bx - s * 8 * FT)), Z(-LANE_W / 2) - M(0.66 * FT), M(1 * FT), M(0.66 * FT));
      x.fillRect(Math.min(X(bx - s * 7 * FT), X(bx - s * 8 * FT)), Z(LANE_W / 2), M(1 * FT), M(0.66 * FT));
      // Hash marks 28' from the baseline (coaching box) and the 3' baseline ticks.
      line(bx - s * 28 * FT, HALF_W, bx - s * 28 * FT, HALF_W - 3 * FT);
      line(bx - s * 28 * FT, -HALF_W, bx - s * 28 * FT, -HALF_W + 3 * FT);
    }
    const t = tex(c);
    t.anisotropy = this.opts.renderer.capabilities.getMaxAnisotropy();
    const geo = new THREE.PlaneGeometry(FLOOR_L, FLOOR_W);
    geo.rotateX(-Math.PI / 2);
    let mat;
    if (this.outdoor) mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.92, metalness: 0 });
    else if (this.quality === 'low') mat = new THREE.MeshLambertMaterial({ map: t });
    else mat = new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.35, metalness: 0, clearcoat: 1.0, clearcoatRoughness: 0.12 });
    if (this.opts.reflect) { mat.transparent = true; mat.opacity = 0.88; }
    const floor = new THREE.Mesh(geo, mat);
    floor.receiveShadow = true;
    floor.position.y = this.opts.reflect ? 0.002 : 0;
    this.group.add(floor);
    this.floor = floor;
    // Surrounding floor.
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(90, 70), new THREE.MeshStandardMaterial({ color: this.outdoor ? '#2f3a2d' : '#16171b', roughness: 0.9 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.01;
    outer.receiveShadow = true;
    this.group.add(outer);
  }

  // ---------------------------------------------------------------------
  // Hoops
  // ---------------------------------------------------------------------
  buildHoop(i) {
    const s = i === 0 ? -1 : 1;
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: '#c2410c', roughness: 0.35, metalness: 0.75 });
    const white = new THREE.MeshStandardMaterial({ color: '#f3f3f3', roughness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: '#202226', roughness: 0.6, metalness: 0.4 });
    const pad = new THREE.MeshStandardMaterial({ color: this.outdoor ? '#3b3b3b' : this.home.colors.home[1], roughness: 0.8 });
    // Glass backboard.
    const glassMat = this.outdoor
      ? new THREE.MeshStandardMaterial({ color: '#ececec', roughness: 0.7 })
      : new THREE.MeshPhysicalMaterial({ color: '#dfefff', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    const board = new THREE.Mesh(new THREE.BoxGeometry(BOARD_THICK, BOARD_H, BOARD_W), glassMat);
    board.position.set(s * (BOARD_X + BOARD_THICK / 2), BOARD_BOTTOM + BOARD_H / 2, 0);
    g.add(board);
    // Border and shooter's square (24" x 18").
    const bw = 2 * IN;
    const edge = (h, w, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.012, h, w), white);
      m.position.set(s * (BOARD_X - 0.004), y, z);
      g.add(m);
    };
    edge(bw, BOARD_W, BOARD_BOTTOM + bw / 2, 0);
    edge(bw, BOARD_W, BOARD_BOTTOM + BOARD_H - bw / 2, 0);
    edge(BOARD_H, bw, BOARD_BOTTOM + BOARD_H / 2, -BOARD_W / 2 + bw / 2);
    edge(BOARD_H, bw, BOARD_BOTTOM + BOARD_H / 2, BOARD_W / 2 - bw / 2);
    const sqW = 24 * IN, sqH = 18 * IN, sqB = RIM_H + 0.0;
    edge(bw, sqW, sqB + bw / 2, 0);
    edge(bw, sqW, sqB + sqH - bw / 2, 0);
    edge(sqH, bw, sqB + sqH / 2, -sqW / 2 + bw / 2);
    edge(sqH, bw, sqB + sqH / 2, sqW / 2 - bw / 2);
    // Board padding along the bottom edge.
    const bpad = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, BOARD_W + 0.04), pad);
    bpad.position.set(s * (BOARD_X + 0.025), BOARD_BOTTOM - 0.02, 0);
    g.add(bpad);
    // Rim and bracket.
    const rim = new THREE.Mesh(new THREE.TorusGeometry(RIM_R + RIM_TUBE, RIM_TUBE, 10, 48), metal);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(s * HOOP_X, RIM_H, 0);
    rim.castShadow = true;
    g.add(rim);
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.12), metal);
    bracket.position.set(s * (BOARD_X - 0.08), RIM_H - 0.01, 0);
    g.add(bracket);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.25), metal);
    plate.position.set(s * (BOARD_X - 0.015), RIM_H - 0.07, 0);
    g.add(plate);
    // Support arm and padded stanchion behind the baseline.
    const baseX = s * (HALF_L + 2.4);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.5), pad);
    base.position.set(baseX + s * 0.3, 0.55, 0);
    base.castShadow = true; base.receiveShadow = true;
    g.add(base);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.34, 2.6, 0.34), pad);
    post.position.set(baseX - s * 0.2, 2.0, 0);
    post.castShadow = true;
    g.add(post);
    const armLen = Math.abs(baseX - s * BOARD_X) - 0.1;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen, 0.2, 0.22), dark);
    arm.position.set((baseX + s * BOARD_X) / 2 - s * 0.15, BOARD_BOTTOM + BOARD_H * 0.55, 0);
    g.add(arm);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 0.12), dark);
    strut.position.set(s * (BOARD_X + 0.55), BOARD_BOTTOM + 0.2, 0);
    strut.rotation.z = s * 0.6;
    g.add(strut);
    // Shot clock unit on top of the backboard (canvas display).
    if (!this.outdoor) {
      const sc = canvas(256, 128);
      const sct = tex(sc);
      const unit = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.42, 0.9), [dark, dark, dark, dark, new THREE.MeshBasicMaterial({ map: sct }), new THREE.MeshBasicMaterial({ map: sct })]);
      unit.position.set(s * (BOARD_X + 0.12), BOARD_BOTTOM + BOARD_H + 0.24, 0);
      unit.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(unit);
      this.updaters.push((state) => {
        if (state.shotClockText === unit.lastText) return;
        unit.lastText = state.shotClockText;
        const x = sc.getContext('2d');
        x.fillStyle = '#060606'; x.fillRect(0, 0, 256, 128);
        x.fillStyle = state.shotClockLow ? '#ff2a2a' : '#ffb000';
        x.font = '900 86px "Courier New", monospace';
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(state.shotClockText, 128, 50);
        x.fillStyle = '#ff3b30';
        x.font = '900 34px "Courier New", monospace';
        x.fillText(state.gameClockText, 128, 108);
        sct.needsUpdate = true;
      });
    }
    this.group.add(g);
    const net = new NetView(i, this.quality);
    this.group.add(net.mesh);
    this.nets.push(net);
  }

  // ---------------------------------------------------------------------
  // Bowl and crowd
  // ---------------------------------------------------------------------
  buildBowl() {
    const rows = this.quality === 'low' ? 12 : 18;
    const riserMat = new THREE.MeshStandardMaterial({ color: '#1c1f26', roughness: 0.9 });
    const geos = [];
    const seats = [];
    const d0 = 3.6, rowD = 0.86, rowH = 0.42;
    for (let r = 0; r < rows; r++) {
      const d = d0 + r * rowD;
      const y = 0.25 + r * rowH;
      const Lx = HALF_L + d, Wz = HALF_W + d;
      // Four risers per row (rectangular ring).
      const add = (w, h, dp, x, yy, z) => { const b = new THREE.BoxGeometry(w, h, dp); b.translate(x, yy, z); geos.push(b); };
      add(Lx * 2 + rowD * 2, y, rowD, 0, y / 2, Wz + rowD / 2);
      add(Lx * 2 + rowD * 2, y, rowD, 0, y / 2, -Wz - rowD / 2);
      add(rowD, y, Wz * 2, Lx + rowD / 2, y / 2, 0);
      add(rowD, y, Wz * 2, -Lx - rowD / 2, y / 2, 0);
      // Seat positions along the row.
      const spacing = 0.62;
      for (let xx = -Lx; xx <= Lx; xx += spacing) {
        seats.push([xx, y, Wz + rowD * 0.55, Math.PI]);
        // Leave room for the scorer's table side tunnel near centre.
        if (!(r < 3 && Math.abs(xx) < 1.5)) seats.push([xx, y, -Wz - rowD * 0.55, 0]);
      }
      for (let zz = -Wz + spacing; zz < Wz; zz += spacing) {
        seats.push([Lx + rowD * 0.55, y, zz, -Math.PI / 2]);
        seats.push([-Lx - rowD * 0.55, y, zz, Math.PI / 2]);
      }
    }
    // Upper deck.
    const up0 = d0 + rows * rowD + 2.5;
    for (let r = 0; r < 10; r++) {
      const d = up0 + r * 0.9;
      const y = 8.5 + r * 0.55;
      const Lx = HALF_L + d, Wz = HALF_W + d;
      const add = (w, h, dp, x, yy, z) => { const b = new THREE.BoxGeometry(w, h, dp); b.translate(x, yy, z); geos.push(b); };
      add(Lx * 2, 0.6, 0.9, 0, y, Wz);
      add(Lx * 2, 0.6, 0.9, 0, y, -Wz);
      add(0.9, 0.6, Wz * 2, Lx, y, 0);
      add(0.9, 0.6, Wz * 2, -Lx, y, 0);
      if (this.quality !== 'low') {
        for (let xx = -Lx; xx <= Lx; xx += 0.75) { seats.push([xx, y + 0.3, Wz, Math.PI]); seats.push([xx, y + 0.3, -Wz, 0]); }
        for (let zz = -Wz; zz < Wz; zz += 0.75) { seats.push([Lx, y + 0.3, zz, -Math.PI / 2]); seats.push([-Lx, y + 0.3, zz, Math.PI / 2]); }
      }
    }
    const bowl = new THREE.Mesh(mergeGeometries(geos), riserMat);
    bowl.receiveShadow = true;
    this.group.add(bowl);
    // Lower-bowl fascia LED ribbon.
    const led = makeLedTexture(['HARDWOOD 27', `${this.home.city.toUpperCase()} ${this.home.name.toUpperCase()}`, 'FAST BREAK ENERGY', 'COURTSIDE CLUB', 'DEFENSE! DEFENSE!'], ['#ffffff', this.home.colors.home[1], '#ffd400', '#7ee0ff', '#ff5a5a']);
    led.repeat.set(5, 1);
    const ledMat = new THREE.MeshBasicMaterial({ map: led, toneMapped: false });
    this.ledMats = [ledMat];
    const fasc = (w, x, z, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.7), ledMat);
      m.position.set(x, 0.62, z);
      m.rotation.y = ry;
      this.group.add(m);
    };
    fasc((HALF_L + d0) * 2, 0, HALF_W + d0 - 0.01, Math.PI);
    fasc((HALF_W + d0) * 2, HALF_L + d0 - 0.01, 0, -Math.PI / 2);
    fasc((HALF_W + d0) * 2, -HALF_L - d0 + 0.01, 0, Math.PI / 2);
    this.buildCrowd(seats);
  }

  buildCrowd(seats) {
    const r = rng(7);
    let list = seats;
    const max = this.quality === 'low' ? 1800 : this.quality === 'medium' ? 4000 : 9000;
    if (list.length > max) list = list.filter(() => r() < max / seats.length);
    // Seated spectator: legs, torso, arms (merged), separate head mesh.
    const torso = new THREE.BoxGeometry(0.42, 0.52, 0.24); torso.translate(0, 0.62, 0);
    const legs = new THREE.BoxGeometry(0.36, 0.16, 0.46); legs.translate(0, 0.38, -0.16);
    const shins = new THREE.BoxGeometry(0.32, 0.4, 0.14); shins.translate(0, 0.18, -0.36);
    const armL = new THREE.BoxGeometry(0.1, 0.46, 0.12); armL.translate(0.26, 0.62, -0.02);
    const armR = armL.clone(); armR.translate(-0.52, 0, 0);
    const bodyGeo = mergeGeometries([torso, legs, shins, armL, armR]);
    const headGeo = new THREE.SphereGeometry(0.11, 8, 6); headGeo.translate(0, 1.0, -0.02);
    const mkMat = (base) => {
      const m = new THREE.MeshLambertMaterial({ color: base });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.crowdUniforms.uTime;
        sh.uniforms.uExcite = this.crowdUniforms.uExcite;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aPhase;\nuniform float uTime;\nuniform float uExcite;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            float ph = aPhase * 6.2831;
            float idleSway = sin(uTime * 1.3 + ph) * 0.02;
            float jump = max(0.0, sin(uTime * (7.0 + aPhase * 3.0) + ph)) * 0.14 * uExcite;
            float stand = smoothstep(0.35, 0.9, uExcite) * step(0.35, fract(aPhase * 7.13)) * 0.32;
            transformed.y += jump + stand;
            transformed.x += idleSway;
            if (position.y > 0.5 && abs(position.x) > 0.2) { transformed.y += uExcite * step(0.5, fract(aPhase * 3.7)) * 0.35 * (0.6 + 0.4 * sin(uTime * 9.0 + ph)); }`);
      };
      return m;
    };
    this.crowdUniforms = { uTime: { value: 0 }, uExcite: { value: 0 } };
    const n = list.length;
    const bodies = new THREE.InstancedMesh(bodyGeo, mkMat('#ffffff'), n);
    const heads = new THREE.InstancedMesh(headGeo, mkMat('#ffffff'), n);
    const phase = new Float32Array(n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const shirts = [this.home.colors.home[1], this.home.colors.home[1], this.home.colors.home[0], '#222222', '#f0f0f0', '#3a5f9e', '#9e3a3a', this.away.colors.home[1], '#555555', '#c8a24a'];
    const skins = ['#f1c9a5', '#e0ac85', '#c68863', '#a0663f', '#7a4a2a', '#4f2f1c'];
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const [x, y, z, ry] = list[i];
      p.set(x + (r() - 0.5) * 0.08, y, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry + (r() - 0.5) * 0.3);
      const s = 0.9 + r() * 0.2;
      sc.set(s, s, s);
      m4.compose(p, q, sc);
      bodies.setMatrixAt(i, m4);
      heads.setMatrixAt(i, m4);
      bodies.setColorAt(i, col.set(shirts[Math.floor(r() * shirts.length)]).multiplyScalar(0.55 + r() * 0.35));
      heads.setColorAt(i, col.set(skins[Math.floor(r() * skins.length)]).multiplyScalar(0.7));
      phase[i] = r();
    }
    bodyGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    headGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    bodies.frustumCulled = false; heads.frustumCulled = false;
    this.group.add(bodies, heads);
    this.crowdCount = n;
  }

  buildCourtside() {
    // Scorer's table and benches on the far sideline (main camera side is +z).
    const z = -(HALF_W + 1.6);
    const tableMat = new THREE.MeshStandardMaterial({ color: '#111216', roughness: 0.5 });
    const table = new THREE.Mesh(new THREE.BoxGeometry(9, 0.8, 0.9), tableMat);
    table.position.set(0, 0.4, z - 0.2);
    table.castShadow = true;
    this.group.add(table);
    const led = makeLedTexture([`${this.home.abbr} vs ${this.away.abbr}`, 'HARDWOOD 27', 'OFFICIAL SCORER', 'GAME NIGHT'], ['#ffffff', '#ffd400', '#7ee0ff', this.home.colors.home[1]]);
    led.repeat.set(1.5, 1);
    const ledMat = new THREE.MeshBasicMaterial({ map: led, toneMapped: false });
    this.ledMats.push(ledMat);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(9, 0.62), ledMat);
    front.position.set(0, 0.42, z + 0.26);
    this.group.add(front);
    // Courtside LED boards under the camera along the near sideline baseline ends.
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W * 3, 0.7), ledMat);
      b.position.set(s * (HALF_L + 1.25), 0.36, 0);
      b.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      this.group.add(b);
    }
    // Bench chairs.
    const chairGeo = mergeGeometries([new THREE.BoxGeometry(0.5, 0.08, 0.5).translate(0, 0.46, 0), new THREE.BoxGeometry(0.5, 0.5, 0.06).translate(0, 0.72, -0.24), new THREE.BoxGeometry(0.06, 0.46, 0.06).translate(0, 0.23, 0)]);
    const chairs = new THREE.InstancedMesh(chairGeo, new THREE.MeshStandardMaterial({ color: '#2a2d35', roughness: 0.6 }), 26);
    const m4 = new THREE.Matrix4();
    let k = 0;
    for (const s of [-1, 1]) {
      for (let i = 0; i < 13; i++) {
        m4.makeTranslation(s * (5.6 + i * 0.6), 0, z - 0.4);
        chairs.setMatrixAt(k++, m4);
      }
    }
    chairs.castShadow = true;
    this.group.add(chairs);
    // Courtside seats on the camera side.
    const cs = new THREE.InstancedMesh(chairGeo, new THREE.MeshStandardMaterial({ color: '#5a1f1f', roughness: 0.7 }), 40);
    k = 0;
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Matrix4().makeRotationY(Math.PI);
      m.setPosition(-12 + i * 0.62, 0, HALF_W + 2.3);
      cs.setMatrixAt(k++, m);
    }
    this.group.add(cs);
  }

  buildCeiling() {
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(120, 100), new THREE.MeshBasicMaterial({ color: '#07080b' }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = 28;
    this.group.add(ceil);
    // Light trusses with emissive fixtures over the court.
    const fix = new THREE.MeshBasicMaterial({ color: '#fff6e0', toneMapped: false });
    const truss = new THREE.MeshStandardMaterial({ color: '#202228', roughness: 0.8, metalness: 0.5 });
    for (const zz of [-9, 9]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(44, 0.5, 0.5), truss);
      t.position.set(0, 21, zz);
      this.group.add(t);
      for (let xx = -20; xx <= 20; xx += 4) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.6), fix);
        f.position.set(xx, 20.7, zz);
        this.group.add(f);
      }
    }
    // Centre-hung video board.
    const jc = canvas(512, 256);
    const jt = tex(jc);
    const screen = new THREE.MeshBasicMaterial({ map: jt, toneMapped: false });
    const frame = new THREE.MeshStandardMaterial({ color: '#0d0e12', roughness: 0.6 });
    const jumbo = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 5), [screen, screen, frame, frame, screen, screen]);
    jumbo.position.set(0, 16.5, 0);
    this.group.add(jumbo);
    this.updaters.push((state) => {
      const key = `${state.score}|${state.clockText}|${state.quarterText}`;
      if (key === jumbo.lastKey) return;
      jumbo.lastKey = key;
      const x = jc.getContext('2d');
      x.fillStyle = '#05060a'; x.fillRect(0, 0, 512, 256);
      x.fillStyle = this.away.colors.home[1]; x.fillRect(0, 0, 256, 60);
      x.fillStyle = this.home.colors.home[1]; x.fillRect(256, 0, 256, 60);
      x.fillStyle = '#fff';
      x.font = '900 40px "Arial Black", Impact, sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(this.away.abbr, 128, 32); x.fillText(this.home.abbr, 384, 32);
      x.font = '900 96px "Arial Black", Impact, sans-serif';
      x.fillText(String(state.scoreAway ?? 0), 128, 130); x.fillText(String(state.scoreHome ?? 0), 384, 130);
      x.font = '700 40px "Courier New", monospace';
      x.fillStyle = '#ffcf33';
      x.fillText(`${state.quarterText}  ${state.clockText}`, 256, 222);
      jt.needsUpdate = true;
    });
  }

  buildOutdoor() {
    // Chain-link fence, park lights and a skyline backdrop.
    const fenceC = canvas(64, 64);
    const fx = fenceC.getContext('2d');
    fx.strokeStyle = '#a9b0b6'; fx.lineWidth = 3;
    fx.beginPath(); fx.moveTo(0, 0); fx.lineTo(64, 64); fx.moveTo(64, 0); fx.lineTo(0, 64); fx.stroke();
    const ft = tex(fenceC, true, true);
    ft.repeat.set(60, 4);
    const fenceMat = new THREE.MeshStandardMaterial({ map: ft, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.6 });
    const fw = HALF_L + 5, fd = HALF_W + 5;
    for (const [w, x, z, ry] of [[fw * 2, 0, fd, 0], [fw * 2, 0, -fd, 0], [fd * 2, fw, 0, Math.PI / 2], [fd * 2, -fw, 0, Math.PI / 2]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 4), fenceMat);
      m.position.set(x, 2, z); m.rotation.y = ry;
      this.group.add(m);
    }
    const skyC = canvas(1024, 256);
    const sx = skyC.getContext('2d');
    const gr = sx.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#0b1830'); gr.addColorStop(0.7, '#3b4e78'); gr.addColorStop(1, '#e08a4e');
    sx.fillStyle = gr; sx.fillRect(0, 0, 1024, 256);
    const r = rng(3);
    for (let i = 0; i < 70; i++) {
      const w = 12 + r() * 40, h = 30 + r() * 150, x0 = r() * 1024;
      sx.fillStyle = '#0a0d14'; sx.fillRect(x0, 256 - h, w, h);
      sx.fillStyle = 'rgba(255,214,120,0.7)';
      for (let k = 0; k < h / 6; k++) if (r() < 0.3) sx.fillRect(x0 + 2 + r() * (w - 4), 256 - h + k * 6, 2, 2);
    }
    const skyT = tex(skyC);
    const sky = new THREE.Mesh(new THREE.CylinderGeometry(70, 70, 40, 32, 1, true), new THREE.MeshBasicMaterial({ map: skyT, side: THREE.BackSide, toneMapped: false }));
    sky.position.y = 14;
    this.group.add(sky);
    for (const [x, z] of [[-fw, -fd], [fw, -fd], [-fw, fd], [fw, fd]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 9, 8), new THREE.MeshStandardMaterial({ color: '#333' }));
      pole.position.set(x, 4.5, z);
      this.group.add(pole);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.6), new THREE.MeshBasicMaterial({ color: '#fff8e0', toneMapped: false }));
      lamp.position.set(x * 0.95, 9, z * 0.95);
      this.group.add(lamp);
    }
    this.ledMats = [];
  }

  buildLights() {
    const scene = this.scene;
    const hemi = new THREE.HemisphereLight(this.outdoor ? '#9fb6ff' : '#b8c4d8', '#3a2a1a', this.outdoor ? 0.9 : 0.55);
    scene.add(hemi);
    const key = new THREE.DirectionalLight('#fff4e6', this.outdoor ? 2.0 : 2.4);
    key.position.set(4, 24, 8);
    key.target.position.set(0, 0, 0);
    if (this.opts.shadows) {
      key.castShadow = true;
      key.shadow.mapSize.set(this.opts.shadowSize, this.opts.shadowSize);
      const cam = key.shadow.camera;
      cam.left = -18; cam.right = 18; cam.top = 11; cam.bottom = -11; cam.near = 5; cam.far = 50;
      key.shadow.bias = -0.0004;
      key.shadow.normalBias = 0.02;
      key.shadow.radius = 3;
    }
    scene.add(key, key.target);
    this.keyLight = key;
    // Fill lights from the four corners of the rig.
    for (const [x, z] of [[-14, -9], [14, -9], [-14, 9], [14, 9]]) {
      const l = new THREE.PointLight('#fff0dd', this.outdoor ? 40 : 90, 45, 1.6);
      l.position.set(x, 18, z);
      scene.add(l);
    }
    if (!this.outdoor) {
      const amb = new THREE.AmbientLight('#404860', 0.25);
      scene.add(amb);
    }
  }

  update(dt, t, state, ball) {
    if (this.crowdUniforms) {
      this.crowdUniforms.uTime.value = t;
      const target = state.excite || 0;
      this.crowdUniforms.uExcite.value += (target - this.crowdUniforms.uExcite.value) * Math.min(1, dt * 2.5);
    }
    for (const m of this.ledMats || []) m.map.offset.x = (m.map.offset.x + dt * 0.03) % 1;
    for (const u of this.updaters) u(state);
    for (const n of this.nets) n.update(dt, ball);
  }
}

export { FLOOR_L, FLOOR_W };
