import * as THREE from 'three';

export interface Memory {
  id: string;
  title: string;
  plyUrl: string;
  thumbnailUrl: string;
  posterUrl: string;
  position: [number, number, number] | null;
  createdAt: string;
}

export type AppState = 'gallery' | 'transitioning' | 'chamber';

export interface BubbleEnterEvent {
  memoryId: string;
  bubble: import('./Bubble').Bubble;
  worldPosition: THREE.Vector3;
}
