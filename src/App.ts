import * as THREE from 'three';
import { Gallery } from './Gallery';
import { Chamber } from './Chamber';
import { Drawer }  from './Drawer';
import type { Memory } from './types';

type AppState = 'gallery' | 'transitioning' | 'chamber';

export class App {
  private renderer:  THREE.WebGLRenderer;
  private clock    = new THREE.Clock();
  private gallery  : Gallery;
  private chamber  : Chamber;
  private state    : AppState = 'gallery';
  private animFrame: number | null = null;

  private chamberOverlay   : HTMLElement;
  private chamberTitleText : HTMLElement;
  private chamberLoading   : HTMLElement;

  constructor() {
    const canvas = document.getElementById('chamber-canvas') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping      = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.chamberOverlay   = document.getElementById('chamber-overlay')!;
    this.chamberTitleText = document.getElementById('chamber-title-text')!;
    this.chamberLoading   = document.getElementById('chamber-loading')!;

    this.chamber = new Chamber(this.renderer);
    this.gallery = new Gallery((mem) => this.enterChamber(mem));

    new Drawer((mem) => this.gallery.addCard(mem));

    document.getElementById('chamber-back')!
      .addEventListener('click', () => this.exitChamber());

    document.addEventListener('keydown', e => {
      if (e.code === 'Escape' && this.state === 'chamber') this.exitChamber();
    });

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    this.gallery.loadMemories();
  }

  private loop() {
    if (this.state !== 'chamber') return;
    this.animFrame = requestAnimationFrame(() => this.loop());
    this.chamber.update(this.clock.getDelta());
    this.chamber.render();
  }

  private async enterChamber(memory: Memory) {
    if (this.state !== 'gallery') return;
    this.state = 'transitioning';

    this.chamberTitleText.textContent = memory.title;
    this.chamberLoading.style.display = 'flex';
    this.chamberOverlay.classList.add('visible');

    await this.chamber.enter(memory);

    this.chamberLoading.style.display = 'none';
    this.state = 'chamber';
    this.clock.getDelta(); // reset delta so first frame isn't huge
    this.loop();
  }

  private exitChamber() {
    if (this.state !== 'chamber') return;
    this.state = 'gallery';

    if (this.animFrame !== null) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }

    this.chamber.exit();
    this.chamberOverlay.classList.remove('visible');
  }
}
