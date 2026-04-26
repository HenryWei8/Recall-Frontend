import * as THREE from 'three';
import { Gallery } from './Gallery';
import { Chamber } from './Chamber';
import { Drawer }  from './Drawer';
import { cacheMemory, deleteCachedMemory, renameCachedMemory } from './storage/MemoryCache';
import { renameMemory } from './api/memories';
import { Background } from './Background';
import type { Memory } from './types';

type AppState = 'gallery' | 'transitioning' | 'chamber';

export class App {
  private renderer : THREE.WebGLRenderer;
  private clock    = new THREE.Clock();
  private gallery  : Gallery;
  private chamber  : Chamber;
  private state    : AppState = 'gallery';
  private animFrame: number | null = null;

  // chamber UI elements
  private chamberOverlay  : HTMLElement;
  private chamberLoading  : HTMLElement;
  private camTitleText    : HTMLElement;
  private camPinnedBadge  : HTMLElement;
  private camDownload     : HTMLAnchorElement;
  private cpX: HTMLElement; private cpY: HTMLElement; private cpZ: HTMLElement;
  private ctX: HTMLElement; private ctY: HTMLElement; private ctZ: HTMLElement;


  constructor() {
    const canvas = document.getElementById('chamber-canvas') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.chamberOverlay = document.getElementById('chamber-overlay')!;
    this.chamberLoading = document.getElementById('chamber-loading')!;
    this.camTitleText   = document.getElementById('chamber-title-text')!;
    this.camPinnedBadge = document.getElementById('cam-pinned-badge')!;
    this.camDownload    = document.getElementById('cam-download')! as HTMLAnchorElement;
    this.cpX = document.getElementById('cp-x')!;
    this.cpY = document.getElementById('cp-y')!;
    this.cpZ = document.getElementById('cp-z')!;
    this.ctX = document.getElementById('ct-x')!;
    this.ctY = document.getElementById('ct-y')!;
    this.ctZ = document.getElementById('ct-z')!;

    new Background();

    this.chamber = new Chamber(this.renderer);
    this.gallery = new Gallery(
      (mem)        => this.enterChamber(mem),
      (mem)        => this.deleteMemory(mem),
      (mem, title) => this.renameMemory(mem, title),
    );

    new Drawer((mem) => {
      this.gallery.addCard(mem);
      cacheMemory(mem); // fire-and-forget: download PLY + thumbnail to OPFS
    });

    document.getElementById('chamber-back')!
      .addEventListener('click', () => this.exitChamber());

    document.getElementById('cam-pin')!
      .addEventListener('click', () => this.pinView());

    document.getElementById('cam-reset')!
      .addEventListener('click', () => this.resetView());

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
    const delta = this.clock.getDelta();
    this.chamber.update(delta);
    this.chamber.render();
    this.updateCoordsDisplay();
  }

  private updateCoordsDisplay() {
    const c = this.chamber.getCoords();
    this.cpX.textContent = c.px.toFixed(2);
    this.cpY.textContent = c.py.toFixed(2);
    this.cpZ.textContent = c.pz.toFixed(2);
    this.ctX.textContent = c.tx.toFixed(2);
    this.ctY.textContent = c.ty.toFixed(2);
    this.ctZ.textContent = c.tz.toFixed(2);
  }

  private pinView() {
    this.chamber.pinView();
    this.camPinnedBadge.textContent = '✓ View pinned';
    setTimeout(() => { this.camPinnedBadge.textContent = ''; }, 2000);
  }

  private resetView() {
    if (this.chamber.hasPinnedView()) {
      // go back to pinned view (not hard-coded default)
      const id = (this.chamber as any).currentId as string | null;
      if (id) this.chamber.loadView(id);
    } else {
      this.chamber.resetToDefault();
    }
  }

  private async enterChamber(memory: Memory) {
    if (this.state !== 'gallery') return;
    this.state = 'transitioning';

    this.camTitleText.textContent   = memory.title;
    this.camPinnedBadge.textContent = this.hasPinFor(memory.id) ? '📍 Pinned view loaded' : '';
    this.camDownload.href           = memory.plyUrl;
    this.camDownload.download       = `${memory.title}.ply`;
    this.chamberLoading.style.display = 'flex';
    this.chamberOverlay.classList.add('visible');

    await this.chamber.enter(memory);

    this.chamberLoading.style.display = 'none';
    this.state = 'chamber';
    this.clock.getDelta();
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

  private async renameMemory(memory: Memory, title: string) {
    renameCachedMemory(memory.id, title);
    renameMemory(memory.id, title); // fire-and-forget to GX10
  }

  private async deleteMemory(memory: Memory) {
    try {
      await fetch(`/api/memories/${memory.id}`, { method: 'DELETE' });
    } catch { /* ignore — still remove locally */ }
    this.gallery.removeCard(memory.id);
    localStorage.removeItem(`recall_view_${memory.id}`);
    deleteCachedMemory(memory.id); // remove from OPFS + metadata
  }

  private hasPinFor(id: string): boolean {
    return localStorage.getItem(`recall_view_${id}`) != null;
  }
}
