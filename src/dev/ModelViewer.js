// Developer tool: inspect a generated character and step through every
// animation clip (open the game with ?view=model). Drag to orbit, scroll to zoom.
// URL params: team, p (player index), uni, clip, t (freeze time), yaw, dist, fy (focus height), q (quality).
import * as THREE from 'three';
import rosters from '../data/rosters.json';
import { buildPlayerDef } from '../sim/Attributes.js';
import { Player } from '../sim/Player.js';
import { PlayerView } from '../render/PlayerView.js';
import { Renderer } from '../render/Renderer.js';

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
  const ti = Number(params.get('team') || 0), pi = Number(params.get('p') || 0);
  const team = rosters.teams[ti];
  const def = buildPlayerDef(team.players[pi], team.id);
  const p = new Player(def, 0, true);
  p.onCourt = true;
  p.setPos(0, 0, Math.PI / 2);
  const view = new PlayerView(p, { colors: team.colors[params.get('uni') || 'home'] }, { quality: r.q.mesh, teamName: team.name });
  scene.add(view.root);
  const clips = Object.keys(view.lib.clips);
  let clip = params.get('clip') || 'idle';
  let t = Number(params.get('t') || 0);
  let playing = !params.has('t');
  const panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;top:10px;left:10px;background:rgba(0,0,0,.6);padding:8px;font:13px sans-serif;color:#fff;max-height:90vh;overflow:auto';
  panel.innerHTML = `<b>${def.name}</b> ${def.pos} ${Math.round(def.heightM * 100)}cm<br>${clips.map((c) => `<button data-c="${c}" style="display:block;margin:2px 0;padding:2px 8px;font-size:12px">${c}</button>`).join('')}`;
  if (!params.has('nopanel')) ui.appendChild(panel);
  panel.addEventListener('click', (e) => { if (e.target.dataset.c) { clip = e.target.dataset.c; t = 0; playing = true; } });
  let yaw = Number(params.get('yaw') || 0.6), pitch = Number(params.get('pitch') || 0.12), dist = Number(params.get('dist') || 3.6);
  let drag = null;
  stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
  window.addEventListener('pointerup', () => { drag = null; });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    yaw -= (e.clientX - drag.x) * 0.01;
    pitch = Math.max(-0.3, Math.min(1.2, pitch + (e.clientY - drag.y) * 0.01));
    drag = { x: e.clientX, y: e.clientY };
  });
  stage.addEventListener('wheel', (e) => { dist = Math.max(0.6, Math.min(12, dist * (1 + e.deltaY * 0.001))); });
  let last = performance.now();
  const focusY = Number(params.get('fy') || def.heightM * 0.55);
  const loop = (now) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const c = view.lib.clips[clip];
    if (playing) t = (t + dt) % c.duration;
    for (const [n, a] of Object.entries(view.actions)) {
      a.setEffectiveWeight(n === clip ? 1 : 0);
      a.paused = true;
      a.time = n === clip ? Math.min(t, c.duration - 1e-3) : 0;
    }
    view.mixer.update(0);
    view.root.updateMatrixWorld(true);
    const cam = r.camera;
    cam.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, focusY + Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
    cam.lookAt(0, focusY, 0);
    r.render();
  };
  requestAnimationFrame(loop);
  window.__viewer = { view, setClip: (c, tt) => { clip = c; t = tt; playing = false; } };
}
