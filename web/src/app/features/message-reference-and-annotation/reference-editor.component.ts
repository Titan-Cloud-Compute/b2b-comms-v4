import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiClient, ApiError } from '../../shared/api/api-client';
import { AnnotationSurfaceComponent, AnnotationTool } from './annotation-surface.component';
import {
  Annotations,
  PickerFile,
  Reference,
  UNSUPPORTED_FILE_MESSAGE,
  pageImageUrl,
  referenceKind,
  referencesApi,
} from './references.api';

/**
 * Reference editor: pick a PDF/image from the project files, choose the page,
 * add text boxes and freehand drawings, then save (POST /api/messages/:id/reference).
 */
@Component({
  selector: 'app-reference-editor',
  standalone: true,
  imports: [FormsModule, AnnotationSurfaceComponent],
  template: `
    <div class="ref-editor" data-testid="reference-editor">
      @if (!file()) {
        <h3>Choose a file to reference</h3>
        <p class="ref-hint" data-testid="reference-unsupported-hint">{{ unsupportedMessage }}</p>
        @if (loadingFiles()) { <p>Loading files…</p> }
        <ul class="ref-files" data-testid="reference-file-list">
          @for (f of files(); track f.id) {
            <li>
              <button type="button" data-testid="reference-file-option" [attr.data-file-id]="f.id"
                      [disabled]="!isSupported(f)" [attr.aria-disabled]="!isSupported(f)" (click)="pick(f)">
                {{ f.name }}
              </button>
              @if (!isSupported(f)) { <small class="ref-muted">{{ unsupportedMessage }}</small> }
            </li>
          } @empty {
            @if (!loadingFiles()) { <li class="ref-muted">No files in this project yet.</li> }
          }
        </ul>
      } @else {
        <div class="ref-toolbar">
          <strong>{{ file()!.name }}</strong>
          @if (referenceKind(file()!.mime_type, file()!.name) === 'pdf') {
            <button type="button" data-testid="reference-prev-page" [disabled]="page() <= 1" (click)="setPage(page() - 1)">‹</button>
            <label>Page <input type="number" min="1" name="page" data-testid="reference-page-input"
                               [ngModel]="page()" (ngModelChange)="setPage($event)" /></label>
            <button type="button" data-testid="reference-next-page" (click)="setPage(page() + 1)">›</button>
          }
          <button type="button" data-testid="reference-change-file" (click)="clearFile()">Change file</button>
        </div>
        <div class="ref-toolbar">
          <button type="button" data-testid="reference-tool-draw" [class.active]="tool === 'draw'" (click)="tool = 'draw'">✎ Draw</button>
          <button type="button" data-testid="reference-tool-text" [class.active]="tool === 'text'" (click)="tool = 'text'">T Text box</button>
          @if (tool === 'text') {
            <input type="text" name="pendingText" data-testid="reference-text-input" placeholder="Text, then click the page"
                   [(ngModel)]="pendingText" />
          }
        </div>
        <app-annotation-surface [imageUrl]="imageUrl()" [page]="page()" [annotations]="annotations()"
                                [editable]="true" [tool]="tool" [pendingText]="pendingText"
                                (annotationsChange)="annotations.set($event)" />
      }
      @if (error()) { <p class="ref-error" role="alert" data-testid="reference-error">{{ error() }}</p> }
      <div class="ref-actions">
        <button type="button" data-testid="reference-cancel" (click)="cancelled.emit()">Cancel</button>
        <button type="button" data-testid="reference-save" [disabled]="!file() || busy()" (click)="save()">Save reference</button>
      </div>
    </div>
  `,
  styles: [`
    .ref-editor { display: flex; flex-direction: column; gap: 10px; }
    .ref-files { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
    .ref-files button[disabled] { opacity: 0.5; cursor: not-allowed; }
    .ref-toolbar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .ref-toolbar input[type=number] { width: 64px; }
    .ref-toolbar .active { font-weight: bold; text-decoration: underline; }
    .ref-actions { display: flex; gap: 8px; justify-content: flex-end; }
    .ref-muted, .ref-hint { color: #666; font-size: 12px; }
    .ref-error { color: #b00020; }
  `],
})
export class ReferenceEditorComponent implements OnInit {
  private readonly api = inject(ApiClient);

  @Input({ required: true }) projectId = '';
  @Input({ required: true }) messageId = '';
  @Output() saved = new EventEmitter<Reference>();
  @Output() cancelled = new EventEmitter<void>();

  readonly unsupportedMessage = UNSUPPORTED_FILE_MESSAGE;
  readonly referenceKind = referenceKind;
  readonly files = signal<PickerFile[]>([]);
  readonly loadingFiles = signal(false);
  readonly file = signal<PickerFile | null>(null);
  readonly versionId = signal<string | null>(null);
  readonly page = signal(1);
  readonly imageUrl = signal<string | null>(null);
  readonly annotations = signal<Annotations>({ text_boxes: [], drawings: [] });
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  tool: AnnotationTool = 'draw';
  pendingText = '';

  ngOnInit(): void {
    void this.loadFiles();
  }

  isSupported(f: PickerFile): boolean {
    return referenceKind(f.mime_type, f.name) !== null;
  }

  private async loadFiles(): Promise<void> {
    this.loadingFiles.set(true);
    try {
      this.files.set(await referencesApi.projectFiles(this.api, this.projectId));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'Could not load project files.');
    } finally {
      this.loadingFiles.set(false);
    }
  }

  async pick(f: PickerFile): Promise<void> {
    if (!this.isSupported(f)) {
      this.error.set(UNSUPPORTED_FILE_MESSAGE);
      return;
    }
    this.error.set(null);
    this.file.set(f);
    this.page.set(1);
    this.annotations.set({ text_boxes: [], drawings: [] });
    try {
      this.versionId.set(await referencesApi.latestVersionId(this.api, f.id));
    } catch {
      this.versionId.set(null);
    }
    this.refreshImage();
  }

  clearFile(): void {
    this.file.set(null);
    this.versionId.set(null);
    this.imageUrl.set(null);
  }

  setPage(n: unknown): void {
    const p = Math.max(1, Math.floor(Number(n) || 1));
    this.page.set(p);
    this.refreshImage();
  }

  private refreshImage(): void {
    const v = this.versionId();
    this.imageUrl.set(v ? pageImageUrl(v, this.page()) : null);
  }

  async save(): Promise<void> {
    const f = this.file();
    if (!f) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const body = {
        ...(this.versionId() ? { file_version_id: this.versionId()! } : { file_id: f.id }),
        page_number: this.page(),
        annotations: this.annotations(),
      };
      const ref = await referencesApi.create(this.api, this.messageId, body);
      this.saved.emit(ref);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'Could not save the reference.');
    } finally {
      this.busy.set(false);
    }
  }
}
