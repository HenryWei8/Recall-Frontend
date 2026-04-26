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
  readonly element: HTMLElement;
  private video: HTMLVideoElement | null = null;
  private canPlay: boolean;
  private nameEl!: HTMLElement;
  private _title: string;

  constructor(
    readonly memory: Memory,
    private onOpen  : (m: Memory) => void,
    private onDelete: (m: Memory) => void,
    private onRename: (m: Memory, title: string) => void,
  ) {
    const date    = memory.createdAt ? formatDate(memory.createdAt) : '';
    const poster  = esc(memory.posterUrl || memory.thumbnailUrl);
    this.canPlay  = isVideo(memory.thumbnailUrl);
    const srcAttr = this.canPlay ? `src="${esc(memory.thumbnailUrl)}"` : '';

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
        <button class="capsule-delete" title="Delete" aria-label="Delete memory">
          <svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
            <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
          </svg>
        </button>
      </div>
      <div class="capsule-info">
        <div class="capsule-name-row">
          <div class="capsule-name">${esc(memory.title)}</div>
          <button class="capsule-rename-btn" title="Rename" aria-label="Rename memory">
            <svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M8.5 1.5l2 2L4 10H2v-2L8.5 1.5z"/>
            </svg>
          </button>
        </div>
        <div class="capsule-meta">
          ${date ? `<span class="capsule-date">${date}</span><span class="capsule-sep"></span>` : ''}
          <span class="capsule-tag">3D Memory</span>
        </div>
      </div>
    `;

    this._title = memory.title;
    this.video  = card.querySelector('video');
    this.nameEl = card.querySelector('.capsule-name')!;

    if (this.canPlay) {
      card.addEventListener('mouseenter', () => this.video?.play().catch(() => {}));
      card.addEventListener('mouseleave', () => {
        if (this.video) { this.video.pause(); this.video.currentTime = 0; }
      });
    }

    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.capsule-delete, .capsule-rename-btn')) return;
      this.onOpen(memory);
    });
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.onOpen(memory); }
    });

    card.querySelector('.capsule-delete')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onDelete(memory);
    });

    card.querySelector('.capsule-rename-btn')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.startRename(card);
    });

    wrap.appendChild(card);
    this.element = wrap;
  }

  private startRename(card: HTMLElement) {
    const renBtn = card.querySelector('.capsule-rename-btn') as HTMLElement;

    const input = document.createElement('input');
    input.className = 'capsule-rename-input';
    input.value     = this.memory.title;
    input.maxLength = 80;

    this.nameEl.replaceWith(input);
    renBtn.style.opacity = '0';
    input.focus();
    input.select();

    const commit = (save: boolean) => {
      const newTitle = input.value.trim();
      input.replaceWith(this.nameEl);
      renBtn.style.opacity = '';
      if (save && newTitle && newTitle !== this._title) {
        this._title = newTitle;
        this.nameEl.textContent = newTitle;
        this.onRename(this.memory, newTitle);
      }
    };

    input.addEventListener('blur', () => commit(true));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); commit(true);  input.blur(); }
      if (e.key === 'Escape') { commit(false); input.blur(); }
    });
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
