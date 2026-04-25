import { CapsuleCard } from './CapsuleCard';
import { fetchMemories } from './api/memories';
import type { Memory } from './types';

export class Gallery {
  private grid  : HTMLElement;
  private cards : CapsuleCard[] = [];

  constructor(private onOpen: (memory: Memory) => void) {
    this.grid = document.getElementById('gallery-grid')!;
  }

  async loadMemories(): Promise<Memory[]> {
    let memories: Memory[] = [];
    try { memories = await fetchMemories(); } catch { /* show empty */ }
    this.renderCards(memories);
    return memories;
  }

  private renderCards(memories: Memory[]) {
    this.grid.innerHTML = '';
    this.cards.forEach(c => c.dispose());
    this.cards = [];

    if (memories.length === 0) {
      this.showEmpty();
      return;
    }

    memories.forEach((mem, i) => {
      const card = new CapsuleCard(mem, this.onOpen);
      // Stagger entrance animation
      (card.element as HTMLElement).style.animationDelay = `${i * 55}ms`;
      this.grid.appendChild(card.element);
      this.cards.push(card);
    });
  }

  private showEmpty() {
    const el = document.createElement('div');
    el.className = 'gallery-empty';
    el.innerHTML = `
      <div class="gallery-empty-icon">◈</div>
      <p>No memories yet.<br>Add your first 3D time capsule to get started.</p>
    `;
    this.grid.appendChild(el);
  }

  addCard(memory: Memory) {
    // Remove empty state if present
    const empty = this.grid.querySelector('.gallery-empty');
    if (empty) empty.remove();

    const card = new CapsuleCard(memory, this.onOpen);
    (card.element as HTMLElement).style.animationDelay = '0ms';
    this.grid.prepend(card.element);
    this.cards.unshift(card);
  }

  dispose() {
    this.cards.forEach(c => c.dispose());
  }
}
