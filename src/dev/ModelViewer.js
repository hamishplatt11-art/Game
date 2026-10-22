// Developer tool: character model viewer (open the game with ?view=model).
// - front / side / back / three-quarter / top views, drag to orbit, wheel to zoom
// - every animation clip, play/pause, speed, timeline scrubbing
// - skeleton overlay and joint inspector (local rotation, world position)
// - team / player / uniform switching (textures rebuilt per uniform)
// - rig validation report (bones, skin weights, symmetry, per-clip checks)
// - external GLB import: maps the file's skeleton onto this rig and retargets
//   the selected clip live, side by side with the built-in character
// - export the built-in character as GLB (starting point for Blender work)
// URL params: team, p, uni, clip, t (freeze time), yaw, pitch, dist, fy, q,
// official, nopanel, glb (URL of a .glb to import), view (front|side|back|three|top)
import * as THREE from 'three';
import rosters from '../data/rosters.json';
import { buildPlayerDef } from '../sim/Attributes.js';
import { Player } from '../sim/Player.js';
import { PlayerView } from '../render/PlayerView.js';
import { Renderer } from '../render/Renderer.js';
import { BONES } from '../render/HumanModel.js';
import { validateRig } from './RigCheck.js';

const VIEWS = { front: [0, 0.08], three: [0.6, 0.12], side: [Math.PI / 2, 0.06], back: [Math.PI, 0.08], top: [0.3, 1.25] };

export function startModelViewer(stage, ui) {
  const params = new URLSearchParams(location.search);
  const r = new Renderer(stage, params.get('q') || 'high');
  const scene = r.scene;
  scene.background = new THREE.Color('#1b1e26');
  scene.add(new THREE.HemisphereLight('#cfd8ff', '#3a2a1a', 0.9));
  const key = new THREE.DirectionalLight('#fff3e0', 2.5);
  key.position.set(3, 6, 5);
  key.castShadow = true;
  scene.add(key);
  const rim = new THREE.DirectionalLight('#9cc8ff', 1.2);
  rim.position.set(-4, 4, -5);
  scene.add(rim);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: '#c99a5b', roughness: 0.4 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(4, 8, 0x444444, 0x333333);
  grid.position.y = 0.001;
  scene.add(grid);

  const st = {
    team: Number(params.get('team') || 0), p: Number(params.get('p') || 0), uni: params.get('uni') || 'home',
    clip: params.get('clip') || 'idle', t: Number(params.get('t') || 0), playing: !params.has('t'), speed: 1,
    skeleton: false, joint: 'hips', official: params.has('official'),
  };
  let view = null, def = null, helper = null, ext = null;

  const build = () => {
    if (view) { scene.remove(view.root); view.dispose(); }
    if (helper) { scene.remove(helper); helper = null; }
    const team = rosters.teams[st.team];
    st.p = Math.min(st.p, team.players.length - 1);
    def = buildPlayerDef(team.players[st.p], team.id);
    const p = new Player(def, 0, true);
    p.onCourt = true;
    p.setPos(0, 0, Math.PI / 2);
    const uniform = st.official ? { colors: ['#9ea3ab', '#16171b', '#16171b'], official: true } : { colors: team.colors[st.uni] || team.colors.home };
    view = new PlayerView(p, uniform, { quality: r.q.mesh, teamName: team.name });
    scene.add(view.root);
    if (st.skeleton) { helper = new THREE.SkeletonHelper(view.root); scene.add(helper); }
    if (!view.lib.clips[st.clip]) st.clip = 'idle';
    if (ext) attachExternal(ext.source);
    renderPanel();
  };

  // ---------------------------------------------------------------- panel
  const panel = document.createElement('div');
  panel.className = 'mv-panel';
  panel.style.cssText = 'position:absolute;top:10px;left:10px;width:300px;background:rgba(0,0,0,.72);padding:10px;font:12px/1.4 system-ui,sans-serif;color:#fff;max-height:calc(100vh - 20px);overflow:auto';
  const info = document.createElement('div');
  info.style.cssText = 'position:absolute;right:10px;top:10px;width:300px;background:rgba(0,0,0,.72);padding:10px;font:11px/1.4 ui-monospace,Menlo,monospace;color:#cfe;white-space:pre-wrap;max-height:calc(100vh - 20px);overflow:auto';
  if (!params.has('nopanel')) { ui.appendChild(panel); ui.appendChild(info); }
  const btn = (attrs, label, on) => `<button ${attrs} style="margin:2px;padding:2px 7px;font-size:12px;${on ? 'background:#2d7ff9;color:#fff' : ''}">${label}</button>`;
  function renderPanel() {
    const team = rosters.teams[st.team];
    const clips = Object.keys(view.lib.clips);
    const dur = view.lib.clips[st.clip].duration;
    panel.innerHTML = `
      <b>${def.name}</b> · ${def.pos} · ${Math.round(def.heightM * 100)} cm · ${Math.round(def.weightKg)} kg<br>
      <div>${btn('data-a="team-"', '‹')}${team.city} ${team.name}${btn('data-a="team+"', '›')}</div>
      <div>${btn('data-a="p-"', '‹ player')}${btn('data-a="p+"', 'player ›')}</div>
      <div>Uniform: ${['home', 'away', 'alt'].filter((u) => team.colors[u]).map((u) => btn(`data-uni="${u}"`, u, st.uni === u && !st.official)).join('')}${btn('data-a="official"', 'referee', st.official)}</div>
      <div>View: ${Object.keys(VIEWS).map((v) => btn(`data-view="${v}"`, v)).join('')}</div>
      <div>${btn('data-a="play"', st.playing ? '❚❚ pause' : '▶ play')} speed ${[0.25, 0.5, 1].map((s) => btn(`data-speed="${s}"`, s + '×', st.speed === s)).join('')}</div>
      <input type="range" min="0" max="${dur}" step="0.001" value="${st.t}" data-scrub style="width:100%">
      <div>${btn('data-a="skel"', 'skeleton', st.skeleton)} joint <select data-joint>${BONES.map((b) => `<option ${b === st.joint ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
      <div>${btn('data-a="check"', 'Validate rig')}${btn('data-a="export"', 'Export GLB')}</div>
      <div>Import GLB: <input type="file" accept=".glb,.gltf" data-file style="width:180px"></div>
      <div style="margin-top:6px;columns:2">${clips.map((c) => `<div>${btn(`data-c="${c}"`, c, c === st.clip)}</div>`).join('')}</div>`;
  }
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    const n = rosters.teams.length;
    if (d.c) { st.clip = d.c; st.t = 0; st.playing = true; }
    else if (d.uni) { st.uni = d.uni; st.official = false; build(); return; }
    else if (d.view) setView(d.view);
    else if (d.speed) st.speed = Number(d.speed);
    else if (d.a === 'team-' || d.a === 'team+') { st.team = (st.team + (d.a === 'team+' ? 1 : -1) + n) % n; st.p = 0; build(); return; }
    else if (d.a === 'p-' || d.a === 'p+') { const m = rosters.teams[st.team].players.length; st.p = (st.p + (d.a === 'p+' ? 1 : -1) + m) % m; build(); return; }
    else if (d.a === 'official') { st.official = !st.official; build(); return; }
    else if (d.a === 'play') st.playing = !st.playing;
    else if (d.a === 'skel') {
      st.skeleton = !st.skeleton;
      if (helper) { scene.remove(helper); helper = null; }
      if (st.skeleton) { helper = new THREE.SkeletonHelper(view.root); scene.add(helper); }
    } else if (d.a === 'check') { lastCheck = validateRig(view); }
    else if (d.a === 'export') exportGLB();
    renderPanel();
  });
  panel.addEventListener('input', (e) => {
    if (e.target.dataset.scrub !== undefined) { st.t = Number(e.target.value); st.playing = false; }
  });
  panel.addEventListener('change', (e) => {
    if (e.target.dataset.joint !== undefined) st.joint = e.target.value;
    if (e.target.dataset.file !== undefined && e.target.files[0]) attachExternal(e.target.files[0]);
  });

  // ---------------------------------------------------------------- camera
  let yaw = Number(params.get('yaw') ?? 0.6), pitch = Number(params.get('pitch') ?? 0.12), dist = Number(params.get('dist') || 3.6);
  const setView = (v) => { [yaw, pitch] = VIEWS[v]; };
  if (params.get('view') && VIEWS[params.get('view')]) setView(params.get('view'));
  let drag = null;
  stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
  window.addEventListener('pointerup', () => { drag = null; });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    yaw -= (e.clientX - drag.x) * 0.01;
    pitch = Math.max(-0.3, Math.min(1.4, pitch + (e.clientY - drag.y) * 0.01));
    drag = { x: e.clientX, y: e.clientY };
  });
  stage.addEventListener('wheel', (e) => { dist = Math.max(0.6, Math.min(12, dist * (1 + e.deltaY * 0.001))); });

  // ---------------------------------------------------------------- external GLB
  async function attachExternal(source) {
    const { loadExternalCharacter, Retargeter } = await import('../render/Retarget.js');
    if (ext) { scene.remove(ext.scene); ext = null; }
    try {
      const res = await loadExternalCharacter(source);
      // Retarget from the built-in rig in its rest pose.
      view.mixer.stopAllAction();
      for (const b of BONES) view.bones[b].quaternion.identity();
      view.root.updateMatrixWorld(true);
      const rt = res.mapping.ok ? new Retargeter(view.bones, res.scene, res.mapping) : null;
      for (const a of Object.values(view.actions)) { a.play(); a.paused = true; }
      res.scene.position.x += 1.1;
      scene.add(res.scene);
      ext = { ...res, rt, source };
      extMsg = `GLB: ${res.bones.length} bones, mapped ${res.mapping.mapped}/23${res.mapping.ok ? '' : ` — missing ${res.mapping.missing.join(', ')} (shown in its own pose)`}`;
    } catch (err) {
      extMsg = `GLB import failed: ${err.message || err}`;
    }
  }
  let extMsg = '';
  if (params.get('glb')) attachExternal(params.get('glb'));

  async function exportGLB() {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    const glb = await new GLTFExporter().parseAsync(view.root, { binary: true, animations: Object.values(view.lib.clips) });
    const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${def.name.replace(/\W+/g, '_')}.glb`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------------------------------------------------------------- loop
  let lastCheck = null;
  let last = performance.now();
  const loop = (now) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const c = view.lib.clips[st.clip];
    if (st.playing) {
      st.t = (st.t + dt * st.speed) % c.duration;
      const sl = panel.querySelector('[data-scrub]');
      if (sl) sl.value = st.t;
    }
    for (const [n, a] of Object.entries(view.actions)) {
      a.setEffectiveWeight(n === st.clip ? 1 : 0);
      a.paused = true;
      a.time = n === st.clip ? Math.min(st.t, c.duration - 1e-3) : 0;
    }
    view.mixer.update(0);
    view.root.updateMatrixWorld(true);
    if (ext && ext.rt) ext.rt.apply();
    const focusY = Number(params.get('fy') || def.heightM * 0.55);
    const cam = r.camera;
    const cx = ext ? 0.55 : 0;
    cam.position.set(cx + Math.sin(yaw) * Math.cos(pitch) * dist, focusY + Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
    cam.lookAt(cx, focusY, 0);
    r.render();
    // Inspector.
    const jb = view.bones[st.joint];
    const e = new THREE.Euler().setFromQuaternion(jb.quaternion);
    const wp = jb.getWorldPosition(new THREE.Vector3());
    const deg = (x) => (x * 180 / Math.PI).toFixed(1);
    let txt = `clip ${st.clip}  t=${st.t.toFixed(3)} / ${c.duration.toFixed(3)} s\njoint ${st.joint}\n  local rot (deg) x ${deg(e.x)}  y ${deg(e.y)}  z ${deg(e.z)}\n  world pos (m)   ${wp.x.toFixed(3)} ${wp.y.toFixed(3)} ${wp.z.toFixed(3)}\n`;
    if (extMsg) txt += `\n${extMsg}\n`;
    if (lastCheck) {
      txt += `\nRIG CHECK: ${lastCheck.pass ? 'PASS' : 'FAIL'}\n` + lastCheck.checks.map((k) => `${k.ok ? '✓' : '✗'} ${k.name}${k.detail ? `  (${k.detail})` : ''}`).join('\n');
    }
    if (info.textContent !== txt) info.textContent = txt;
  };
  build();
  requestAnimationFrame(loop);
  window.__viewer = {
    get view() { return view; },
    setClip: (c, tt) => { st.clip = c; st.t = tt; st.playing = false; },
    setView,
    validate: () => (lastCheck = validateRig(view)),
    importGLB: (src) => attachExternal(src).then(() => ({ msg: extMsg, mapped: ext && ext.mapping.mapped, ok: !!(ext && ext.rt) })),
    exportGLB: async () => {
      const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
      return new GLTFExporter().parseAsync(view.root, { binary: true });
    },
  };
}
