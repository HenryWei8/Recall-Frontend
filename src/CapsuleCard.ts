import type { Memory } from './types';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
  } catch { return ''; }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isVideo(url: string): boolean {
  return /\.(mp4|webm|mov|ogv|ogg)(\?|$)/i.test(url);
}

export class CapsuleCard {
  readonly element: HTMLElement; // the outer .capsule-wrap
  private video: HTMLVideoElement | null = null;
  private canPlay: boolean;

  constructor(
    readonly memory: Memory,
    private onOpen: (m: Memory) => void,
    private onDelete: (m: Memory) => void,
  ) {
    const date    = memory.createdAt ? formatDate(memory.createdAt) : '';
    const poster  = esc(memory.posterUrl || memory.thumbnailUrl);
    this.canPlay  = isVideo(memory.thumbnailUrl);
    const srcAttr = this.canPlay ? `src="${esc(memory.thumbnailUrl)}"` : '';

    // outer wrap carries the float animation
    const wrap = document.createElement('div');
    wrap.className = 'capsule-wrap';

    const card = document.createElement('div');
    card.className = 'capsule-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Open memory: ${memory.title}`);

    card.innerHTML = `
      <div class="capsule-preview">
        <video ${srcAttr} poster="${poster}" loop muted playsinline preload="none"></video>
        <div class="capsule-hover-layer">
          <span class="capsule-cta">Enter Memory</span>
        </div>
        <button class="capsule-delete" title="Delete memory" aria-label="Delete memory">
          <svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
            <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
          </svg>
        </button>
      </div>
      <div class="capsule-info">
        <div class="capsule-name">${esc(memory.title)}</div>
        <div class="capsule-meta">
          ${date ? `<span class="capsule-date">${date}</span><span class="capsule-sep"></span>` : ''}
          <span class="capsule-tag">3D Memory</span>
        </div>
      </div>
    `;

    this.video = card.querySelector('video');

    // video hover play
    if (this.canPlay) {
      card.addEventListener('mouseenter', () => this.video?.play().catch(() => {}));
      card.addEventListener('mouseleave', () => {
        if (this.video) { this.video.pause(); this.video.currentTime = 0; }
      });
    }

    // open
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.capsule-delete')) return;
      this.onOpen(memory);
    });
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.onOpen(memory); }
    });

    // delete
    const delBtn = card.querySelector('.capsule-delete')!;
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onDelete(memory);
    });

    wrap.appendChild(card);
    this.element = wrap;
  }

  setFloatParams(dy: number, dur: number, del: number, tilt: number) {
    this.element.style.setProperty('--dy',   `${dy}px`);
    this.element.style.setProperty('--dur',  `${dur}s`);
    this.element.style.setProperty('--del',  `${del}s`);
    this.element.style.setProperty('--tilt', `${tilt}deg`);
  }

  dispose() {
    if (this.video) { this.video.pause(); this.video.src = ''; }
    this.element.remove();
  }
}
