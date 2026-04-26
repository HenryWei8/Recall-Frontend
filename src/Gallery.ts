import { CapsuleCard } from './CapsuleCard';
import { fetchMemories } from './api/memories';
import { loadCachedMemories, mergeAndCacheNew } from './storage/MemoryCache';
import type { Memory } from './types';

export class Gallery {
  private space: HTMLElement;
  private cards: CapsuleCard[] = [];

  constructor(
    private onOpen  : (m: Memory) => void,
    private onDelete: (m: Memory) => void,
    private onRename: (m: Memory, title: string) => void,
  ) {
    this.space = document.getElementById('gallery-space')!;
  }

  /**
   * Load memories in two passes:
   * 1. Immediately render the local OPFS cache (works offline).
   * 2. Fetch from GX10, add any new ones to the gallery + cache them.
   */
  async loadMemories(): Promise<void> {
    // Pass 1 — local cache (instant, no network needed)
    const cached = await loadCachedMemories();
    if (cached.length > 0) {
      this.renderCards(cached);
    }

    // Pass 2 — try GX10
    try {
      const remote = await fetchMemories();
      const fresh  = mergeAndCacheNew(remote);          // new ones not yet cached

      if (cached.length === 0) {
        // Nothing local yet — render everything from GX10
        this.renderCards(remote);
      } else {
        // Prepend any memories GX10 has that local cache doesn't
        for (const mem of fresh) this.insertCard(mem, 0);
      }
    } catch {
      // GX10 offline — cached memories are already shown, nothing to do
      if (cached.length === 0) this.showEmpty();
    }
  }

  private renderCards(memories: Memory[]) {
    this.space.innerHTML = '';
    this.cards.forEach(c => c.dispose());
    this.cards = [];

    if (memories.length === 0) { this.showEmpty(); return; }
    memories.forEach((m, i) => {
      const card = this.makeCard(m);
      card.element.querySelector<HTMLElement>('.capsule-card')!.style.animationDelay = `${i * 55}ms`;
      this.space.appendChild(card.element);
      this.cards.push(card);
    });
  }

  private makeCard(mem: Memory): CapsuleCard {
    const card = new CapsuleCard(mem, this.onOpen, this.onDelete, this.onRename);
    card.setFloatParams(
      8  + Math.random() * 9,
      7  + Math.random() * 6,
      -Math.random() * 12,
      (Math.random() - 0.5) * 1.2,
    );
    return card;
  }

  private insertCard(mem: Memory, atIndex: number) {
    const card = this.makeCard(mem);
    if (atIndex === 0) {
      this.space.prepend(card.element);
      this.cards.unshift(card);
    } else {
      this.space.appendChild(card.element);
      this.cards.push(card);
    }
  }

  private showEmpty() {
    const el = document.createElement('div');
    el.className = 'gallery-empty';
    el.innerHTML = `
      <div class="empty-glyph">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="9" stroke-linecap="round"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </div>
      <h2>Every place holds a story</h2>
      <p>Store your first memory and carry it with you — preserved in 3D, forever.</p>
      <button class="empty-cta" id="empty-add-btn">Begin remembering →</button>
    `;
    el.querySelector('#empty-add-btn')?.addEventListener('click', () => {
      document.getElementById('drawer-toggle')?.click();
    });
    this.space.appendChild(el);
  }

  addCard(memory: Memory) {
    this.space.querySelector('.gallery-empty')?.remove();
    const card = this.makeCard(memory);
    this.space.prepend(card.element);
    this.cards.unshift(card);
  }

  removeCard(id: string) {
    const idx = this.cards.findIndex(c => c.memory.id === id);
    if (idx === -1) return;
    const card = this.cards[idx];
    card.element.classList.add('removing');
    setTimeout(() => {
      card.dispose();
      this.cards.splice(idx, 1);
      if (this.cards.length === 0) this.showEmpty();
    }, 400);
  }

  dispose() { this.cards.forEach(c => c.dispose()); }
}
