import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fetchMemories } from './api/memories';
import { loadCachedMemories, mergeAndCacheNew } from './storage/MemoryCache';
import { loadStaticBundle } from './storage/StaticBundle';
import type { Memory } from './types';

const GLOBE_R      = 2.8;
const ORBIT_MIN    = 4.6;
const ORBIT_MAX    = 5.9;
const SPHERE_R     = 0.26;
const PARTICLE_N   = 1800;
const ROTATE_SPEED = 0.08; // rad/s

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
  } catch { return ''; }
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|ogv|ogg)(\?|$)/i.test(url);
}

/** Equirectangular mini-globe canvas — used as fallback sphere texture */
function makeFallbackTex(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;

  // dark background
  const bg = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  bg.addColorStop(0, '#1a1008');
  bg.addColorStop(1, '#08060c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);

  // lat / lon grid lines
  ctx.strokeStyle = 'rgba(201,169,110,0.22)';
  ctx.lineWidth = 0.7;
  const N = 7;
  for (let i = 1; i < N; i++) {
    const p = (i / N) * S;
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
  }

  // equator highlight
  ctx.strokeStyle = 'rgba(201,169,110,0.45)';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(0, S / 2); ctx.lineTo(S, S / 2); ctx.stroke();

  // centre glow
  const glow = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2.8);
  glow.addColorStop(0, 'rgba(201,169,110,0.18)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, S, S);

  return new THREE.CanvasTexture(c);
}

/** Canvas texture for the "RECALL" sprite inside the globe */
function makeRecallTex(): THREE.CanvasTexture {
  const W = 640, H = 112;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);

  ctx.save();
  ctx.font = '100 78px -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // letter-spacing via individual chars
  const letters = 'RECALL'.split('');
  const spacing = 18;
  const totalWidth = letters.length * 52 + (letters.length - 1) * spacing;
  let x = (W - totalWidth) / 2 + 26;
  for (const ch of letters) {
    // white glow
    ctx.shadowColor  = 'rgba(255,255,255,0.45)';
    ctx.shadowBlur   = 10;
    ctx.strokeStyle  = 'rgba(255,255,255,0.82)';
    ctx.lineWidth    = 0.9;
    ctx.strokeText(ch, x, H / 2);
    x += 52 + spacing;
  }
  ctx.restore();

  return new THREE.CanvasTexture(c);
}

interface MemOrbit {
  memory  : Memory;
  sphere  : THREE.Mesh;
  halo    : THREE.Mesh;
  angle   : number;
  speed   : number;
  radius  : number;
  u       : THREE.Vector3;
  v       : THREE.Vector3;
}

export class GlobeScene {
  private renderer   : THREE.WebGLRenderer;
  private scene      = new THREE.Scene();
  private camera     : THREE.PerspectiveCamera;
  private controls   : OrbitControls;
  private clock      = new THREE.Clock();
  private sceneGroup = new THREE.Group();

  private orbits    : MemOrbit[] = [];
  private connLines : THREE.LineSegments | null = null;
  private raycaster  = new THREE.Raycaster();
  private pointer    = new THREE.Vector2(-9999, -9999);
  private hovered    : MemOrbit | null = null;
  private mouseOverTooltip = false;
  private chamberPaused    = false;

  private tooltip   : HTMLElement;
  private ttThumb   : HTMLImageElement;
  private ttTitleEl : HTMLElement;
  private ttDateEl  : HTMLElement;
  private emptyState: HTMLElement | null = null;
  private animFrame : number | null = null;
  private canvas    : HTMLCanvasElement;
  private ptrDownAt = { x: 0, y: 0 };

  constructor(
    private onOpen  : (m: Memory) => void,
    private onDelete: (m: Memory) => void,
    private onRename: (m: Memory, title: string) => void,
  ) {
    this.canvas = document.getElementById('globe-canvas') as HTMLCanvasElement;

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x07060e, 1);

    this.camera = new THREE.PerspectiveCamera(
      50, window.innerWidth / window.innerHeight, 0.1, 200,
    );
    this.camera.position.set(0, 2, 11);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.04;
    this.controls.enablePan    = false;
    this.controls.minDistance  = 5;
    this.controls.maxDistance  = 22;

    this.scene.add(this.sceneGroup);
    this.sceneGroup.add(this.buildGlobe());
    this.sceneGroup.add(this.buildParticles());
    this.sceneGroup.add(this.buildRecallLabel());

    this.tooltip   = document.getElementById('globe-tooltip')!;
    this.ttThumb   = document.getElementById('tt-thumb')! as HTMLImageElement;
    this.ttTitleEl = document.getElementById('tt-title')!;
    this.ttDateEl  = document.getElementById('tt-date')!;

    this.tooltip.addEventListener('mouseenter', () => { this.mouseOverTooltip = true; });
    this.tooltip.addEventListener('mouseleave', () => { this.mouseOverTooltip = false; });

    document.getElementById('tt-delete')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.hovered) { this.onDelete(this.hovered.memory); this.hideTooltip(); this.hovered = null; }
    });
    document.getElementById('tt-enter')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.hovered) this.onOpen(this.hovered.memory);
    });
    document.getElementById('tt-rename-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.hovered) this.startRename(this.hovered);
    });

    document.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerdown', (e) => { this.ptrDownAt = { x: e.clientX, y: e.clientY }; });
    this.canvas.addEventListener('pointerup', this.onClick);
    window.addEventListener('resize', this.onResize);

    this.loop();
  }

  // ── Scene construction ───────────────────────────────────────

  private buildGlobe(): THREE.LineSegments {
    const geo  = new THREE.SphereGeometry(GLOBE_R, 30, 20);
    const wire = new THREE.WireframeGeometry(geo);
    return new THREE.LineSegments(wire, new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.17,
    }));
  }

  private buildParticles(): THREE.Points {
    const pos = new Float32Array(PARTICLE_N * 3);
    for (let i = 0; i < PARTICLE_N; i++) {
      const phi   = Math.acos(2 * Math.random() - 1);
      const theta = Math.random() * Math.PI * 2;
      const r     = GLOBE_R + 0.6 + Math.pow(Math.random(), 0.6) * 6.2;
      pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const pc = document.createElement('canvas');
    pc.width = pc.height = 64;
    const pctx = pc.getContext('2d')!;
    const grad = pctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0,   'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1,   'rgba(255,255,255,0)');
    pctx.fillStyle = grad;
    pctx.fillRect(0, 0, 64, 64);

    return new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x7dd8cc, size: 0.1, sizeAttenuation: true,
      map: new THREE.CanvasTexture(pc),
      transparent: true, alphaTest: 0.01,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
  }

  private buildRecallLabel(): THREE.Sprite {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeRecallTex(),
      transparent: true,
      depthWrite: false,
      depthTest: false,
    }));
    // scale to fit nicely inside the globe (GLOBE_R = 2.8)
    sprite.scale.set(5.2, 0.91, 1);
    return sprite;
  }

  // ── Memory sphere ────────────────────────────────────────────

  private makeOrbit(memory: Memory): MemOrbit {
    const inclination = (Math.random() - 0.5) * (Math.PI / 2);
    const ascending   = Math.random() * Math.PI * 2;
    const u = new THREE.Vector3(Math.cos(ascending), 0, Math.sin(ascending));
    const v = new THREE.Vector3(
      -Math.sin(ascending) * Math.cos(inclination),
       Math.sin(inclination),
       Math.cos(ascending)  * Math.cos(inclination),
    );

    // Sphere with fallback mini-globe texture
    const fallback = makeFallbackTex();
    const mat = new THREE.MeshBasicMaterial({ map: fallback });
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(SPHERE_R, 24, 16),
      mat,
    );

    // Async thumbnail load
    const imgUrl = memory.posterUrl && !isVideoUrl(memory.posterUrl)
      ? memory.posterUrl
      : (!isVideoUrl(memory.thumbnailUrl) ? memory.thumbnailUrl : '');
    if (imgUrl) {
      new THREE.TextureLoader().load(
        imgUrl,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          mat.map = tex;
          mat.needsUpdate = true;
          fallback.dispose();
        },
        undefined,
        () => { /* keep fallback */ },
      );
    }

    // Glow halo
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(SPHERE_R * 2.4, 8, 6),
      new THREE.MeshBasicMaterial({
        color: 0xc9a96e, transparent: true, opacity: 0.1,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    sphere.add(halo);

    // Hover ring
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(SPHERE_R * 1.55, 0.014, 6, 36),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        depthWrite: false,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    sphere.add(ring);

    this.sceneGroup.add(sphere);

    const orbit: MemOrbit = {
      memory, sphere, halo,
      angle:  Math.random() * Math.PI * 2,
      speed:  (0.14 + Math.random() * 0.22) * (Math.random() < 0.5 ? 1 : -1),
      radius: ORBIT_MIN + Math.random() * (ORBIT_MAX - ORBIT_MIN),
      u, v,
    };
    this.setSpherePos(orbit);
    return orbit;
  }

  private setSpherePos(o: MemOrbit) {
    const c = Math.cos(o.angle), s = Math.sin(o.angle);
    o.sphere.position.set(
      o.radius * (c * o.u.x + s * o.v.x),
      o.radius * (c * o.u.y + s * o.v.y),
      o.radius * (c * o.u.z + s * o.v.z),
    );
  }

  // ── Location connection lines ────────────────────────────────

  /** Rebuild the LineSegments geometry whenever the orbit list changes. */
  private rebuildConnLines() {
    if (this.connLines) {
      this.sceneGroup.remove(this.connLines);
      this.connLines.geometry.dispose();
      (this.connLines.material as THREE.Material).dispose();
      this.connLines = null;
    }

    // Group orbits by normalised location string
    const groups = new Map<string, MemOrbit[]>();
    for (const o of this.orbits) {
      const loc = o.memory.location?.trim().toLowerCase();
      if (!loc) continue;
      if (!groups.has(loc)) groups.set(loc, []);
      groups.get(loc)!.push(o);
    }

    // Count segments needed (chain: n members → n-1 segments)
    let segCount = 0;
    for (const g of groups.values()) if (g.length >= 2) segCount += g.length - 1;
    if (segCount === 0) return;

    const pos = new Float32Array(segCount * 2 * 3); // 2 endpoints × 3 floats
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    this.connLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: 0x7dd8cc,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    this.sceneGroup.add(this.connLines);
  }

  /** Refresh line endpoint positions every frame (spheres are moving). */
  private updateConnLines() {
    if (!this.connLines) return;
    const attr = this.connLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr  = attr.array as Float32Array;

    const groups = new Map<string, MemOrbit[]>();
    for (const o of this.orbits) {
      const loc = o.memory.location?.trim().toLowerCase();
      if (!loc) continue;
      if (!groups.has(loc)) groups.set(loc, []);
      groups.get(loc)!.push(o);
    }

    let i = 0;
    for (const g of groups.values()) {
      for (let j = 0; j < g.length - 1; j++) {
        const a = g[j].sphere.position;
        const b = g[j + 1].sphere.position;
        arr[i++] = a.x; arr[i++] = a.y; arr[i++] = a.z;
        arr[i++] = b.x; arr[i++] = b.y; arr[i++] = b.z;
      }
    }
    attr.needsUpdate = true;
  }

  // ── Render loop ──────────────────────────────────────────────

  private loop = () => {
    this.animFrame = requestAnimationFrame(this.loop);
    const dt = this.clock.getDelta();

    if (!this.chamberPaused) {
      // Globe always rotates
      this.sceneGroup.rotation.y += ROTATE_SPEED * dt;

      for (const o of this.orbits) {
        const isHovered = o === this.hovered;

        // Advance orbit unless THIS specific sphere is hovered
        if (!isHovered) {
          o.angle += o.speed * dt;
          this.setSpherePos(o);
        }

        // Smooth scale in/out
        const targetScale = isHovered ? 1.28 : 1.0;
        const s = o.sphere.scale.x + (targetScale - o.sphere.scale.x) * 0.12;
        o.sphere.scale.setScalar(s);

        // Halo brightness
        const haloMat = o.halo.material as THREE.MeshBasicMaterial;
        const targetOpacity = isHovered ? 0.38 : 0.1;
        haloMat.opacity += (targetOpacity - haloMat.opacity) * 0.1;

        // Hover ring fade
        const ring = o.sphere.children[1] as THREE.Mesh;
        if (ring) {
          const ringMat = ring.material as THREE.MeshBasicMaterial;
          const targetRing = isHovered ? 0.55 : 0;
          ringMat.opacity += (targetRing - ringMat.opacity) * 0.1;
        }
      }
    }

    this.updateConnLines();
    this.controls.update();

    // Raycast hover detection (skip when mouse is over tooltip HTML)
    if (!this.mouseOverTooltip) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.orbits.map(o => o.sphere), true);

      let newHovered: MemOrbit | null = null;
      if (hits.length > 0) {
        const obj = hits[0].object;
        newHovered = this.orbits.find(o => o.sphere === obj || o.sphere === obj.parent) ?? null;
      }

      if (newHovered !== this.hovered) {
        if (!newHovered) this.hideTooltip();
        else             this.showTooltip(newHovered);
        this.hovered = newHovered;
        this.canvas.style.cursor = newHovered ? 'pointer' : 'default';
      }
    }

    if (this.hovered) this.positionTooltip(this.hovered);

    this.renderer.render(this.scene, this.camera);
  };

  // ── Tooltip ──────────────────────────────────────────────────

  private showTooltip(o: MemOrbit) {
    this.ttThumb.src = o.memory.posterUrl || o.memory.thumbnailUrl;
    this.ttTitleEl.textContent = o.memory.title;
    this.ttDateEl.textContent  = o.memory.createdAt ? formatDate(o.memory.createdAt) : '';
    this.tooltip.classList.add('visible');
    this.positionTooltip(o);
  }

  private hideTooltip() {
    this.tooltip.classList.remove('visible');
  }

  private positionTooltip(o: MemOrbit) {
    const wp = new THREE.Vector3();
    o.sphere.getWorldPosition(wp);
    const ndc = wp.clone().project(this.camera);
    this.tooltip.style.left = `${(ndc.x  + 1) / 2 * window.innerWidth}px`;
    this.tooltip.style.top  = `${(-ndc.y + 1) / 2 * window.innerHeight}px`;
  }

  private startRename(o: MemOrbit) {
    const titleEl = document.getElementById('tt-title')!;
    const input   = document.createElement('input');
    input.className = 'tt-rename-input';
    input.value     = o.memory.title;
    input.maxLength = 80;
    titleEl.replaceWith(input);
    input.focus(); input.select();

    const commit = (save: boolean) => {
      const val = input.value.trim();
      const span = document.createElement('span');
      span.id = 'tt-title'; span.className = 'tt-title';
      input.replaceWith(span);
      this.ttTitleEl = span;
      if (save && val && val !== o.memory.title) {
        span.textContent = val;
        this.onRename(o.memory, val);
      } else {
        span.textContent = o.memory.title;
      }
    };
    input.addEventListener('blur',    () => commit(true));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { commit(false); input.blur(); }
    });
  }

  // ── Events ───────────────────────────────────────────────────

  private onPointerMove = (e: PointerEvent) => {
    this.pointer.x =  (e.clientX / window.innerWidth)  * 2 - 1;
    this.pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  };

  private onClick = (e: PointerEvent) => {
    const d = Math.hypot(e.clientX - this.ptrDownAt.x, e.clientY - this.ptrDownAt.y);
    if (d < 5 && this.hovered) this.onOpen(this.hovered.memory);
  };

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  // ── Public API ───────────────────────────────────────────────

  async loadMemories(): Promise<void> {
    const cached = await loadCachedMemories();
    if (cached.length > 0) this.renderOrbits(cached);

    try {
      const remote = await fetchMemories();
      const fresh  = mergeAndCacheNew(remote);
      if (cached.length === 0) {
        this.renderOrbits(remote);
      } else {
        for (const m of fresh) this.addCard(m);
      }
    } catch {
      if (cached.length === 0) {
        // GX10 offline and OPFS empty — fall back to repo-bundled memories
        const bundled = await loadStaticBundle();
        if (bundled.length > 0) this.renderOrbits(bundled);
        else                    this.showEmpty();
      }
    }
  }

  private renderOrbits(memories: Memory[]) {
    for (const o of this.orbits) {
      this.sceneGroup.remove(o.sphere);
      o.sphere.traverse(obj => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
    }
    this.orbits = [];
    this.emptyState?.remove();
    this.emptyState = null;

    if (memories.length === 0) { this.showEmpty(); return; }
    for (const m of memories) this.orbits.push(this.makeOrbit(m));
    this.rebuildConnLines();
  }

  addCard(memory: Memory) {
    this.emptyState?.remove();
    this.emptyState = null;
    this.orbits.push(this.makeOrbit(memory));
    this.rebuildConnLines();
  }

  removeCard(id: string) {
    const idx = this.orbits.findIndex(o => o.memory.id === id);
    if (idx === -1) return;
    const o = this.orbits[idx];
    if (this.hovered === o) { this.hideTooltip(); this.hovered = null; }
    this.sceneGroup.remove(o.sphere);
    o.sphere.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    this.orbits.splice(idx, 1);
    this.rebuildConnLines();
    if (this.orbits.length === 0) this.showEmpty();
  }

  private showEmpty() {
    if (this.emptyState) return;
    const el = document.createElement('div');
    el.id = 'globe-empty';
    el.className = 'globe-empty';
    el.innerHTML = `
      <h2>Every place holds a story</h2>
      <p>Store your first memory and carry it with you — preserved in 3D, forever.</p>
      <button class="empty-cta" id="empty-add-btn">Begin remembering →</button>
    `;
    el.querySelector('#empty-add-btn')?.addEventListener('click', () => {
      document.getElementById('drawer-toggle')?.click();
    });
    document.getElementById('app')?.appendChild(el);
    this.emptyState = el;
  }

  pause() {
    this.chamberPaused = true;
    if (this.animFrame !== null) { cancelAnimationFrame(this.animFrame); this.animFrame = null; }
    this.hideTooltip();
  }

  resume() {
    this.chamberPaused = false;
    this.clock.getDelta();
    this.loop();
  }

  dispose() {
    if (this.animFrame !== null) cancelAnimationFrame(this.animFrame);
    document.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
