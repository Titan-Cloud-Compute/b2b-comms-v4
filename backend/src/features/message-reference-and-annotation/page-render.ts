/**
 * Page-image rendering for GET /api/file-versions/:id/pages/:page.
 *
 * - Images: the stored bytes are returned as-is (page 1 only).
 * - PDFs: a PNG of the requested page is produced at the page's MediaBox aspect
 *   ratio. No native rasteriser (canvas / poppler) ships with the backend image,
 *   so the PNG is a blank page surface sized like the PDF page; the annotation
 *   overlay is drawn on top of it client-side in normalised (0..1) coordinates.
 */
import { deflateSync } from 'zlib';
import { referenceKind } from './reference.policy';

export class PageOutOfRangeError extends Error {
  constructor(public readonly pageCount: number) {
    super(`Page out of range (document has ${pageCount} page${pageCount === 1 ? '' : 's'}).`);
  }
}

export class UnsupportedPageSourceError extends Error {
  constructor() {
    super('Only PDF and image files can be referenced');
  }
}

export interface RenderedPage {
  contentType: string;
  body: Buffer;
}

const MAX_RENDER_DIM = 1600;

/** Counts `/Type /Page` objects (not `/Pages`) in a PDF buffer. Falls back to /Count. */
export function countPdfPages(pdf: Buffer): number {
  const text = pdf.toString('latin1');
  const pages = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
  if (pages > 0) return pages;
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  return counts.length ? Math.max(...counts) : 0;
}

/** Width/height in PDF points of the first MediaBox found (defaults to US Letter). */
export function pdfPageSize(pdf: Buffer): { width: number; height: number } {
  const m = pdf
    .toString('latin1')
    .match(/\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/);
  if (m) {
    const w = Math.abs(Number(m[3]) - Number(m[1]));
    const h = Math.abs(Number(m[4]) - Number(m[2]));
    if (w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h)) return { width: w, height: h };
  }
  return { width: 612, height: 792 };
}

// ─── minimal PNG encoder ──────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Encodes a white RGB page with a 1px grey border. */
export function blankPagePng(width: number, height: number): Buffer {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const rowLen = 1 + w * 3;
  const raw = Buffer.alloc(rowLen * h, 0xff);
  for (let y = 0; y < h; y++) {
    raw[y * rowLen] = 0; // filter: none
    const border = y === 0 || y === h - 1;
    for (let x = 0; x < w; x++) {
      if (border || x === 0 || x === w - 1) {
        const o = y * rowLen + 1 + x * 3;
        raw[o] = raw[o + 1] = raw[o + 2] = 0xcc;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Renders one page of a referenceable file. Throws PageOutOfRangeError / UnsupportedPageSourceError. */
export function renderPage(source: Buffer, mime: string | null | undefined, page: number, name?: string | null): RenderedPage {
  const kind = referenceKind(mime, name);
  if (!kind) throw new UnsupportedPageSourceError();
  if (!Number.isInteger(page) || page < 1) throw new PageOutOfRangeError(kind === 'image' ? 1 : countPdfPages(source));
  if (kind === 'image') {
    if (page !== 1) throw new PageOutOfRangeError(1);
    const ct = (mime ?? '').toLowerCase().split(';')[0].trim();
    return { contentType: ct.startsWith('image/') ? (ct === 'image/jpg' ? 'image/jpeg' : ct) : 'image/png', body: source };
  }
  const pageCount = countPdfPages(source);
  if (pageCount < 1 || page > pageCount) throw new PageOutOfRangeError(pageCount);
  const size = pdfPageSize(source);
  const scale = Math.min(1.5, MAX_RENDER_DIM / Math.max(size.width, size.height));
  return { contentType: 'image/png', body: blankPagePng(size.width * scale, size.height * scale) };
}
