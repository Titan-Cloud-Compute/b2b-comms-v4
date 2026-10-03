import {
  Component,
  ElementRef,
  EventEmitter,
  Output,
  ViewChild,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/**
 * Rich-text message composer with a contenteditable region and a toolbar
 * (Bold, Italic, Bulleted list, Numbered list, Link).
 *
 * Emits `send` with the current innerHTML when the user clicks Send or presses
 * Enter (Shift+Enter inserts a newline instead).
 */
@Component({
  selector: 'app-message-composer',
  standalone: true,
  template: `
    <div class="composer" data-testid="message-composer-wrapper">
      <div class="toolbar">
        <button type="button" data-testid="bold-btn" (click)="bold()" title="Bold"><b>B</b></button>
        <button type="button" data-testid="italic-btn" (click)="italic()" title="Italic"><i>I</i></button>
        <button type="button" data-testid="ul-btn" (click)="insertUl()" title="Bullet list">• List</button>
        <button type="button" data-testid="ol-btn" (click)="insertOl()" title="Numbered list">1. List</button>
        <button type="button" data-testid="link-btn" (click)="insertLink()" title="Link">Link</button>
      </div>
      <div
        #editor
        class="editor"
        data-testid="message-composer"
        contenteditable="true"
        role="textbox"
        aria-multiline="true"
        aria-label="Message"
        (input)="onInput()"
        (keydown)="onKeydown($event)"
      ></div>
      <button
        type="button"
        data-testid="send-btn"
        [disabled]="isEmpty()"
        (click)="doSend()"
      >Send</button>
    </div>
  `,
  styles: [`
    .composer { display: flex; flex-direction: column; gap: 4px; border: 1px solid #ccc; border-radius: 4px; padding: 8px; }
    .toolbar { display: flex; gap: 4px; }
    .toolbar button { cursor: pointer; padding: 2px 6px; }
    .editor { min-height: 60px; border: 1px solid #e0e0e0; border-radius: 2px; padding: 4px; outline: none; }
    button[disabled] { opacity: 0.5; cursor: default; }
  `],
})
export class MessageComposerComponent {
  @ViewChild('editor') editorRef!: ElementRef<HTMLDivElement>;
  @Output() send = new EventEmitter<string>();

  readonly isEmpty = signal(true);

  onInput(): void {
    const text = this.editorRef?.nativeElement?.textContent?.trim() ?? '';
    this.isEmpty.set(text.length === 0);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!this.isEmpty()) {
        this.doSend();
      }
    }
  }

  bold(): void {
    this.editorRef.nativeElement.focus();
    this.wrapSelection('strong');
  }

  italic(): void {
    this.editorRef.nativeElement.focus();
    this.wrapSelection('em');
  }

  insertUl(): void {
    this.editorRef.nativeElement.focus();
    document.execCommand('insertUnorderedList', false);
  }

  insertOl(): void {
    this.editorRef.nativeElement.focus();
    document.execCommand('insertOrderedList', false);
  }

  insertLink(): void {
    const url = prompt('URL:');
    if (!url) return;
    this.editorRef.nativeElement.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const a = document.createElement('a');
    a.href = url;
    a.textContent = sel.isCollapsed ? url : range.toString();
    if (!sel.isCollapsed) {
      range.deleteContents();
    }
    range.insertNode(a);
    sel.removeAllRanges();
    const r = document.createRange();
    r.setStartAfter(a);
    r.collapse(true);
    sel.addRange(r);
    this.onInput();
  }

  /** Wraps the current selection in the given tag, or the whole content if collapsed. */
  private wrapSelection(tag: string): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const el = document.createElement(tag);
    if (sel.isCollapsed) {
      // Nothing selected — insert an empty element and let the user type
      el.innerHTML = '​';
      range.insertNode(el);
      sel.removeAllRanges();
      const r = document.createRange();
      r.setStart(el, 0);
      r.setEnd(el, el.childNodes.length);
      sel.addRange(r);
    } else {
      try {
        const frag = range.extractContents();
        el.appendChild(frag);
        range.insertNode(el);
        sel.removeAllRanges();
        const r = document.createRange();
        r.selectNodeContents(el);
        sel.addRange(r);
      } catch {
        // surroundContents can fail for cross-element selections; fallback
        document.execCommand(tag === 'strong' ? 'bold' : 'italic', false);
      }
    }
    this.onInput();
  }

  doSend(): void {
    const html = this.editorRef.nativeElement.innerHTML;
    if (!html.trim() || !this.editorRef.nativeElement.textContent?.trim()) return;
    this.send.emit(html);
    this.editorRef.nativeElement.innerHTML = '';
    this.isEmpty.set(true);
  }
}
