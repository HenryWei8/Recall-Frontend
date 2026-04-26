import * as THREE from 'three';
import gsap from 'gsap';
import type { Memory } from './types';
import bubbleVert from './shaders/bubble.vert.glsl?raw';
import bubbleFrag from './shaders/bubble.frag.glsl?raw';

const VIDEO_NEAR  = 13;
const VIDEO_FAR   = 17;
const RADIUS      = 1.2;
const ENTER_DIST  = 1.8;

export class Bubble {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private video:        HTMLVideoElement;
  private videoTexture: THREE.VideoTexture;
  private videoActive   = false;
  private hoverActive   = false;
  private idleTweens:   gsap.core.Tween[] = [];
  private _worldPos     = new THREE.Vector3();

  constructor(
    readonly memory: Memory,
    private scene:   THREE.Scene,
    _loader:         THREE.TextureLoader,
  ) {
    // ── Video element ────────────────────────────────────────────────────
    this.video             = document.createElement('video');
    this.video.src         = memory.thumbnailUrl;
    this.video.loop        = true;
    this.video.muted       = true;
    this.video.playsInline = true;
    this.video.preload     = 'auto';
    this.video.crossOrigin = 'anonymous';
    this.videoTexture      = new THREE.VideoTexture(this.video);
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;

    // ── Material ─────────────────────────────────────────────────────────
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime:        { value: Math.random() * 100 },
        uVideoTex:    { value: this.videoTexture },
        uDisplacement:{ value: 0.06 },
        uPulse:       { value: 1.0 },
        uRipple:      { value: 0.0 },
        uRimColor:    { value: new THREE.Color(0x66aaff) },
        uRimStrength: { value: 1.1 },
        uAlpha:       { value: 1.0 },
        uVideoMix:    { value: 0.0 },
        uDissolve:    { value: 0.0 },
      },
      vertexShader:   bubbleVert,
      fragmentShader: bubbleFrag,
      transparent:    true,
      depthWrite:     false,
      side:           THREE.DoubleSide,
    });

    // ── Mesh ─────────────────────────────────────────────────────────────
    const geo  = new THREE.SphereGeometry(RADIUS, 64, 64);
    this.mesh  = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 1;
    this.mesh.userData.bubbleId = memory.id;

    if (memory.position) {
      this.mesh.position.set(...memory.position);
    }

    scene.add(this.mesh);
    this.startIdle();
  }

  // ── Idle animation ───────────────────────────────────────────────────
  private startIdle() {
    const phase  = Math.random() * Math.PI * 2;
    const pulseT = 2.5 + Math.random() * 2;
    const rotT   = 18 + Math.random() * 12;

    this.idleTweens.push(
      gsap.to(this.material.uniforms.uPulse, {
        value: 1.6, duration: pulseT,
        delay: (phase / (Math.PI * 2)) * pulseT,
        repeat: -1, yoyo: true, ease: 'sine.inOut',
      }),
      gsap.to(this.mesh.rotation, {
        y: Math.PI * 2, duration: rotT,
        repeat: -1, ease: 'none',
      }),
      gsap.to(this.mesh.position, {
        y: this.mesh.position.y + 0.18,
        duration: 3 + Math.random() * 2,
        repeat: -1, yoyo: true, ease: 'sine.inOut',
      }),
    );
  }

  setHovered(active: boolean) {
    if (active === this.hoverActive) return;
    this.hoverActive = active;
    gsap.to(this.material.uniforms.uRimStrength, {
      value: active ? 2.2 : 1.1, duration: 0.3,
    });
    gsap.to(this.material.uniforms.uDisplacement, {
      value: active ? 0.10 : 0.06, duration: 0.3,
    });
  }

  // ── Per-frame update ─────────────────────────────────────────────────
  update(delta: number, camPos: THREE.Vector3) {
    this.material.uniforms.uTime.value += delta;
    const dist = this.worldPosition.distanceTo(camPos);

    if (dist < VIDEO_NEAR && !this.videoActive) {
      this.video.play().catch(() => {});
      gsap.to(this.material.uniforms.uVideoMix, { value: 1, duration: 0.6 });
      this.videoActive = true;
    } else if (dist > VIDEO_FAR && this.videoActive) {
      this.video.pause();
      gsap.to(this.material.uniforms.uVideoMix, { value: 0, duration: 0.4 });
      this.videoActive = false;
    }
  }

  // ── Burst helpers (used by Transition) ───────────────────────────────
  get worldPosition(): THREE.Vector3 {
    return this.mesh.getWorldPosition(this._worldPos);
  }

  get radius() { return RADIUS; }
  get enterDistance() { return ENTER_DIST; }

  /** Surface sample positions for particle burst */
  surfaceSamples(count: number): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    const wp = this.worldPosition;
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      pts.push(new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta) * RADIUS + wp.x,
        Math.sin(phi) * Math.sin(theta) * RADIUS + wp.y,
        Math.cos(phi) * RADIUS + wp.z,
      ));
    }
    return pts;
  }

  /** Called by Transition – animate bubble growing to engulf camera */
  engulf(): gsap.core.Timeline {
    const tl = gsap.timeline();
    tl.to(this.material.uniforms.uRipple,       { value: 0.25, duration: 0.7, ease: 'power2.in' }, 0)
      .to(this.mesh.scale, { x: 10, y: 10, z: 10, duration: 0.65, ease: 'power3.in' }, 0.15)
      .to(this.material.uniforms.uDissolve,     { value: 1.0, duration: 0.55, ease: 'power2.out' }, 0.65);
    return tl;
  }

  /** Reverse: condense particles → bubble re-forms */
  reform(): gsap.core.Timeline {
    const tl = gsap.timeline();
    tl.set(this.material.uniforms.uDissolve, { value: 1.0 })
      .set(this.mesh.scale, { x: 10, y: 10, z: 10 })
      .to(this.material.uniforms.uDissolve, { value: 0, duration: 0.4, ease: 'power2.in' }, 0)
      .to(this.mesh.scale, { x: 1, y: 1, z: 1, duration: 0.5, ease: 'back.out(1.5)' }, 0.3)
      .to(this.material.uniforms.uRipple, { value: 0, duration: 0.4 }, 0);
    return tl;
  }

  /** Materialise from nothing – for newly uploaded memories */
  materialize() {
    this.material.uniforms.uAlpha.value = 0;
    this.mesh.scale.setScalar(0.01);
    gsap.to(this.mesh.scale, { x: 1, y: 1, z: 1, duration: 1.0, ease: 'back.out(2)' });
    gsap.to(this.material.uniforms.uAlpha, { value: 1, duration: 0.8 });
  }

  dispose() {
    this.idleTweens.forEach(t => t.kill());
    this.video.pause();
    this.video.src = '';
    this.videoTexture.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.scene.remove(this.mesh);
  }
}
