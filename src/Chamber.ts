import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import type { Memory } from './types';

const DEFAULT_POS    = new THREE.Vector3(0, 0, 5);
const DEFAULT_TARGET = new THREE.Vector3(0, 0, 0);

const MOVE_SPEED = 1.5;  // units per second

export class Chamber {
  readonly camera: THREE.PerspectiveCamera;
  readonly orbit : OrbitControls;

  private viewer    : InstanceType<typeof GaussianSplats3D.Viewer> | null = null;
  private currentId : string | null = null;
  private keys      = new Set<string>();

  constructor(private renderer: THREE.WebGLRenderer) {
    this.camera = new THREE.PerspectiveCamera(
      60, window.innerWidth / window.innerHeight, 0.01, 500,
    );
    this.camera.position.copy(DEFAULT_POS);

    this.orbit = new OrbitControls(this.camera, renderer.domElement);
    this.orbit.enableDamping  = true;
    this.orbit.dampingFactor  = 0.06;
    this.orbit.minDistance    = 0.3;
    this.orbit.maxDistance    = 30;
    this.orbit.enabled        = false;

    window.addEventListener('resize', this.onResize);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 'a' || k === 's' || k === 'd') {
      e.preventDefault();
      this.keys.add(k);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private applyWASD(delta: number) {
    if (this.keys.size === 0) return;

    // Forward vector (full 3D direction the camera is looking)
    const forward = new THREE.Vector3()
      .subVectors(this.orbit.target, this.camera.position)
      .normalize();

    if (this.keys.has('w')) {
      this.camera.position.addScaledVector(forward,  MOVE_SPEED * delta);
      this.orbit.target.addScaledVector(forward,     MOVE_SPEED * delta);
    }
    if (this.keys.has('s')) {
      this.camera.position.addScaledVector(forward, -MOVE_SPEED * delta);
      this.orbit.target.addScaledVector(forward,    -MOVE_SPEED * delta);
    }

    // A/D: strafe left/right
    const right = new THREE.Vector3()
      .crossVectors(forward, this.camera.up)
      .normalize();
    if (this.keys.has('d')) {
      this.camera.position.addScaledVector(right,  MOVE_SPEED * delta);
      this.orbit.target.addScaledVector(right,     MOVE_SPEED * delta);
    }
    if (this.keys.has('a')) {
      this.camera.position.addScaledVector(right, -MOVE_SPEED * delta);
      this.orbit.target.addScaledVector(right,    -MOVE_SPEED * delta);
    }
  }

  async enter(memory: Memory): Promise<void> {
    this.currentId = memory.id;
    this.orbit.enabled = true;
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup',   this.onKeyUp);

    // Start at default or pinned view
    const pinned = this.loadView(memory.id);
    if (!pinned) {
      this.camera.position.copy(DEFAULT_POS);
      this.orbit.target.copy(DEFAULT_TARGET);
    }
    this.orbit.update();

    if (this.viewer) {
      try { await (this.viewer as any).dispose(); } catch { /* ignore */ }
      this.viewer = null;
    }

    try {
      // SceneRevealMode.Gradual = 1 — splats materialize outward from the camera
      // sceneFadeInRateMultiplier < 1 slows the reveal for a dramatic buildup effect
      this.viewer = new GaussianSplats3D.Viewer({
        selfDrivenMode:            false,
        renderer:                  this.renderer,
        camera:                    this.camera,
        useBuiltInControls:        false,
        gpuAcceleratedSort:        false,
        sharedMemoryForWorkers:    false,
        sceneRevealMode:           1,   // Gradual
        sceneFadeInRateMultiplier: 0.4, // slower → more dramatic particle buildup
      });

      await (this.viewer as any).addSplatScene(memory.plyUrl, {
        format:   (GaussianSplats3D as any).SceneFormat?.Ply ?? 2,
        rotation: [1, 0, 0, 0],  // 180° around X — converts SLAM (Y-down) to Three.js (Y-up)
        splatAlphaRemovalThreshold: 5,
      });
    } catch (err) {
      console.error('[Chamber] load error:', err);
      this.viewer = null;
    }
  }

  exit() {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup',   this.onKeyUp);
    this.keys.clear();
    this.orbit.enabled = false;
    this.currentId = null;
    if (this.viewer) {
      try { (this.viewer as any).dispose?.(); } catch { /* ignore */ }
      this.viewer = null;
    }
  }

  update(delta: number) {
    this.applyWASD(delta);
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
    try { (this.viewer as any).render(); } catch { /* ignore */ }
  }

  /** Save current camera position + orbit target to localStorage */
  pinView() {
    if (!this.currentId) return;
    localStorage.setItem(`recall_view_${this.currentId}`, JSON.stringify({
      px: this.camera.position.x, py: this.camera.position.y, pz: this.camera.position.z,
      tx: this.orbit.target.x,    ty: this.orbit.target.y,    tz: this.orbit.target.z,
    }));
  }

  /** Restore pinned view. Returns true if a pinned view was found. */
  loadView(id: string): boolean {
    const raw = localStorage.getItem(`recall_view_${id}`);
    if (!raw) return false;
    try {
      const v = JSON.parse(raw);
      this.camera.position.set(v.px, v.py, v.pz);
      this.orbit.target.set(v.tx, v.ty, v.tz);
      this.orbit.update();
      return true;
    } catch { return false; }
  }

  /** Reset to default view (ignores pinned) */
  resetToDefault() {
    this.camera.position.copy(DEFAULT_POS);
    this.orbit.target.copy(DEFAULT_TARGET);
    this.orbit.update();
  }

  hasPinnedView(): boolean {
    return this.currentId != null &&
      localStorage.getItem(`recall_view_${this.currentId}`) != null;
  }

  getCoords() {
    return {
      px: this.camera.position.x, py: this.camera.position.y, pz: this.camera.position.z,
      tx: this.orbit.target.x,    ty: this.orbit.target.y,    tz: this.orbit.target.z,
    };
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  };

  dispose() {
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup',   this.onKeyUp);
    this.orbit.dispose();
    if (this.viewer) {
      try { (this.viewer as any).dispose?.(); } catch { /* ignore */ }
    }
  }
}
