import * as THREE from 'three';
import { Bubble } from './Bubble';
import { ParticleSystem } from './ParticleSystem';

const PARTICLE_COUNT = 600;

export class Transition {
  private particles: ParticleSystem;

  constructor(scene: THREE.Scene) {
    this.particles = new ParticleSystem(scene, {
      count:    PARTICLE_COUNT,
      color:    new THREE.Color(0x88ccff),
      size:     2.2,
      lifetime: 3.5,
      gravity:  -0.15,
    });
  }

  /**
   * Gallery → Chamber: bubble engulfs the camera.
   * Returns a Promise that resolves when the screen is fully black (safe to switch scene).
   */
  enterBubble(bubble: Bubble, onMidpoint: () => void): Promise<void> {
    return new Promise(resolve => {
      // Particle burst from bubble surface
      const samples = bubble.surfaceSamples(PARTICLE_COUNT);
      this.particles.setColor(new THREE.Color(0x88ccff));
      this.particles.burst(samples, bubble.worldPosition);

      // Engulf timeline
      const tl = bubble.engulf();

      // At midpoint (just before dissolve completes), hand off
      tl.call(() => { onMidpoint(); }, undefined, 0.6);

      tl.call(() => { resolve(); });
    });
  }

  /**
   * Chamber → Gallery: fast dissolve-out then bubble reforms.
   * Call after the scene is already back to gallery.
   */
  exitBubble(bubble: Bubble) {
    return bubble.reform();
  }

  /** Fade the entire canvas to black (for hard-cut transitions) */
  fadeToBlack(duration = 0.3): Promise<void> {
    return new Promise(resolve => {
      const div = document.createElement('div');
      Object.assign(div.style, {
        position: 'fixed', inset: '0',
        background: '#000', opacity: '0',
        zIndex: '200', pointerEvents: 'none',
        transition: `opacity ${duration}s ease`,
      });
      document.body.appendChild(div);
      requestAnimationFrame(() => { div.style.opacity = '1'; });
      setTimeout(() => {
        document.body.removeChild(div);
        resolve();
      }, duration * 1000 + 50);
    });
  }

  fadeFromBlack(duration = 0.35): Promise<void> {
    return new Promise(resolve => {
      const div = document.createElement('div');
      Object.assign(div.style, {
        position: 'fixed', inset: '0',
        background: '#000', opacity: '1',
        zIndex: '200', pointerEvents: 'none',
        transition: `opacity ${duration}s ease`,
      });
      document.body.appendChild(div);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { div.style.opacity = '0'; });
      });
      setTimeout(() => {
        document.body.removeChild(div);
        resolve();
      }, duration * 1000 + 50);
    });
  }

  dispose() { this.particles.dispose(); }
}
