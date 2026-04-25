import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

export class WalkControls {
  private controls: PointerLockControls;
  private velocity = new THREE.Vector3();
  private keys = { w: false, a: false, s: false, d: false };
  private speed = 8;
  private damping = 12;

  private _onKeyDown: (e: KeyboardEvent) => void;
  private _onKeyUp: (e: KeyboardEvent) => void;
  private _onLock: () => void;
  private _onUnlock: () => void;

  constructor(
    camera: THREE.Camera,
    domElement: HTMLElement,
    private onLock: () => void,
    private onUnlock: () => void,
  ) {
    this.controls = new PointerLockControls(camera, domElement);

    this._onKeyDown = (e: KeyboardEvent) => this.onKeyDown(e);
    this._onKeyUp   = (e: KeyboardEvent) => this.onKeyUp(e);
    this._onLock    = () => { this.onLock(); };
    this._onUnlock  = () => { this.onUnlock(); };

    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup',   this._onKeyUp);
    this.controls.addEventListener('lock',   this._onLock);
    this.controls.addEventListener('unlock', this._onUnlock);
  }

  private onKeyDown(e: KeyboardEvent) {
    if (e.code === 'KeyW' || e.code === 'ArrowUp')    this.keys.w = true;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft')  this.keys.a = true;
    if (e.code === 'KeyS' || e.code === 'ArrowDown')  this.keys.s = true;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') this.keys.d = true;
  }

  private onKeyUp(e: KeyboardEvent) {
    if (e.code === 'KeyW' || e.code === 'ArrowUp')    this.keys.w = false;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft')  this.keys.a = false;
    if (e.code === 'KeyS' || e.code === 'ArrowDown')  this.keys.s = false;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') this.keys.d = false;
  }

  lock()   { this.controls.lock(); }
  unlock() { this.controls.unlock(); }
  get isLocked() { return this.controls.isLocked; }

  update(delta: number) {
    if (!this.controls.isLocked) return;

    const accel = this.speed * 10;
    if (this.keys.w) this.velocity.z -= accel * delta;
    if (this.keys.s) this.velocity.z += accel * delta;
    if (this.keys.a) this.velocity.x -= accel * delta;
    if (this.keys.d) this.velocity.x += accel * delta;

    this.velocity.x -= this.velocity.x * this.damping * delta;
    this.velocity.z -= this.velocity.z * this.damping * delta;

    this.controls.moveRight(this.velocity.x * delta);
    this.controls.moveForward(-this.velocity.z * delta);

    // Keep camera at eye level
    this.controls.getObject().position.y = 1.7;
  }

  dispose() {
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup',   this._onKeyUp);
    this.controls.removeEventListener('lock',   this._onLock);
    this.controls.removeEventListener('unlock', this._onUnlock);
    this.controls.dispose();
  }
}
