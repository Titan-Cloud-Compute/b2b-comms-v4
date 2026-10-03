import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { ReferenceEditorComponent } from './reference-editor.component';
import { ReferencePanelComponent } from './reference-panel.component';
import { Reference } from './references.api';

/**
 * Per-message reference controls a chat message list can host:
 * - "View Reference" when the message has a reference (opens the right-side panel)
 * - "Add reference" for the message author when it has none (opens the editor in the right-side panel)
 */
@Component({
  selector: 'app-message-reference',
  standalone: true,
  imports: [ReferenceEditorComponent, ReferencePanelComponent],
  template: `
    <span class="msg-ref" data-testid="message-reference">
      @if (currentId()) {
        <button type="button" class="msg-ref-btn" data-testid="view-reference" (click)="open.set('view')">View Reference</button>
      } @else if (canAdd) {
        <button type="button" class="msg-ref-btn" data-testid="add-reference" (click)="open.set('edit')">Add reference</button>
      }
    </span>
    @if (open() === 'view' && currentId()) {
      <app-reference-panel [referenceId]="currentId()!" [projectId]="projectId"
                           (closed)="open.set(null)" (deleted)="onDeleted()" />
    }
    @if (open() === 'edit') {
      <aside class="msg-ref-editor" data-testid="reference-editor-panel" aria-label="Add a reference">
        <app-reference-editor [projectId]="projectId" [messageId]="messageId"
                              (saved)="onSaved($event)" (cancelled)="open.set(null)" />
      </aside>
    }
  `,
  styles: [`
    .msg-ref-btn { font-size: 12px; margin-top: 4px; }
    .msg-ref-editor { position: fixed; top: 0; right: 0; bottom: 0; width: min(480px, 100vw); z-index: 40; overflow-y: auto;
                      background: var(--surface, #fff); border-left: 1px solid #ddd;
                      box-shadow: -4px 0 16px rgba(0, 0, 0, 0.12); padding: 12px 16px; }
  `],
})
export class MessageReferenceComponent {
  @Input({ required: true }) projectId = '';
  @Input({ required: true }) messageId = '';
  @Input() set referenceId(v: string | null | undefined) {
    this.currentId.set(v || null);
  }
  /** True when the current user authored the message (only authors may attach a reference). */
  @Input() canAdd = false;
  @Output() referenceChange = new EventEmitter<string | null>();

  readonly currentId = signal<string | null>(null);
  readonly open = signal<'view' | 'edit' | null>(null);

  onSaved(ref: Reference): void {
    this.currentId.set(ref.id);
    this.referenceChange.emit(ref.id);
    this.open.set('view');
  }

  onDeleted(): void {
    this.currentId.set(null);
    this.referenceChange.emit(null);
    this.open.set(null);
  }
}
