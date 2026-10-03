import {
  Component,
  ElementRef,
  EventEmitter,
  Output,
  ViewChild,
} from '@angular/core';

/**
 * MessageComposerComponent — rich-text message input.
 *
 * Provides a contenteditable area plus a formatting toolbar:
 *   Bold (Ctrl+B), Italic (Ctrl+I), Bulleted list, Numbered list, Link.
 *
 * Toolbar buttons use (mousedown).prevent to avoid stealing focus from the
 * editor so the current selection is preserved when a formatting command runs.
 *
 * Enter sends; Shift+Enter inserts a newline.
 */
@Component({
  selector: 'app-message-composer',
  standalone: true,
  template: `
    <div class="composer" data-testid="composer-container">
      <div class="toolbar" role="toolbar" aria-label="Formatting">
        <button type="button" class="tb-btn" aria-label="Bold"
                data-testid="bold-btn"
                (mousedown)="$event.preventDefault()"
                (click)="applyFormat('strong')"><b>B</b></button>
        <button type="button" class="tb-btn" aria-label="Italic"
                data-testid="italic-btn"
                (mousedown)="$event.preventDefault()"
                (click)="applyFormat('em')"><em>I</em></button>
        <button type="button" class="tb-btn" aria-label="Bulleted list"
                data-testid="ul-btn"
                (mousedown)="$event.preventDefault()"
                (click)="execCmd('insertUnorderedList')">• List</button>
        <button type="button" class="tb-btn" aria-label="Numbered list"
                data-testid="ol-btn"
                (mousedown)="$event.preventDefault()"
                (click)="execCmd('insertOrderedList')">1. List</button>
        <button type="button" class="tb-btn" aria-label="Link"
                data-testid="link-btn"
                (mousedown)="$event.preventDefault()"
                (click)="insertLink()">🔗</button>
      </div>

      <div #editorEl
           class="editor"
           contenteditable="true"
           role="textbox"
           aria-multiline="true"
           aria-label="Message"
           data-testid="message-composer"
           (keydown)="onKeydown($event)"
           (input)="onInput()"></div>

      <div class="composer-footer">
        <button type="button" class="send-btn"
                data-testid="send-btn"
                [disabled]="isEmpty"
                (click)="sendMessage()">Send</button>
      </div>
    </div>
  `,
  styles: [`
    .composer {
      border-top: 1px solid #e5e7eb;
      display: flex;
      flex-direction: column;
    }
    .toolbar {
      display: flex;
      gap: 4px;
      padding: 4px 8px;
      border-bottom: 1px solid #e5e7eb;
      background: #f9fafb;
    }
    .tb-btn {
      font-size: 13px;
      padding: 2px 8px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      background: #fff;
      cursor: pointer;
    }
    .tb-btn:hover { background: #f3f4f6; }
    .editor {
      min-height: 60px;
      max-height: 200px;
      overflow-y: auto;
      padding: 8px;
      font-size: 14px;
      line-height: 1.5;
      outline: none;
    }
    .editor:empty::before {
      content: attr(placeholder);
      color: #9ca3af;
      pointer-events: none;
    }
    .composer-footer {
      display: flex;
      justify-content: flex-end;
      padding: 4px 8px;
    }
    .send-btn {
      padding: 6px 16px;
      background: #2563eb;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
    }
    .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  `],
})
export class MessageComposerComponent {
  @Output() send = new EventEmitter<string>();
  @ViewChild('editorEl') editorEl!: ElementRef<HTMLDivElement>;

  isEmpty = true;

  onInput(): void {
    const text = this.editorEl?.nativeElement?.textContent ?? '';
    this.isEmpty = text.trim() === '';
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      if (event.key === 'b' || event.key === 'B') {
        event.preventDefault();
        this.applyFormat('strong');
        return;
      }
      if (event.key === 'i' || event.key === 'I') {
        event.preventDefault();
        this.applyFormat('em');
        return;
      }
    }
  }

  /**
   * Wrap the current selection in the given inline element tag.
   * Uses the Range API so <strong> is produced (not the deprecated <b> from execCommand).
   */
  applyFormat(tagName: string): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return;

    const wrapper = document.createElement(tagName);
    try {
      range.surroundContents(wrapper);
    } catch {
      // Range spans multiple block boundaries — extract and re-wrap.
      const fragment = range.extractContents();
      wrapper.appendChild(fragment);
      range.insertNode(wrapper);
    }
    // Restore selection to the wrapped content.
    sel.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(wrapper);
    sel.addRange(newRange);
    this.onInput();
  }

  execCmd(command: string): void {
    document.execCommand(command, false);
    this.onInput();
  }

  insertLink(): void {
    const url = window.prompt('URL:');
    if (!url) return;
    document.execCommand('createLink', false, url);
    this.onInput();
  }

  sendMessage(): void {
    const el = this.editorEl?.nativeElement;
    if (!el) return;
    const html = el.innerHTML.trim();
    if (!html || html === '<br>') return;
    this.send.emit(html);
    el.innerHTML = '';
    this.isEmpty = true;
  }
}
