import { CapsuleCard } from './CapsuleCard';
import { fetchMemories } from './api/memories';
import type { Memory } from './types';

export class Gallery {
  private space: HTMLElement;
  private cards: CapsuleCard[] = [];

  constructor(
    private onOpen: (m: Memory) => void,
    private onDelete: (m: Memory) => void,
  ) {
    this.space = document.getElementById('gallery-space')!;
  }

  async loadMemories(): Promise<Memory[]> {
    let memories: Memory[] = [];
    try { memories = await fetchMemories(); } catch { /* show empty */ }
    this.renderCards(memories);
    return memories;
  }

  private renderCards(memories: Memory[]) {
    this.space.innerHTML = '';
    this.cards.forEach(c => c.dispose());
    this.cards = [];

    if (memories.length === 0) {
      this.showEmpty();
      return;
    }

    memories.forEach((mem, i) => {
      const card = this.makeCard(mem, i * 60);
      this.space.appendChild(card.element);
      this.cards.push(card);
    });
  }

  private makeCard(mem: Memory, delayMs = 0): CapsuleCard {
    const card = new CapsuleCard(mem, this.onOpen, this.onDelete);
    // random float params for organic feel
    const dy   = 8  + Math.random() * 9;
    const dur  = 7  + Math.random() * 6;
    const del  = -Math.random() * dur;   // start mid-animation
    const tilt = (Math.random() - 0.5) * 1.2;
    card.setFloatParams(dy, dur, del, tilt);
    (card.element as HTMLElement).style.animationDelay = `${delayMs}ms`;
    // override — the card-in animation delay
    const inner = card.element.querySelector('.capsule-card') as HTMLElement;
    if (inner) inner.style.animationDelay = `${delayMs}ms`;
    return card;
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
    const empty = this.space.querySelector('.gallery-empty');
    if (empty) empty.remove();

    const card = this.makeCard(memory, 0);
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

  dispose() {
    this.cards.forEach(c => c.dispose());
  }
}
