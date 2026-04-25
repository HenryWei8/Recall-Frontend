import { submitMemory, pollStatus, resultsUrl } from './api/memories';
import type { Memory } from './types';

type OnComplete = (memory: Memory) => void;

export class Drawer {
  private panel:     HTMLElement;
  private overlay:   HTMLElement;
  private toggleBtn: HTMLElement;
  private open = false;
  private polling: ReturnType<typeof setInterval> | null = null;

  // form refs
  private titleInput!:  HTMLInputElement;
  private fileInput!:   HTMLInputElement;
  private fxInput!:     HTMLInputElement;
  private fyInput!:     HTMLInputElement;
  private cxInput!:     HTMLInputElement;
  private cyInput!:     HTMLInputElement;
  private widthInput!:  HTMLInputElement;
  private heightInput!: HTMLInputElement;
  private submitBtn!:   HTMLButtonElement;
  private progressBar!: HTMLElement;
  private logBox!:      HTMLElement;
  private fileLabel!:   HTMLElement;
  private dlBtn!:       HTMLElement;

  constructor(private onComplete: OnComplete) {
    this.panel    = document.getElementById('drawer-panel')!;
    this.overlay  = document.getElementById('drawer-overlay')!;
    this.toggleBtn = document.getElementById('drawer-toggle')!;

    this.buildHTML();
    this.bindEvents();
  }

  private buildHTML() {
    this.panel.innerHTML = `
      <div class="drawer-header">
        <h3>ADD MEMORY</h3>
        <button class="drawer-close" id="drawer-close">✕</button>
      </div>
      <div class="drawer-body">
        <div class="field">
          <label>TITLE</label>
          <input id="d-title" type="text" placeholder="Give this memory a name…" />
        </div>
        <div class="field">
          <label>VIDEO FILE</label>
          <div class="file-pick-btn" id="d-file-pick">Drop video or click to browse</div>
          <div class="file-name" id="d-file-name"></div>
          <input id="d-file" type="file" accept="video/*" />
        </div>
        <details class="intrinsics">
          <summary>Camera intrinsics (auto-detected)</summary>
          <div class="grid-2">
            <div class="field"><label>FX</label><input id="d-fx" type="number" placeholder="fx" /></div>
            <div class="field"><label>FY</label><input id="d-fy" type="number" placeholder="fy" /></div>
            <div class="field"><label>CX</label><input id="d-cx" type="number" placeholder="cx" /></div>
            <div class="field"><label>CY</label><input id="d-cy" type="number" placeholder="cy" /></div>
            <div class="field"><label>WIDTH</label><input id="d-w"  type="number" placeholder="w" /></div>
            <div class="field"><label>HEIGHT</label><input id="d-h" type="number" placeholder="h" /></div>
          </div>
        </details>
        <button class="submit-btn" id="d-submit" disabled>Process Memory</button>
        <div class="progress" id="d-progress-wrap" style="display:none">
          <div class="progress-bar" id="d-progress-bar"></div>
        </div>
        <div id="drawer-log" style="display:none"></div>
        <a class="download-btn" id="d-dl">Download .ply</a>
      </div>
    `;

    this.titleInput  = document.getElementById('d-title')!  as HTMLInputElement;
    this.fileInput   = document.getElementById('d-file')!   as HTMLInputElement;
    this.fxInput     = document.getElementById('d-fx')!     as HTMLInputElement;
    this.fyInput     = document.getElementById('d-fy')!     as HTMLInputElement;
    this.cxInput     = document.getElementById('d-cx')!     as HTMLInputElement;
    this.cyInput     = document.getElementById('d-cy')!     as HTMLInputElement;
    this.widthInput  = document.getElementById('d-w')!      as HTMLInputElement;
    this.heightInput = document.getElementById('d-h')!      as HTMLInputElement;
    this.submitBtn   = document.getElementById('d-submit')! as HTMLButtonElement;
    this.progressBar = document.getElementById('d-progress-bar')!;
    this.logBox      = document.getElementById('drawer-log')!;
    this.fileLabel   = document.getElementById('d-file-name')!;
    this.dlBtn       = document.getElementById('d-dl')!;
  }

  private bindEvents() {
    this.toggleBtn.addEventListener('click', () => this.toggle());
    this.overlay.addEventListener('click',   () => this.close());
    document.getElementById('drawer-close')?.addEventListener('click', () => this.close());

    // Stop clicks inside panel from closing via overlay
    this.panel.addEventListener('click', e => e.stopPropagation());

    // File pick button
    document.getElementById('d-file-pick')?.addEventListener('click', () => this.fileInput.click());

    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0];
      if (!f) return;
      this.fileLabel.textContent = f.name;
      this.submitBtn.disabled = false;
      this.autoDetectIntrinsics(f);
    });

    // Drag-and-drop onto panel
    this.panel.addEventListener('dragover',  e => { e.preventDefault(); });
    this.panel.addEventListener('drop', e => {
      e.preventDefault();
      const f = e.dataTransfer?.files[0];
      if (f?.type.startsWith('video/')) {
        const dt = new DataTransfer();
        dt.items.add(f);
        this.fileInput.files = dt.files;
        this.fileLabel.textContent = f.name;
        this.submitBtn.disabled = false;
        this.autoDetectIntrinsics(f);
      }
    });

    this.submitBtn.addEventListener('click', () => this.submit());
  }

  private autoDetectIntrinsics(file: File) {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;
      const fov = 70 * Math.PI / 180;
      const fx  = Math.round(w / (2 * Math.tan(fov / 2)));
      const fy  = fx;
      this.widthInput.value  = String(w);
      this.heightInput.value = String(h);
      this.fxInput.value     = String(fx);
      this.fyInput.value     = String(fy);
      this.cxInput.value     = String(Math.round(w / 2));
      this.cyInput.value     = String(Math.round(h / 2));
      URL.revokeObjectURL(video.src);
    };
  }

  private async submit() {
    const file = this.fileInput.files?.[0];
    if (!file) return;

    this.submitBtn.disabled = true;
    this.logBox.style.display  = 'block';
    this.logBox.textContent    = 'Submitting…';
    const pw = document.getElementById('d-progress-wrap')!;
    pw.style.display = 'block';
    this.progressBar.style.width = '5%';
    this.dlBtn.classList.remove('visible');

    const fd = new FormData();
    fd.append('video', file);
    fd.append('title', this.titleInput.value || file.name.replace(/\.[^.]+$/, ''));
    fd.append('fps',       '5');
    fd.append('max_short', '480');

    const intrinsics = {
      fx: this.fxInput.value, fy: this.fyInput.value,
      cx: this.cxInput.value, cy: this.cyInput.value,
      width: this.widthInput.value, height: this.heightInput.value,
    };
    if (Object.values(intrinsics).every(v => v)) {
      Object.entries(intrinsics).forEach(([k, v]) => fd.append(k, v));
    }

    try {
      const { job_id } = await submitMemory(fd);
      this.progressBar.style.width = '15%';
      this.logBox.textContent = `Job ${job_id} queued…`;
      this.startPolling(job_id);
    } catch (e: any) {
      this.logBox.textContent = `Error: ${e.message}`;
      this.submitBtn.disabled = false;
    }
  }

  private startPolling(jobId: string) {
    let dots = 0;
    this.polling = setInterval(async () => {
      try {
        const status = await pollStatus(jobId);
        dots = (dots + 1) % 4;
        const spinner = '.'.repeat(dots + 1);
        const bar = status.status === 'done' ? 100
                  : status.status === 'running' ? 55 : 25;
        this.progressBar.style.width = `${bar}%`;

        if (status.log) this.logBox.textContent = status.log;

        if (status.status === 'done') {
          this.stopPolling();
          this.progressBar.style.width = '100%';
          this.logBox.textContent = status.log || 'Done!';
          const url = resultsUrl(jobId);
          (this.dlBtn as HTMLAnchorElement).href = url;
          this.dlBtn.classList.add('visible');

          // Fire callback so gallery can add the bubble
          const mem: Memory = {
            id:           jobId,
            title:        this.titleInput.value || 'Memory',
            plyUrl:       url,
            thumbnailUrl: url,
            posterUrl:    url,
            position:     null,
            createdAt:    new Date().toISOString(),
          };
          this.onComplete(mem);
          setTimeout(() => this.close(), 800);
        } else if (status.status === 'failed') {
          this.stopPolling();
          this.logBox.textContent = `Failed: ${status.error || 'unknown error'}`;
          this.submitBtn.disabled = false;
        } else {
          this.logBox.textContent = `[${status.status}] ${spinner}\n${status.log || ''}`;
        }
      } catch (e) {
        console.warn('Poll error:', e);
      }
    }, 3000);
  }

  private stopPolling() {
    if (this.polling !== null) { clearInterval(this.polling); this.polling = null; }
  }

  toggle()  { this.open ? this.close() : this.openDrawer(); }

  openDrawer() {
    this.open = true;
    this.overlay.classList.add('active');
    (this.panel as HTMLElement).style.transition = 'transform 0.3s cubic-bezier(0.4,0,0.2,1)';
    (this.panel as HTMLElement).style.transform  = 'translateX(0)';
    this.toggleBtn.textContent = '✕ Close';
  }

  close() {
    this.open = false;
    this.overlay.classList.remove('active');
    (this.panel as HTMLElement).style.transform  = 'translateX(380px)';
    this.toggleBtn.textContent = '+ Add Memory';
  }
}
