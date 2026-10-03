import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { Annotations, Drawing } from './references.api';

export type AnnotationTool = 'text' | 'draw';

/**
 * Page image with an SVG/HTML annotation overlay. Coordinates are normalised (0..1)
 * so the overlay lines up at any rendered size. Read-only unless `editable`.
 */
@Component({
  selector: 'app-annotation-surface',
  standalone: true,
  template: `
    <div class="surface" data-testid="reference-surface" #surface
         [class.editable]="editable"
         (pointerdown)="onDown($event)" (pointermove)="onMove($event)" (pointerup)="onUp()" (pointerleave)="onUp()">
      @if (imageUrl && !imageFailed) {
        <img class="page" [src]="imageUrl" alt="Referenced page {{ page }}" data-testid="reference-page-image"
             draggable="false" (error)="imageFailed = true" />
      } @else {
        <div class="page blank" data-testid="reference-page-blank">Page {{ page }}</div>
      }
      <svg class="overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none" data-testid="reference-overlay">
        @for (d of annotations.drawings; track $index) {
          <polyline data-testid="reference-drawing" [attr.points]="pointsAttr(d)" fill="none"
                    [attr.stroke]="d.color || '#d32f2f'" [attr.stroke-width]="d.width || 3"
                    vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" />
        }
        @if (current) {
          <polyline [attr.points]="pointsAttr(current)" fill="none" stroke="#d32f2f" stroke-width="3"
                    vector-effect="non-scaling-stroke" />
        }
      </svg>
      @for (t of annotations.text_boxes; track $index) {
        <div class="text-box" data-testid="reference-text-box"
             [style.left.%]="t.x * 100" [style.top.%]="t.y * 100"
             [style.max-width.%]="(t.width || 0.4) * 100" [style.color]="t.color || null">
          {{ t.text }}
          @if (editable) {
            <button type="button" class="rm" data-testid="reference-remove-text" (pointerdown)="$event.stopPropagation()"
                    (click)="removeText($index)" aria-label="Remove text box">×</button>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .surface { position: relative; width: 100%; user-select: none; touch-action: none; }
    .surface.editable { cursor: crosshair; }
    .page { display: block; width: 100%; height: auto; }
    .page.blank { aspect-ratio: 612 / 792; background: #fff; border: 1px solid #ccc; color: #999;
                  display: flex; align-items: center; justify-content: center; }
    .overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
    .text-box { position: absolute; background: rgba(255, 245, 157, 0.92); border: 1px solid #c9b400;
                padding: 2px 6px; font-size: 13px; color: #222; border-radius: 3px; white-space: pre-wrap; }
    .rm { margin-left: 4px; border: none; background: transparent; cursor: pointer; }
  `],
})
export class AnnotationSurfaceComponent {
  private _imageUrl: string | null = null;
  @Input() set imageUrl(v: string | null) {
    this._imageUrl = v;
    this.imageFailed = false;
  }
  get imageUrl(): string | null {
    return this._imageUrl;
  }
  @Input() page = 1;
  @Input() annotations: Annotations = { text_boxes: [], drawings: [] };
  @Input() editable = false;
  @Input() tool: AnnotationTool = 'draw';
  @Input() pendingText = '';
  @Output() annotationsChange = new EventEmitter<Annotations>();

  @ViewChild('surface', { static: true }) surface!: ElementRef<HTMLDivElement>;

  imageFailed = false;
  current: Drawing | null = null;

  pointsAttr(d: Drawing): string {
    return d.points.map(([x, y]) => `${(x * 1000).toFixed(1)},${(y * 1000).toFixed(1)}`).join(' ');
  }

  private pos(ev: PointerEvent): [number, number] {
    const r = this.surface.nativeElement.getBoundingClientRect();
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    return [clamp((ev.clientX - r.left) / (r.width || 1)), clamp((ev.clientY - r.top) / (r.height || 1))];
  }

  onDown(ev: PointerEvent): void {
    if (!this.editable) return;
    const [x, y] = this.pos(ev);
    if (this.tool === 'text') {
      const text = this.pendingText.trim();
      if (!text) return;
      this.emit({ ...this.annotations, text_boxes: [...this.annotations.text_boxes, { x, y, width: 0.35, text }] });
      return;
    }
    this.current = { points: [[x, y]], color: '#d32f2f', width: 3 };
  }

  onMove(ev: PointerEvent): void {
    if (!this.current) return;
    this.current.points.push(this.pos(ev));
  }

  onUp(): void {
    if (!this.current) return;
    const d = this.current;
    this.current = null;
    if (d.points.length === 1) d.points.push([d.points[0][0], d.points[0][1]]);
    this.emit({ ...this.annotations, drawings: [...this.annotations.drawings, d] });
  }

  removeText(i: number): void {
    this.emit({ ...this.annotations, text_boxes: this.annotations.text_boxes.filter((_, j) => j !== i) });
  }

  private emit(a: Annotations): void {
    this.annotations = a;
    this.annotationsChange.emit(a);
  }
}
