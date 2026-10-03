/**
 * Message Reference and Annotation — pure validation + access-policy helpers.
 * No I/O here so every rule is unit-testable (reference.policy.spec.ts).
 */

export const MAX_ANNOTATION_BYTES = 1024 * 1024; // 1 MB
export const MAX_TEXT_BOXES = 500;
export const MAX_DRAWINGS = 500;
export const MAX_POINTS_PER_DRAWING = 5000;
export const MAX_TEXT_LENGTH = 2000;

export const UNSUPPORTED_FILE_MESSAGE = 'Only PDF and image files can be referenced';
export const EMPTY_ANNOTATIONS_MESSAGE = 'Add at least one text box or drawing before saving.';

const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];

export type ReferenceKind = 'pdf' | 'image';

/** Text box with coordinates normalised to the page (0..1). */
export interface TextBox {
  x: number;
  y: number;
  width?: number;
  height?: number;
  text: string;
  color?: string;
}

/** Freehand stroke: list of [x, y] points normalised to the page (0..1). */
export interface Drawing {
  points: Array<[number, number]>;
  color?: string;
  width?: number;
}

export interface Annotations {
  text_boxes: TextBox[];
  drawings: Drawing[];
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function normMime(mime: string | null | undefined): string {
  return (mime ?? '').toLowerCase().split(';')[0].trim();
}

/** Returns 'pdf' | 'image' for referenceable files, null otherwise. */
export function referenceKind(mime: string | null | undefined, name?: string | null): ReferenceKind | null {
  const m = normMime(mime);
  const n = (name ?? '').toLowerCase();
  if (m === 'application/pdf') return 'pdf';
  if (IMAGE_MIME_TYPES.includes(m)) return 'image';
  if (!m || m === 'application/octet-stream') {
    if (n.endsWith('.pdf')) return 'pdf';
    if (IMAGE_EXTENSIONS.some((e) => n.endsWith(e))) return 'image';
  }
  return null;
}

export function isReferenceable(mime: string | null | undefined, name?: string | null): boolean {
  return referenceKind(mime, name) !== null;
}

function isUnit(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
}

function optColor(c: unknown): boolean {
  return c === undefined || c === null || (typeof c === 'string' && c.length <= 32);
}

/** Byte size of the JSON-serialised payload (UTF-8). */
export function annotationByteSize(raw: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(raw ?? null), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Validates an annotations payload: shape, coordinate ranges, size (≤ 1 MB) and
 * non-emptiness (at least one text box or drawing). Returns a normalised copy.
 */
export function validateAnnotations(raw: unknown): ValidationResult<Annotations> {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'annotations must be an object with text_boxes and drawings.' };
  }
  if (annotationByteSize(raw) > MAX_ANNOTATION_BYTES) {
    return { ok: false, error: 'annotations exceed the 1 MB limit.' };
  }
  const obj = raw as Record<string, unknown>;
  const tb = obj.text_boxes ?? [];
  const dr = obj.drawings ?? [];
  if (!Array.isArray(tb)) return { ok: false, error: 'text_boxes must be an array.' };
  if (!Array.isArray(dr)) return { ok: false, error: 'drawings must be an array.' };
  if (tb.length > MAX_TEXT_BOXES) return { ok: false, error: `At most ${MAX_TEXT_BOXES} text boxes are allowed.` };
  if (dr.length > MAX_DRAWINGS) return { ok: false, error: `At most ${MAX_DRAWINGS} drawings are allowed.` };

  const text_boxes: TextBox[] = [];
  for (const [i, b] of tb.entries()) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, error: `text_boxes[${i}] is invalid.` };
    const box = b as Record<string, unknown>;
    if (!isUnit(box.x) || !isUnit(box.y)) return { ok: false, error: `text_boxes[${i}] needs x and y between 0 and 1.` };
    if (box.width !== undefined && !isUnit(box.width)) return { ok: false, error: `text_boxes[${i}].width is invalid.` };
    if (box.height !== undefined && !isUnit(box.height)) return { ok: false, error: `text_boxes[${i}].height is invalid.` };
    if (typeof box.text !== 'string' || !box.text.trim()) return { ok: false, error: `text_boxes[${i}].text is required.` };
    if (box.text.length > MAX_TEXT_LENGTH) return { ok: false, error: `text_boxes[${i}].text is too long.` };
    if (!optColor(box.color)) return { ok: false, error: `text_boxes[${i}].color is invalid.` };
    const out: TextBox = { x: box.x, y: box.y, text: box.text };
    if (box.width !== undefined) out.width = box.width as number;
    if (box.height !== undefined) out.height = box.height as number;
    if (typeof box.color === 'string') out.color = box.color;
    text_boxes.push(out);
  }

  const drawings: Drawing[] = [];
  for (const [i, d] of dr.entries()) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, error: `drawings[${i}] is invalid.` };
    const draw = d as Record<string, unknown>;
    const pts = draw.points;
    if (!Array.isArray(pts) || pts.length < 1) return { ok: false, error: `drawings[${i}].points is required.` };
    if (pts.length > MAX_POINTS_PER_DRAWING) return { ok: false, error: `drawings[${i}] has too many points.` };
    const points: Array<[number, number]> = [];
    for (const p of pts) {
      if (!Array.isArray(p) || p.length !== 2 || !isUnit(p[0]) || !isUnit(p[1])) {
        return { ok: false, error: `drawings[${i}].points must be [x, y] pairs between 0 and 1.` };
      }
      points.push([p[0], p[1]]);
    }
    if (draw.width !== undefined && !(typeof draw.width === 'number' && draw.width > 0 && draw.width <= 50)) {
      return { ok: false, error: `drawings[${i}].width is invalid.` };
    }
    if (!optColor(draw.color)) return { ok: false, error: `drawings[${i}].color is invalid.` };
    const out: Drawing = { points };
    if (typeof draw.width === 'number') out.width = draw.width;
    if (typeof draw.color === 'string') out.color = draw.color;
    drawings.push(out);
  }

  if (text_boxes.length === 0 && drawings.length === 0) {
    return { ok: false, error: EMPTY_ANNOTATIONS_MESSAGE };
  }
  return { ok: true, value: { text_boxes, drawings } };
}

/** page_number must be a positive integer; images only have page 1; PDFs must be within pageCount when known. */
export function validatePageNumber(
  raw: unknown,
  kind: ReferenceKind,
  pageCount?: number | null,
): ValidationResult<number> {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
    return { ok: false, error: 'page_number must be a positive integer.' };
  }
  if (kind === 'image' && n !== 1) return { ok: false, error: 'Images only have page 1.' };
  if (kind === 'pdf' && pageCount && n > pageCount) {
    return { ok: false, error: `page_number must be between 1 and ${pageCount}.` };
  }
  return { ok: true, value: n };
}

export interface ReferenceOwnership {
  author_id?: string | null;
}

/** Only the author may edit or delete a reference. */
export function canEditReference(actorId: string | null | undefined, ref: ReferenceOwnership): boolean {
  return !!actorId && !!ref.author_id && ref.author_id === actorId;
}

export interface ProjectAccessFacts {
  actorId: string | null | undefined;
  projectCreatedBy: string | null | undefined;
  isMember: boolean;
}

/** Project creator or project_members row grants access; everyone else is denied. */
export function canAccessProject(f: ProjectAccessFacts): boolean {
  if (!f.actorId) return false;
  return f.isMember || (!!f.projectCreatedBy && f.projectCreatedBy === f.actorId);
}

export interface FileAvailabilityFacts {
  version: { storage_key?: string | null } | null | undefined;
  file: { deleted_at?: Date | string | null } | null | undefined;
}

export function isFileAvailable(f: FileAvailabilityFacts): boolean {
  return !!f.version && !!f.version.storage_key && !!f.file && !f.file.deleted_at;
}
