import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient, ApiError, MockApiClient } from '../../shared/api/api-client';
import {
  Breadcrumb, DownloadLink, FileItem, FileVersion, FolderItem, FolderListing, UploadResult,
  registerFileExplorerMocks, uploadWithProgress,
} from './file-explorer.api';
import { FILE_EXPLORER_STYLES } from './file-explorer.styles';

type ViewMode = 'list' | 'grid';
interface MoveTarget { id: string | null; name: string; }

@Component({
  selector: 'app-file-explorer',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe],
  styles: [FILE_EXPLORER_STYLES],
  template: `
  <section class="fx" data-testid="file-explorer">
    <header class="fx-head">
      <h1>Files</h1>
      <nav class="fx-crumbs" data-testid="breadcrumbs" aria-label="Breadcrumbs">
        @for (c of breadcrumbs(); track $index; let last = $last) {
          @if (last) {
            <span class="crumb current" data-testid="breadcrumb">{{ c.name }}</span>
          } @else {
            <a class="crumb" data-testid="breadcrumb" [routerLink]="folderLink(c.id)">{{ c.name }}</a>
            <span class="sep">/</span>
          }
        }
      </nav>
    </header>

    <div class="fx-toolbar">
      <input class="fx-search" data-testid="file-search" type="search" placeholder="Search by name…"
             [(ngModel)]="query" (ngModelChange)="onSearch()" aria-label="Search files and folders" />
      <div class="fx-view" data-testid="view-toggle" role="group" aria-label="View">
        <button type="button" data-testid="view-list" [class.active]="view() === 'list'" (click)="view.set('list')">List</button>
        <button type="button" data-testid="view-grid" [class.active]="view() === 'grid'" (click)="view.set('grid')">Grid</button>
      </div>
      <form class="fx-newfolder" (ngSubmit)="createFolder()">
        <input data-testid="new-folder-name" name="newFolder" placeholder="New folder name" [(ngModel)]="newFolderName" />
        <button type="submit" data-testid="create-folder">New folder</button>
      </form>
      <label class="fx-upload">
        <span>Upload files</span>
        <input data-testid="upload-input" type="file" multiple (change)="onFilesPicked($event)" />
      </label>
    </div>

    @if (uploadProgress() !== null) {
      <div class="fx-progress">
        <progress data-testid="upload-progress" max="100" [value]="uploadProgress() ?? 0"></progress>
        <span>{{ uploadProgress() }}%</span>
      </div>
    }

    @if (error(); as err) {
      <div class="fx-error" role="alert" data-testid="file-explorer-error">
        <span>{{ err.message }}</span>
        @if (err.retryable) {
          <button type="button" data-testid="retry-button" (click)="retry()">Retry</button>
        }
        <button type="button" class="link" (click)="error.set(null)">Dismiss</button>
      </div>
    }

    @if (loading() && !folders().length && !files().length) {
      <p class="fx-muted">Loading…</p>
    } @else if (!folders().length && !files().length) {
      <p class="fx-muted" data-testid="empty-state">{{ query ? 'No matching files or folders.' : 'This folder is empty.' }}</p>
    }

    <div class="fx-items" [class.grid]="view() === 'grid'" [attr.data-view]="view()" data-testid="file-items">
      @if (view() === 'list' && (folders().length || files().length)) {
        <div class="fx-row fx-row-head">
          <span>Name</span><span>Size</span><span>Type</span><span>Uploaded by</span><span>Date</span><span></span>
        </div>
      }
      @for (f of folders(); track f.id) {
        <div class="fx-row folder" data-testid="folder-row" [attr.data-id]="f.id">
          @if (renaming() === f.id) {
            <span><input data-testid="rename-input" [(ngModel)]="renameValue" (keyup.enter)="saveRename('folder', f.id)" />
              <button type="button" data-testid="rename-save" (click)="saveRename('folder', f.id)">Save</button></span>
          } @else {
            <a class="name" [routerLink]="folderLink(f.id)">📁 {{ f.name }}</a>
          }
          <span>—</span><span>Folder</span><span></span><span></span>
          <span class="actions">
            <button type="button" data-testid="rename-button" (click)="startRename(f.id, f.name)">Rename</button>
            <select data-testid="move-select" aria-label="Move to" (change)="move('folder', f.id, $event)">
              <option value="">Move to…</option>
              @for (t of moveTargets(f.id); track t.id) { <option [value]="t.id ?? '__root__'">{{ t.name }}</option> }
            </select>
            <button type="button" data-testid="delete-button" (click)="remove('folder', f.id)">Delete</button>
          </span>
        </div>
      }
      @for (f of files(); track f.id) {
        <div class="fx-row file" data-testid="file-row" [attr.data-id]="f.id">
          @if (renaming() === f.id) {
            <span><input data-testid="rename-input" [(ngModel)]="renameValue" (keyup.enter)="saveRename('file', f.id)" />
              <button type="button" data-testid="rename-save" (click)="saveRename('file', f.id)">Save</button></span>
          } @else {
            <span class="name">📄 {{ f.name }}</span>
          }
          <span>{{ formatSize(f.size_bytes) }}</span>
          <span>{{ f.mime_type }}</span>
          <span>{{ f.uploaded_by_name || f.uploaded_by || '—' }}</span>
          <span>{{ f.uploaded_at ? (f.uploaded_at | date: 'mediumDate') : '—' }}</span>
          <span class="actions">
            <button type="button" data-testid="download-button" (click)="download(f)">Download</button>
            <button type="button" data-testid="versions-button" (click)="openVersions(f)">Versions (v{{ f.version_number }})</button>
            <button type="button" data-testid="rename-button" (click)="startRename(f.id, f.name)">Rename</button>
            <select data-testid="move-select" aria-label="Move to" (change)="move('file', f.id, $event)">
              <option value="">Move to…</option>
              @for (t of moveTargets(null); track t.id) { <option [value]="t.id ?? '__root__'">{{ t.name }}</option> }
            </select>
            <button type="button" data-testid="delete-button" (click)="remove('file', f.id)">Delete</button>
          </span>
        </div>
      }
    </div>

    @if (versionsFor(); as vf) {
      <aside class="fx-versions" data-testid="versions-panel">
        <header><h2>Versions of {{ vf.name }}</h2>
          <button type="button" class="link" (click)="versionsFor.set(null)">Close</button></header>
        <ul>
          @for (v of versions(); track v.id) {
            <li data-testid="version-row">v{{ v.version_number }} · {{ formatSize(v.size_bytes) }} ·
              {{ v.uploaded_at ? (v.uploaded_at | date: 'medium') : '' }}</li>
          }
        </ul>
      </aside>
    }
  </section>
  `,
})
export class FileExplorerComponent implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  projectId = '';
  folderId: string | null = null;
  query = '';
  newFolderName = '';
  renameValue = '';

  readonly view = signal<ViewMode>('list');
  readonly loading = signal(false);
  readonly breadcrumbs = signal<Breadcrumb[]>([{ id: null, name: 'Files' }]);
  readonly folders = signal<FolderItem[]>([]);
  readonly files = signal<FileItem[]>([]);
  readonly uploadProgress = signal<number | null>(null);
  readonly error = signal<{ message: string; retryable: boolean } | null>(null);
  readonly renaming = signal<string | null>(null);
  readonly versionsFor = signal<FileItem | null>(null);
  readonly versions = signal<FileVersion[]>([]);

  private lastAction: (() => Promise<void>) | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    const sub = this.route.paramMap.subscribe((pm) => {
      this.projectId = pm.get('id') ?? '';
      this.folderId = pm.get('folderId');
      registerFileExplorerMocks(this.api, this.projectId);
      this.versionsFor.set(null);
      void this.run(() => this.load());
    });
    this.destroyRef.onDestroy(() => {
      sub.unsubscribe();
      if (this.searchTimer) clearTimeout(this.searchTimer);
    });
  }

  folderLink(id: string | null): unknown[] {
    return id ? ['/projects', this.projectId, 'files', id] : ['/projects', this.projectId, 'files'];
  }

  /** Destinations for a move: the project root, parent crumbs and sibling folders (never itself). */
  moveTargets(excludeId: string | null): MoveTarget[] {
    const crumbs = this.breadcrumbs().filter((c) => c.id !== this.folderId);
    const siblings = this.folders().map((f) => ({ id: f.id as string | null, name: f.name }));
    const seen = new Set<string>();
    return [...crumbs, ...siblings].filter((t) => {
      const key = t.id ?? '__root__';
      if (t.id === excludeId || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  formatSize(bytes: number | null | undefined): string {
    const b = Number(bytes ?? 0);
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  /** Runs an action, mapping failures to the error banner; 503s keep the action for Retry. */
  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    try {
      await action();
      this.lastAction = null;
    } catch (e) {
      const err = e as ApiError;
      const retryable = err?.status === 503 || err?.body?.retryable === true;
      this.lastAction = retryable ? action : null;
      this.error.set({ message: err?.message || 'Something went wrong.', retryable });
    }
  }

  retry(): void {
    const action = this.lastAction;
    if (action) void this.run(action);
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const q = this.query.trim();
      const res = await this.api.get<FolderListing>(`/api/projects/${this.projectId}/files`, {
        folder_id: this.folderId ?? undefined,
        q: q || undefined,
      });
      this.breadcrumbs.set(res?.folder?.breadcrumbs?.length ? res.folder.breadcrumbs : [{ id: null, name: 'Files' }]);
      this.folders.set(res?.folders ?? []);
      this.files.set(res?.files ?? []);
    } finally {
      this.loading.set(false);
    }
  }

  onSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.run(() => this.load()), 250);
  }

  createFolder(): void {
    const name = this.newFolderName;
    void this.run(async () => {
      await this.api.post(`/api/projects/${this.projectId}/folders`, { name, parent_id: this.folderId });
      this.newFolderName = '';
      await this.load();
    });
  }

  onFilesPicked(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;
    void this.run(() => this.upload(files));
  }

  private async upload(files: File[]): Promise<void> {
    this.uploadProgress.set(0);
    try {
      if (this.api instanceof MockApiClient) {
        const form = new FormData();
        files.forEach((f) => form.append('files', f, f.name));
        await this.api.postMultipart<UploadResult>(`/api/projects/${this.projectId}/files`, form);
        this.uploadProgress.set(100);
      } else {
        await uploadWithProgress(this.projectId, this.folderId, files, (p) => this.uploadProgress.set(p));
      }
      await this.load();
    } finally {
      this.uploadProgress.set(null);
    }
  }

  startRename(id: string, current: string): void {
    this.renaming.set(id);
    this.renameValue = current;
  }

  saveRename(kind: 'file' | 'folder', id: string): void {
    const name = this.renameValue;
    void this.run(async () => {
      await this.api.patch(kind === 'file' ? `/api/files/${id}` : `/api/folders/${id}`, { name });
      this.renaming.set(null);
      await this.load();
    });
  }

  move(kind: 'file' | 'folder', id: string, ev: Event): void {
    const value = (ev.target as HTMLSelectElement).value;
    if (!value) return;
    const target = value === '__root__' ? null : value;
    void this.run(async () => {
      await this.api.patch(
        kind === 'file' ? `/api/files/${id}` : `/api/folders/${id}`,
        kind === 'file' ? { folder_id: target } : { parent_id: target },
      );
      await this.load();
    });
  }

  remove(kind: 'file' | 'folder', id: string): void {
    void this.run(async () => {
      await this.api.delete(kind === 'file' ? `/api/files/${id}` : `/api/folders/${id}`);
      if (this.versionsFor()?.id === id) this.versionsFor.set(null);
      await this.load();
    });
  }

  openVersions(file: FileItem): void {
    void this.run(async () => {
      const res = await this.api.get<{ items: FileVersion[] }>(`/api/files/${file.id}/versions`);
      this.versions.set(res?.items ?? []);
      this.versionsFor.set(file);
    });
  }

  download(file: FileItem): void {
    void this.run(async () => {
      const res = await this.api.get<DownloadLink>(`/api/files/${file.id}/download`);
      if (res?.url) window.open(res.url, '_blank', 'noopener');
    });
  }

  /** Exposed for templates/tests that navigate programmatically. */
  openFolder(id: string | null): void {
    void this.router.navigate(this.folderLink(id));
  }
}
