/// <reference types="vite/client" />

declare module '@mkkellogg/gaussian-splats-3d' {
  import type * as THREE from 'three';
  interface ViewerOptions {
    selfDrivenMode?: boolean;
    renderer?: THREE.WebGLRenderer;
    camera?: THREE.Camera;
    useBuiltInControls?: boolean;
    gpuAcceleratedSort?: boolean;
    sharedMemoryForWorkers?: boolean;
    [key: string]: unknown;
  }
  export class Viewer {
    constructor(options: ViewerOptions);
    addSplatScene(url: string, options?: Record<string, unknown>): Promise<void>;
    start(): void;
    update(): void;
    render(): void;
    dispose(): void;
    scene?: THREE.Scene;
    threeScene?: THREE.Scene;
  }
}

interface ImportMetaEnv {
  readonly VITE_API_BASE: string;
  readonly VITE_STATIC_BASE: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
