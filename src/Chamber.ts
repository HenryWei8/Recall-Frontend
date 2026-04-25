import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import type { Memory } from './types';

export class Chamber {
  readonly camera: THREE.PerspectiveCamera;

  private orbit : OrbitControls;
  private viewer: InstanceType<typeof GaussianSplats3D.Viewer> | null = null;

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
    this.camera.position.set(0, 0, 5);
    this.orbit.target.set(0, 0, 0);
    this.orbit.update();

    if (this.viewer) {
      try { (this.viewer as any).dispose?.(); } catch { /* ignore */ }
      this.viewer = null;
    }

    try {
      this.viewer = new GaussianSplats3D.Viewer({
        selfDrivenMode:         false,
        renderer:               this.renderer,
        camera:                 this.camera,
        useBuiltInControls:     false,
        gpuAcceleratedSort:     false,   // off avoids SharedArrayBuffer requirement
        sharedMemoryForWorkers: false,
      });

      await (this.viewer as any).addSplatScene(memory.plyUrl, {
        splatAlphaRemovalThreshold: 5,
      });
    } catch (err) {
      console.warn('GaussianSplats3D load error:', err);
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
      try { (this.viewer as any).update(); } catch { /* ignore */ }
    }
  }

  render() {
    if (!this.viewer) {
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.clear();
      return;
    }
    try {
      // Always let the library drive its own render pipeline —
      // never render its internal scene directly, that skips the splat passes.
      (this.viewer as any).render();
    } catch (e) {
      console.warn('splat render error:', e);
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
