import * as THREE from 'three';
import particleVert from './shaders/particle.vert.glsl?raw';
import particleFrag from './shaders/particle.frag.glsl?raw';

export interface ParticleConfig {
  count: number;
  color: THREE.Color;
  size: number;
  lifetime: number;
  gravity: number;
}

const DEFAULT_CONFIG: ParticleConfig = {
  count:    600,
  color:    new THREE.Color(0x88ccff),
  size:     2.5,
  lifetime: 4.0,
  gravity:  -0.3,
};

export class ParticleSystem {
  private points:    THREE.Points;
  private positions: Float32Array;
  private velocities: Float32Array;
  private lives:     Float32Array;
  private maxLives:  Float32Array;
  private cfg:       ParticleConfig;
  private time = 0;

  // Ambient drift mode
  private ambientBounds: THREE.Box3 | null = null;

  constructor(private scene: THREE.Scene, cfg: Partial<ParticleConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
    const n = this.cfg.count;

    this.positions  = new Float32Array(n * 3);
    this.velocities = new Float32Array(n * 3);
    this.lives      = new Float32Array(n);
    this.maxLives   = new Float32Array(n);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aLife',    new THREE.BufferAttribute(this.lives, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: this.cfg.color },
        uSize:  { value: this.cfg.size },
        uTime:  { value: 0 },
      },
      vertexShader:   particleVert,
      fragmentShader: particleFrag,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, mat);
    scene.add(this.points);

    // Start all particles as dead
    for (let i = 0; i < n; i++) {
      this.lives[i] = 1.0;
      this.maxLives[i] = this.cfg.lifetime;
    }
  }

  setColor(c: THREE.Color) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uColor.value = c;
  }

  /** Spawn burst: particles ejected from surface positions toward outside */
  burst(surfacePositions: THREE.Vector3[], origin: THREE.Vector3) {
    const n = Math.min(surfacePositions.length, this.cfg.count);
    for (let i = 0; i < n; i++) {
      const p = surfacePositions[i];
      this.positions[i*3+0] = p.x;
      this.positions[i*3+1] = p.y;
      this.positions[i*3+2] = p.z;

      const dir = p.clone().sub(origin).normalize();
      const speed = 1.5 + Math.random() * 3.5;
      this.velocities[i*3+0] = dir.x * speed + (Math.random()-.5) * 0.8;
      this.velocities[i*3+1] = dir.y * speed + (Math.random()-.5) * 0.8 + 0.5;
      this.velocities[i*3+2] = dir.z * speed + (Math.random()-.5) * 0.8;

      this.lives[i]    = 0;
      this.maxLives[i] = this.cfg.lifetime * (0.6 + Math.random() * 0.8);
    }
    // reset remaining
    for (let i = n; i < this.cfg.count; i++) this.lives[i] = 1.0;
    this.points.geometry.getAttribute('position').needsUpdate = true;
    this.points.geometry.getAttribute('aLife').needsUpdate    = true;
  }

  /** Ambient drift: scatter in bounds, slowly float */
  setAmbientMode(bounds: THREE.Box3) {
    this.ambientBounds = bounds;
    const size = bounds.getSize(new THREE.Vector3());
    for (let i = 0; i < this.cfg.count; i++) {
      const p = new THREE.Vector3(
        bounds.min.x + Math.random() * size.x,
        bounds.min.y + Math.random() * size.y,
        bounds.min.z + Math.random() * size.z,
      );
      this.positions[i*3+0] = p.x;
      this.positions[i*3+1] = p.y;
      this.positions[i*3+2] = p.z;
      this.velocities[i*3+0] = (Math.random()-.5) * 0.2;
      this.velocities[i*3+1] =  Math.random()      * 0.15;
      this.velocities[i*3+2] = (Math.random()-.5) * 0.2;
      this.lives[i]    = Math.random();
      this.maxLives[i] = this.cfg.lifetime * (0.5 + Math.random());
    }
    this.points.geometry.getAttribute('position').needsUpdate = true;
    this.points.geometry.getAttribute('aLife').needsUpdate    = true;
  }

  update(delta: number) {
    this.time += delta;
    (this.points.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;

    const n = this.cfg.count;
    const posAttr  = this.points.geometry.getAttribute('position');
    const lifeAttr = this.points.geometry.getAttribute('aLife');

    for (let i = 0; i < n; i++) {
      if (this.lives[i] >= 1.0) {
        if (this.ambientBounds) this.respawnAmbient(i);
        continue;
      }

      this.lives[i] += delta / this.maxLives[i];

      this.velocities[i*3+1] += this.cfg.gravity * delta;
      this.positions[i*3+0]  += this.velocities[i*3+0] * delta;
      this.positions[i*3+1]  += this.velocities[i*3+1] * delta;
      this.positions[i*3+2]  += this.velocities[i*3+2] * delta;

      posAttr.setXYZ(i, this.positions[i*3], this.positions[i*3+1], this.positions[i*3+2]);
      lifeAttr.setX(i, this.lives[i]);
    }

    posAttr.needsUpdate  = true;
    lifeAttr.needsUpdate = true;
  }

  private respawnAmbient(i: number) {
    const b    = this.ambientBounds!;
    const size = b.getSize(new THREE.Vector3());
    this.positions[i*3+0] = b.min.x + Math.random() * size.x;
    this.positions[i*3+1] = b.min.y;
    this.positions[i*3+2] = b.min.z + Math.random() * size.z;
    this.velocities[i*3+0] = (Math.random()-.5) * 0.2;
    this.velocities[i*3+1] =  Math.random() * 0.2;
    this.velocities[i*3+2] = (Math.random()-.5) * 0.2;
    this.lives[i]    = 0;
    this.maxLives[i] = this.cfg.lifetime * (0.5 + Math.random());
  }

  get object3d() { return this.points; }

  dispose() {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
