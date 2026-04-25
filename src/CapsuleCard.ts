import type { Memory } from './types';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
  } catch {
    return '';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class CapsuleCard {
  readonly element: HTMLElement;
  private video: HTMLVideoElement | null = null;

  constructor(
    readonly memory: Memory,
    private onOpen: (memory: Memory) => void,
  ) {
    this.element = this.build();
  }

  private build(): HTMLElement {
    const card = document.createElement('div');
    card.className = 'capsule-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Open memory: ${this.memory.title}`);

    const date = this.memory.createdAt ? formatDate(this.memory.createdAt) : '';

    const isVideo = /\.(mp4|webm|ogg|mov)(\?|$)/i.test(this.memory.thumbnailUrl);
    card.innerHTML = `
      <div class="capsule-preview">
        <video
          ${isVideo ? `src="${escapeHtml(this.memory.thumbnailUrl)}"` : ''}
          poster="${escapeHtml(this.memory.thumbnailUrl)}"
          loop muted playsinline preload="none"
        ></video>
        <div class="capsule-hover-layer">
          <span class="capsule-cta">Enter Memory</span>
        </div>
      </div>
      <div class="capsule-info">
        <h3 class="capsule-name">${escapeHtml(this.memory.title)}</h3>
        <div class="capsule-meta">
          ${date ? `<span class="capsule-date">${date}</span><span class="capsule-sep"></span>` : ''}
          <span class="capsule-tag">3D</span>
        </div>
      </div>
    `;

    this.video = card.querySelector('video');

    card.addEventListener('mouseenter', () => this.video?.play().catch(() => {}));
    card.addEventListener('mouseleave', () => {
      if (this.video) { this.video.pause(); this.video.currentTime = 0; }
    });

    card.addEventListener('click', () => this.onOpen(this.memory));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.onOpen(this.memory);
      }
    });

    return card;
  }

  dispose() {
    if (this.video) { this.video.pause(); this.video.src = ''; }
    this.element.remove();
  }
}
