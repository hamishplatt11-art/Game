// WebGL2 renderer with graphics presets, ACES tone mapping, PMREM arena
// environment for glossy reflections, optional planar floor reflection and
// bloom post-processing.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

export const QUALITY = {
  low: { pixelRatio: 0.75, shadows: false, shadowSize: 512, bloom: false, reflect: false, aa: false, mesh: 'low' },
  medium: { pixelRatio: 1, shadows: true, shadowSize: 1024, bloom: false, reflect: false, aa: true, mesh: 'medium' },
  high: { pixelRatio: 1.25, shadows: true, shadowSize: 2048, bloom: true, reflect: false, aa: true, mesh: 'high' },
  ultra: { pixelRatio: 2, shadows: true, shadowSize: 4096, bloom: true, reflect: true, aa: true, mesh: 'high' },
};

export class Renderer {
  constructor(container, quality = 'high') {
    this.q = QUALITY[quality] || QUALITY.high;
    this.qualityName = quality;
    const r = new THREE.WebGLRenderer({ antialias: this.q.aa, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pixelRatio));
    r.setSize(container.clientWidth, container.clientHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = this.q.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05060a');
    this.camera = new THREE.PerspectiveCamera(37, container.clientWidth / container.clientHeight, 0.1, 400);
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    if (this.q.bloom) {
      const rt = new THREE.WebGLRenderTarget(container.clientWidth, container.clientHeight, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(r, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 0.18, 0.5, 0.92);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.container = container;
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.info = r.info;
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
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) this.composer.setSize(w, h);
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
