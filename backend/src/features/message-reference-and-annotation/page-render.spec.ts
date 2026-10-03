import { inflateSync } from 'zlib';
import {
  PNG_SIGNATURE,
  PageOutOfRangeError,
  UnsupportedPageSourceError,
  blankPagePng,
  countPdfPages,
  pdfPageSize,
  renderPage,
} from './page-render';

function fakePdf(pages: number, mediaBox = '0 0 595 842'): Buffer {
  const objs: string[] = ['%PDF-1.4', `1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj`];
  objs.push(`2 0 obj << /Type /Pages /Count ${pages} /Kids [] /MediaBox [${mediaBox}] >> endobj`);
  for (let i = 0; i < pages; i++) objs.push(`${3 + i} 0 obj << /Type /Page /Parent 2 0 R >> endobj`);
  objs.push('%%EOF');
  return Buffer.from(objs.join('\n'), 'latin1');
}

function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe('page-render', () => {
  it('counts PDF pages without matching /Pages', () => {
    expect(countPdfPages(fakePdf(1))).toBe(1);
    expect(countPdfPages(fakePdf(100))).toBe(100);
  });

  it('reads the MediaBox size', () => {
    expect(pdfPageSize(fakePdf(1))).toEqual({ width: 595, height: 842 });
    expect(pdfPageSize(Buffer.from('%PDF-1.4'))).toEqual({ width: 612, height: 792 });
  });

  it('encodes a valid PNG', () => {
    const png = blankPagePng(10, 20);
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(pngSize(png)).toEqual({ width: 10, height: 20 });
    // IDAT payload inflates to height * (1 + width * 3) bytes
    const idatLen = png.readUInt32BE(33);
    expect(png.subarray(37, 41).toString('ascii')).toBe('IDAT');
    expect(inflateSync(png.subarray(41, 41 + idatLen)).length).toBe(20 * (1 + 10 * 3));
  });

  it('renders one page of a 100-page PDF as PNG at the page aspect ratio', () => {
    const out = renderPage(fakePdf(100), 'application/pdf', 57);
    expect(out.contentType).toBe('image/png');
    expect(out.body.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    const { width, height } = pngSize(out.body);
    expect(Math.abs(width / height - 595 / 842)).toBeLessThan(0.01);
  });

  it('rejects out-of-range PDF pages', () => {
    expect(() => renderPage(fakePdf(3), 'application/pdf', 4)).toThrow(PageOutOfRangeError);
    expect(() => renderPage(fakePdf(3), 'application/pdf', 0)).toThrow(PageOutOfRangeError);
  });

  it('returns image bytes as-is for page 1 only', () => {
    const img = Buffer.concat([PNG_SIGNATURE, Buffer.from('rest')]);
    const out = renderPage(img, 'image/png', 1);
    expect(out).toEqual({ contentType: 'image/png', body: img });
    expect(renderPage(img, 'image/jpg', 1).contentType).toBe('image/jpeg');
    expect(() => renderPage(img, 'image/png', 2)).toThrow(PageOutOfRangeError);
  });

  it('rejects unsupported files', () => {
    expect(() => renderPage(Buffer.from('hi'), 'text/plain', 1, 'a.txt')).toThrow(UnsupportedPageSourceError);
  });

  it('renders a 100-page PDF page quickly (NFR)', () => {
    const pdf = fakePdf(100);
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) renderPage(pdf, 'application/pdf', 100);
    expect((Date.now() - t0) / 20).toBeLessThan(2000);
  });
});
