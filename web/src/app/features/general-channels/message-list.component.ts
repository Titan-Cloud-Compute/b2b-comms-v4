import {
  Component,
  EventEmitter,
  Input,
  Output,
  OnChanges,
  Signal,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { DatePipe } from '@angular/common';
import type { Message, OutboxItem } from './general-channels.types';

// DOMPurify is imported as an ESM module; esModuleInterop resolves the default.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import DOMPurify from 'dompurify';

interface EditState {
  messageId: string;
  html: string;
}

@Component({
  selector: 'app-message-list',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="msg-list" data-testid="message-list">
      @if (nextCursor()) {
        <button type="button" data-testid="load-older-btn" (click)="loadOlder.emit(nextCursor())">
          Load older
        </button>
      }

      @for (msg of messages(); track msg.id) {
        <div class="msg-item" [attr.data-message-id]="msg.id" data-testid="message-item">
          <span class="msg-author">{{ msg.author.display_name }}</span>
          <span class="msg-time">{{ msg.created_at | date:'shortTime' }}</span>
          @if (msg.edited_at) {
            <span data-testid="edited-label" class="msg-edited">(edited)</span>
          }
          @if (editState()?.messageId === msg.id) {
            <!-- Inline edit -->
            <div
              data-testid="edit-editor"
              contenteditable="true"
              [innerHTML]="editState()!.html"
              (input)="onEditInput($event)"
            ></div>
            <button type="button" data-testid="save-edit-btn" (click)="saveEdit(msg.id)">Save</button>
            <button type="button" data-testid="cancel-edit-btn" (click)="editState.set(null)">Cancel</button>
          } @else {
            <div
              class="msg-body"
              data-testid="message-body"
              [innerHTML]="sanitize(msg.body_html)"
            ></div>
          }
          @for (att of msg.attachments; track att.file_id) {
            <span class="msg-att" data-testid="attachment-name">{{ att.name }}</span>
          }
          @if (isOwnMessage(msg.author.id)) {
            <button type="button" data-testid="edit-btn" (click)="startEdit(msg)">Edit</button>
            <button type="button" data-testid="delete-btn" (click)="deleteMsg.emit(msg.id)">Delete</button>
          }
        </div>
      }

      <!-- Outbox pending items -->
      @for (item of pendingItems(); track item.temp_id) {
        <div class="msg-item msg-item--pending" data-testid="pending-message">
          <span class="msg-author">You</span>
          <div class="msg-body" data-testid="message-body" [innerHTML]="sanitize(item.body_html)"></div>
          <span data-testid="pending-label" class="msg-pending">pending</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .msg-list { display: flex; flex-direction: column; gap: 8px; padding: 8px; overflow-y: auto; flex: 1; }
    .msg-item { padding: 6px; border-bottom: 1px solid #f0f0f0; }
    .msg-item--pending { opacity: 0.6; }
    .msg-author { font-weight: bold; margin-right: 6px; }
    .msg-time { color: #888; font-size: 0.8em; margin-right: 4px; }
    .msg-edited { color: #aaa; font-size: 0.75em; }
    .msg-pending { color: #e09000; font-size: 0.75em; padding: 2px 6px; background: #fff3cd; border-radius: 4px; }
    .msg-body { margin-top: 4px; }
    .msg-att { font-size: 0.8em; color: #666; margin-right: 4px; }
    button { margin-left: 4px; }
  `],
})
export class MessageListComponent implements OnChanges {
  private sanitizer = inject(DomSanitizer);

  @Input() messages: Signal<Message[]> = signal<Message[]>([]);
  @Input() pendingItems: Signal<OutboxItem[]> = signal<OutboxItem[]>([]);
  @Input() nextCursor: Signal<string | null | undefined> = signal<string | null | undefined>(null);
  @Input() currentUserId = '';

  @Output() loadOlder = new EventEmitter<string | null | undefined>();
  @Output() editMessage = new EventEmitter<{ id: string; body_html: string }>();
  @Output() deleteMsg = new EventEmitter<string>();

  readonly editState = signal<EditState | null>(null);
  private editHtmlBuffer = '';

  ngOnChanges(_changes: SimpleChanges): void { /* trigger CD */ }

  sanitize(html: string): SafeHtml {
    const clean = (DOMPurify as { sanitize: (html: string) => string }).sanitize(html);
    return this.sanitizer.bypassSecurityTrustHtml(clean);
  }

  isOwnMessage(authorId: string): boolean {
    return !!this.currentUserId && authorId === this.currentUserId;
  }

  startEdit(msg: Message): void {
    this.editState.set({ messageId: msg.id, html: msg.body_html });
    this.editHtmlBuffer = msg.body_html;
  }

  onEditInput(event: Event): void {
    this.editHtmlBuffer = (event.target as HTMLElement).innerHTML;
  }

  saveEdit(messageId: string): void {
    this.editMessage.emit({ id: messageId, body_html: this.editHtmlBuffer });
    this.editState.set(null);
  }
}
