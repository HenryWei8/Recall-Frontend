import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import type { Memory } from './types';

export class Chamber {
  readonly camera: THREE.PerspectiveCamera;

  private orbit : OrbitControls;
  private viewer: InstanceType<typeof GaussianSplats3D.Viewer> | null = null;
  private frameCount = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.camera = new THREE.PerspectiveCamera(
      60, window.innerWidth / window.innerHeight, 0.01, 500,
    );
    this.camera.position.set(0, 0, 5);

    this.orbit = new OrbitControls(this.camera, renderer.domElement);
    this.orbit.enableDamping  = true;
    this.orbit.dampingFactor  = 0.06;
    this.orbit.minDistance    = 0.3;
    this.orbit.maxDistance    = 30;
    this.orbit.enabled        = false;

    window.addEventListener('resize', this.onResize);
  }

  async enter(memory: Memory): Promise<void> {
    this.orbit.enabled = true;
    this.frameCount = 0;
    this.camera.position.set(0, 0, 5);
    this.orbit.target.set(0, 0, 0);
    this.orbit.update();

    if (this.viewer) {
      try { await (this.viewer as any).dispose(); } catch { /* ignore */ }
      this.viewer = null;
    }

    console.log('[Chamber] Loading PLY:', memory.plyUrl);

    try {
      this.viewer = new GaussianSplats3D.Viewer({
        selfDrivenMode:         false,
        renderer:               this.renderer,
        camera:                 this.camera,
        useBuiltInControls:     false,
        gpuAcceleratedSort:     false,
        sharedMemoryForWorkers: false,
      });

      await (this.viewer as any).addSplatScene(memory.plyUrl, {
        format: GaussianSplats3D.SceneFormat.Ply,
        splatAlphaRemovalThreshold: 5,
      });

      const v = this.viewer as any;
      console.log('[Chamber] Scene loaded — initialized:', v.initialized,
        'splatRenderReady:', v.splatRenderReady,
        'splatCount:', v.splatMesh?.getSplatCount?.());
    } catch (err) {
      console.error('[Chamber] GaussianSplats3D load error:', err);
      this.viewer = null;
    }
  }

  exit() {
    this.orbit.enabled = false;
    if (this.viewer) {
      try { (this.viewer as any).dispose?.(); } catch { /* ignore */ }
      this.viewer = null;
    }
  }

  update(_delta: number) {
    this.orbit.update();
    if (this.viewer) {
      try { (this.viewer as any).update(); } catch (e) {
        console.warn('[Chamber] update error:', e);
      }
    }
  }

  render() {
    if (!this.viewer) {
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.clear();
      return;
    }

    const v = this.viewer as any;
    this.frameCount++;
    if (this.frameCount <= 5 || this.frameCount % 120 === 0) {
      console.log(`[Chamber] render() frame=${this.frameCount}`,
        'initialized:', v.initialized,
        'splatRenderReady:', v.splatRenderReady,
        'disposing:', v.disposing,
        'disposed:', v.disposed,
        'splatCount:', v.splatMesh?.getSplatCount?.());
    }

    try {
      v.render();
    } catch (e) {
      console.warn('[Chamber] splat render error:', e);
    }
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  };

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.orbit.dispose();
    if (this.viewer) {
      try { (this.viewer as any).dispose?.(); } catch { /* ignore */ }
    }
  }
}
