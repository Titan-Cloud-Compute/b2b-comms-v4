import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import DOMPurify from 'dompurify';
import { MessageItem, OutboxItem } from './general-channels.types';

/**
 * MessageListComponent — renders the message history for a channel.
 *
 * - HTML bodies are sanitized with DOMPurify before Angular's own [innerHTML]
 *   sanitizer also runs, providing defence-in-depth against XSS.
 * - Pending outbox items are shown below confirmed messages with a
 *   data-testid="pending-label" badge.
 * - The author's own messages expose Edit / Delete controls.
 */
@Component({
  selector: 'app-message-list',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="msg-list" data-testid="message-list">
      @if (nextCursor) {
        <button class="load-older-btn" data-testid="load-older" (click)="loadOlder.emit()">
          Load older
        </button>
      }

      @for (msg of messages; track msg.id) {
        <div class="msg-item" data-testid="message-item">
          <div class="msg-meta">
            <span class="msg-author">{{ msg.author?.display_name }}</span>
            <span class="msg-time">{{ msg.created_at | date:'short' }}</span>
            @if (msg.edited_at) {
              <span class="msg-edited" data-testid="edited-label">(edited)</span>
            }
          </div>

          <div class="msg-body" data-testid="message-body" [innerHTML]="sanitize(msg.body_html)"></div>

          @if (msg.attachments?.length) {
            <div class="msg-attachments">
              @for (att of msg.attachments; track att.file_id) {
                <span class="msg-attachment">📎 {{ att.name }}</span>
              }
            </div>
          }

          @if (isOwn(msg)) {
            <div class="msg-actions" data-testid="message-actions">
              @if (editingId !== msg.id) {
                <button class="btn-sm" data-testid="edit-btn" (click)="startEdit(msg)">Edit</button>
                <button class="btn-sm btn-danger" data-testid="delete-btn"
                        (click)="deleteMsg.emit(msg.id)">Delete</button>
              } @else {
                <textarea class="edit-area" data-testid="edit-field"
                          [(ngModel)]="editText"
                          rows="3"></textarea>
                <button class="btn-sm" data-testid="save-edit-btn"
                        (click)="commitEdit(msg.id)">Save</button>
                <button class="btn-sm" data-testid="cancel-edit-btn"
                        (click)="cancelEdit()">Cancel</button>
              }
            </div>
          }
        </div>
      }

      @for (item of pendingItems; track item.temp_id) {
        <div class="msg-item msg-pending" data-testid="pending-item">
          <div class="msg-body" data-testid="message-body" [innerHTML]="sanitize(item.body_html)"></div>
          <span class="msg-pending-label" data-testid="pending-label">pending</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .msg-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px;
      overflow-y: auto;
      flex: 1;
    }
    .msg-item {
      border-bottom: 1px solid #e5e7eb;
      padding: 8px 0;
    }
    .msg-meta {
      font-size: 12px;
      color: #6b7280;
      display: flex;
      gap: 8px;
      margin-bottom: 4px;
      align-items: center;
    }
    .msg-author { font-weight: 600; color: #374151; }
    .msg-edited { font-style: italic; color: #9ca3af; }
    .msg-body { font-size: 14px; line-height: 1.5; }
    .msg-actions {
      display: flex;
      gap: 6px;
      margin-top: 6px;
      align-items: flex-start;
      flex-wrap: wrap;
    }
    .btn-sm {
      font-size: 12px;
      padding: 2px 8px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      background: #f9fafb;
      cursor: pointer;
    }
    .btn-danger { color: #dc2626; border-color: #fca5a5; }
    .edit-area {
      width: 100%;
      font-size: 14px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      padding: 6px;
    }
    .msg-pending { opacity: 0.65; }
    .msg-pending-label {
      font-size: 12px;
      color: #9ca3af;
      font-style: italic;
      margin-top: 2px;
    }
    .load-older-btn {
      align-self: center;
      font-size: 13px;
      padding: 4px 12px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      background: #fff;
      cursor: pointer;
    }
  `],
})
export class MessageListComponent implements OnChanges {
  @Input() messages: MessageItem[] = [];
  @Input() pendingItems: OutboxItem[] = [];
  @Input() currentUserId = '';
  @Input() nextCursor: string | null = null;

  @Output() loadOlder = new EventEmitter<void>();
  @Output() deleteMsg = new EventEmitter<string>();
  @Output() saveEdit = new EventEmitter<{ id: string; body_html: string }>();

  editingId: string | null = null;
  editText = '';

  ngOnChanges(changes: SimpleChanges): void {
    // If the message being edited was removed from the list, clear edit state.
    if (changes['messages'] && this.editingId) {
      const still = this.messages.find(m => m.id === this.editingId);
      if (!still) this.cancelEdit();
    }
  }

  sanitize(html: string): string {
    return DOMPurify.sanitize(html ?? '');
  }

  isOwn(msg: MessageItem): boolean {
    return !!this.currentUserId && msg.author?.id === this.currentUserId;
  }

  startEdit(msg: MessageItem): void {
    this.editingId = msg.id;
    // Strip tags for plain-text editing
    const div = document.createElement('div');
    div.innerHTML = msg.body_html ?? '';
    this.editText = div.textContent ?? '';
  }

  commitEdit(id: string): void {
    const body_html = `<p>${this.editText}</p>`;
    this.saveEdit.emit({ id, body_html });
    this.editingId = null;
    this.editText = '';
  }

  cancelEdit(): void {
    this.editingId = null;
    this.editText = '';
  }
}
