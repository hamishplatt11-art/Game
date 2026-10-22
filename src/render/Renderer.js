// WebGL2 renderer with graphics presets, ACES tone mapping, PMREM arena
// environment for glossy reflections, optional planar floor reflection and
// bloom. Handles resize/DPR changes, context loss/restore, post-process
// failures (falls back to direct rendering) and full GPU resource disposal.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

export const QUALITY = {
  low: { pixelRatio: 0.75, shadows: false, shadowSize: 512, bloom: false, reflect: false, aa: false, mesh: 'low', crowd: 0.35 },
  medium: { pixelRatio: 1, shadows: true, shadowSize: 1024, bloom: false, reflect: false, aa: true, mesh: 'medium', crowd: 0.6 },
  high: { pixelRatio: 1.5, shadows: true, shadowSize: 2048, bloom: true, reflect: false, aa: true, mesh: 'high', crowd: 1 },
  ultra: { pixelRatio: 2, shadows: true, shadowSize: 4096, bloom: true, reflect: true, aa: true, mesh: 'high', crowd: 1 },
};

export class RendererError extends Error {}

export class Renderer {
  constructor(container, quality = 'high', hooks = {}) {
    this.q = QUALITY[quality] || QUALITY.high;
    this.qualityName = quality;
    this.hooks = hooks;
    let r;
    try {
      r = new THREE.WebGLRenderer({ antialias: this.q.aa, powerPreference: 'high-performance', stencil: false });
    } catch (e) {
      throw new RendererError(`Could not create a WebGL2 context (${e.message || e}). Enable hardware acceleration in your browser settings, or try another browser.`);
    }
    if (!r.capabilities.isWebGL2) throw new RendererError('This browser only offers WebGL1; Hardwood 27 needs WebGL2.');
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pixelRatio));
    r.setSize(container.clientWidth || 1, container.clientHeight || 1);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = this.q.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.debug.onShaderError = (gl, program, vs, fs) => {
      this.shaderErrors = (this.shaderErrors || 0) + 1;
      console.warn('Shader compile error', gl.getProgramInfoLog(program));
    };
    container.appendChild(r.domElement);
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05060a');
    this.camera = new THREE.PerspectiveCamera(37, (container.clientWidth || 1) / (container.clientHeight || 1), 0.1, 400);
    this.pmrem = new THREE.PMREMGenerator(r);
    this.envRT = this.pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.35;
    if (this.q.bloom) {
      try {
        const rt = new THREE.WebGLRenderTarget(container.clientWidth || 1, container.clientHeight || 1, { type: THREE.HalfFloatType, samples: 4 });
        this.composer = new EffectComposer(r, rt);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloom = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 0.14, 0.45, 0.94);
        this.composer.addPass(this.bloom);
        this.composer.addPass(new OutputPass());
      } catch (e) {
        console.warn('Post-processing disabled:', e);
        this.composer = null;
      }
    }
    this.container = container;
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    if (window.ResizeObserver) {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(container);
    }
    this.watchDpr();
    this.onLost = (e) => { e.preventDefault(); this.lost = true; hooks.onContextLost?.(); };
    this.onRestored = () => { this.lost = false; hooks.onContextRestored?.(); };
    r.domElement.addEventListener('webglcontextlost', this.onLost);
    r.domElement.addEventListener('webglcontextrestored', this.onRestored);
    this.info = r.info;
  }

  watchDpr() {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.dprListener = () => {
      if (!this.renderer) return;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pixelRatio));
      this.resize();
      this.watchDpr();
    };
    // Kept so dispose() can detach it: a live MediaQueryList listener would
    // otherwise keep this renderer (and its whole scene) reachable forever.
    this.dprMq = mq;
    mq.addEventListener?.('change', this.dprListener, { once: true });
  }

  addFloorReflection() {
    if (!this.q.reflect) return;
    const geo = new THREE.PlaneGeometry(40, 26);
    const refl = new Reflector(geo, { textureWidth: this.container.clientWidth * 0.5, textureHeight: this.container.clientHeight * 0.5, color: 0x888888 });
    refl.rotation.x = -Math.PI / 2;
    refl.position.y = -0.001;
    this.scene.add(refl);
    this.reflector = refl;
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    if (w === this.lastW && h === this.lastH && this.renderer.getPixelRatio() === this.lastDpr) return;
    this.lastW = w; this.lastH = h; this.lastDpr = this.renderer.getPixelRatio();
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) this.composer.setSize(w, h);
  }

  render() {
    if (this.lost) return;
    if (this.composer) {
      try {
        this.composer.render();
        return;
      } catch (e) {
        // Skip only the failing effect: fall back to direct rendering.
        console.warn('Post-processing failed, rendering without it:', e);
        this.composer = null;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Free every GPU resource owned by this renderer and its scene. */
  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.ro?.disconnect();
    this.dprMq?.removeEventListener?.('change', this.dprListener);
    this.dprMq = null;
    const r = this.renderer;
    r.domElement.removeEventListener('webglcontextlost', this.onLost);
    r.domElement.removeEventListener('webglcontextrestored', this.onRestored);
    const mats = new Set(), geos = new Set(), texs = new Set();
    this.scene.traverse((o) => {
      if (o.geometry) geos.add(o.geometry);
      const m = o.material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => mats.add(x));
      if (o.skeleton) o.skeleton.dispose?.();
    });
    for (const m of mats) {
      for (const v of Object.values(m)) if (v && v.isTexture) texs.add(v);
      m.dispose();
    }
    geos.forEach((g) => g.dispose());
    texs.forEach((t) => t.dispose());
    this.reflector?.getRenderTarget?.().dispose();
    this.envRT?.dispose();
    this.pmrem?.dispose();
    if (this.composer) {
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
      this.bloom?.dispose();
    }
    r.dispose();
    r.forceContextLoss();
    r.domElement.remove();
  }
}
