import { Component, EventEmitter, Input, OnChanges, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClient, ApiError } from '../../shared/api/api-client';
import { AnnotationSurfaceComponent, AnnotationTool } from './annotation-surface.component';
import {
  Annotations,
  FILE_UNAVAILABLE_MESSAGE,
  ReferenceView,
  pageImageUrl,
  referencesApi,
  registerReferenceMocks,
} from './references.api';

/**
 * Right-side reference panel: the referenced page with the author's overlay.
 * Read-only for viewers (can_edit false → no edit controls); the author can edit / delete.
 * Used embedded next to a chat (`referenceId` input) or as the routed page
 * /projects/:id/references/:referenceId.
 */
@Component({
  selector: 'app-reference-panel',
  standalone: true,
  imports: [FormsModule, AnnotationSurfaceComponent],
  template: `
    <aside class="ref-panel" data-testid="reference-panel" aria-label="Message reference">
      <header class="ref-head">
        <h3>Reference{{ ref() ? ' · page ' + ref()!.page_number : '' }}</h3>
        @if (ref()?.file_name) { <span class="ref-muted" data-testid="reference-file-name">{{ ref()!.file_name }}</span> }
        <button type="button" class="ref-close" data-testid="reference-close" aria-label="Close reference" (click)="close()">×</button>
      </header>
      @if (loading()) { <p data-testid="reference-loading">Loading reference…</p> }
      @if (error()) { <p class="ref-error" role="alert" data-testid="reference-error">{{ error() }}</p> }
      @if (ref(); as r) {
        @if (!r.file_available) {
          <p class="ref-unavailable" data-testid="reference-unavailable">{{ unavailableMessage }}</p>
        } @else {
          <app-annotation-surface [imageUrl]="imageUrl(r)" [page]="r.page_number"
                                  [annotations]="editing() ? draft() : r.annotations"
                                  [editable]="editing()" [tool]="tool" [pendingText]="pendingText"
                                  (annotationsChange)="draft.set($event)" />
        }
        @if (r.can_edit) {
          <div class="ref-actions" data-testid="reference-edit-controls">
            @if (!editing()) {
              @if (r.file_available) {
                <button type="button" data-testid="reference-edit" (click)="startEdit(r)">Edit annotations</button>
              }
              <button type="button" data-testid="reference-delete" [disabled]="busy()" (click)="remove(r)">Delete</button>
            } @else {
              <button type="button" data-testid="reference-tool-draw" [class.active]="tool === 'draw'" (click)="tool = 'draw'">✎ Draw</button>
              <button type="button" data-testid="reference-tool-text" [class.active]="tool === 'text'" (click)="tool = 'text'">T Text box</button>
              @if (tool === 'text') {
                <input type="text" name="pendingText" data-testid="reference-text-input" placeholder="Text, then click the page"
                       [(ngModel)]="pendingText" />
              }
              <button type="button" data-testid="reference-clear" (click)="draft.set({ text_boxes: [], drawings: [] })">Clear</button>
              <button type="button" data-testid="reference-cancel-edit" (click)="editing.set(false)">Cancel</button>
              <button type="button" data-testid="reference-save-edit" [disabled]="busy()" (click)="saveEdit(r)">Save</button>
            }
          </div>
        } @else {
          <p class="ref-muted" data-testid="reference-read-only">Read-only · only the author can edit this reference.</p>
        }
      }
    </aside>
  `,
  styles: [`
    :host { display: contents; }
    .ref-panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(480px, 100vw); z-index: 40; overflow-y: auto;
                 background: var(--surface, #fff); color: inherit; border-left: 1px solid #ddd;
                 box-shadow: -4px 0 16px rgba(0, 0, 0, 0.12); padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
    .ref-head { display: flex; align-items: center; gap: 8px; }
    .ref-head h3 { margin: 0; flex: 1; font-size: 16px; }
    .ref-close { border: none; background: transparent; font-size: 20px; cursor: pointer; }
    .ref-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .ref-actions .active { font-weight: bold; text-decoration: underline; }
    .ref-muted { color: #666; font-size: 12px; }
    .ref-error { color: #b00020; }
    .ref-unavailable { padding: 24px; text-align: center; border: 1px dashed #bbb; color: #555; }
  `],
})
export class ReferencePanelComponent implements OnInit, OnChanges {
  private readonly api = inject(ApiClient);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router);

  @Input() referenceId = '';
  @Input() projectId = '';
  @Output() closed = new EventEmitter<void>();
  @Output() deleted = new EventEmitter<string>();

  readonly unavailableMessage = FILE_UNAVAILABLE_MESSAGE;
  readonly ref = signal<ReferenceView | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly editing = signal(false);
  readonly draft = signal<Annotations>({ text_boxes: [], drawings: [] });
  tool: AnnotationTool = 'draw';
  pendingText = '';
  private routed = false;
  private initialised = false;

  ngOnInit(): void {
    const params = this.route?.snapshot.paramMap;
    if (!this.referenceId && params?.get('referenceId')) {
      this.routed = true;
      this.referenceId = params.get('referenceId') ?? '';
      this.projectId = params.get('id') ?? '';
    }
    this.initialised = true;
    void this.load();
  }

  ngOnChanges(): void {
    if (this.initialised) void this.load();
  }

  imageUrl(r: ReferenceView): string | null {
    return r.file_version_id ? pageImageUrl(r.file_version_id, r.page_number) : null;
  }

  async load(): Promise<void> {
    if (!this.referenceId) return;
    registerReferenceMocks(this.api, this.projectId, this.referenceId);
    this.loading.set(true);
    this.error.set(null);
    this.editing.set(false);
    try {
      const r = await referencesApi.get(this.api, this.referenceId);
      this.ref.set({ ...r, annotations: r.annotations ?? { text_boxes: [], drawings: [] } });
    } catch (e) {
      this.ref.set(null);
      this.error.set(e instanceof ApiError ? e.message : 'Could not load this reference.');
    } finally {
      this.loading.set(false);
    }
  }

  startEdit(r: ReferenceView): void {
    this.draft.set({
      text_boxes: [...(r.annotations.text_boxes ?? [])],
      drawings: [...(r.annotations.drawings ?? [])],
    });
    this.editing.set(true);
  }

  async saveEdit(r: ReferenceView): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const res = await referencesApi.update(this.api, r.id, { annotations: this.draft() });
      this.ref.set({ ...r, annotations: res.annotations, page_number: res.page_number, updated_at: res.updated_at });
      this.editing.set(false);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'Could not save the reference.');
    } finally {
      this.busy.set(false);
    }
  }

  async remove(r: ReferenceView): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await referencesApi.remove(this.api, r.id);
      this.ref.set(null);
      this.deleted.emit(r.id);
      this.close();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'Could not delete the reference.');
    } finally {
      this.busy.set(false);
    }
  }

  close(): void {
    this.closed.emit();
    if (this.routed) {
      void this.router.navigate(this.projectId ? ['/projects', this.projectId] : ['/projects']);
    }
  }
}
