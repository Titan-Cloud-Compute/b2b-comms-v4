import {
  MAX_ANNOTATION_BYTES,
  UNSUPPORTED_FILE_MESSAGE,
  canAccessProject,
  canEditReference,
  isFileAvailable,
  isReferenceable,
  referenceKind,
  validateAnnotations,
  validatePageNumber,
} from './reference.policy';

describe('reference.policy', () => {
  it('only PDFs and images are referenceable', () => {
    expect(referenceKind('application/pdf')).toBe('pdf');
    expect(referenceKind('image/png')).toBe('image');
    expect(referenceKind('image/jpeg; charset=binary')).toBe('image');
    expect(referenceKind(null, 'scan.PDF')).toBe('pdf');
    expect(isReferenceable('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx')).toBe(false);
    expect(isReferenceable('text/plain', 'notes.txt')).toBe(false);
    expect(UNSUPPORTED_FILE_MESSAGE).toBe('Only PDF and image files can be referenced');
  });

  it('accepts text boxes and drawings and normalises them', () => {
    const r = validateAnnotations({
      text_boxes: [{ x: 0.1, y: 0.2, text: 'Check this', extra: 'dropped' }],
      drawings: [{ points: [[0, 0], [0.5, 0.5]], color: '#f00', width: 3 }],
    });
    expect(r).toEqual({
      ok: true,
      value: {
        text_boxes: [{ x: 0.1, y: 0.2, text: 'Check this' }],
        drawings: [{ points: [[0, 0], [0.5, 0.5]], color: '#f00', width: 3 }],
      },
    });
  });

  it('rejects empty annotations', () => {
    expect(validateAnnotations({ text_boxes: [], drawings: [] }).ok).toBe(false);
    expect(validateAnnotations({}).ok).toBe(false);
  });

  it('rejects malformed payloads', () => {
    expect(validateAnnotations(null).ok).toBe(false);
    expect(validateAnnotations('x').ok).toBe(false);
    expect(validateAnnotations([]).ok).toBe(false);
    expect(validateAnnotations({ text_boxes: 'nope' }).ok).toBe(false);
    expect(validateAnnotations({ text_boxes: [{ x: 2, y: 0, text: 'a' }] }).ok).toBe(false);
    expect(validateAnnotations({ text_boxes: [{ x: 0, y: 0, text: '  ' }] }).ok).toBe(false);
    expect(validateAnnotations({ drawings: [{ points: [[0, 'a']] }] }).ok).toBe(false);
    expect(validateAnnotations({ drawings: [{ points: [] }] }).ok).toBe(false);
  });

  it('rejects payloads over 1 MB', () => {
    const big = { text_boxes: [{ x: 0, y: 0, text: 'a', pad: 'x'.repeat(MAX_ANNOTATION_BYTES) }], drawings: [] };
    const r = validateAnnotations(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/1 MB/);
  });

  it('validates page numbers', () => {
    expect(validatePageNumber(3, 'pdf', 100)).toEqual({ ok: true, value: 3 });
    expect(validatePageNumber('7', 'pdf')).toEqual({ ok: true, value: 7 });
    expect(validatePageNumber(0, 'pdf').ok).toBe(false);
    expect(validatePageNumber(1.5, 'pdf').ok).toBe(false);
    expect(validatePageNumber(101, 'pdf', 100).ok).toBe(false);
    expect(validatePageNumber(1, 'image')).toEqual({ ok: true, value: 1 });
    expect(validatePageNumber(2, 'image').ok).toBe(false);
  });

  it('only the author can edit', () => {
    expect(canEditReference('u1', { author_id: 'u1' })).toBe(true);
    expect(canEditReference('u2', { author_id: 'u1' })).toBe(false);
    expect(canEditReference(undefined, { author_id: 'u1' })).toBe(false);
    expect(canEditReference('u1', { author_id: null })).toBe(false);
  });

  it('project access requires membership or ownership', () => {
    expect(canAccessProject({ actorId: 'u1', projectCreatedBy: 'u9', isMember: true })).toBe(true);
    expect(canAccessProject({ actorId: 'u1', projectCreatedBy: 'u1', isMember: false })).toBe(true);
    expect(canAccessProject({ actorId: 'u1', projectCreatedBy: 'u9', isMember: false })).toBe(false);
    expect(canAccessProject({ actorId: null, projectCreatedBy: null, isMember: true })).toBe(false);
  });

  it('file availability follows deletion and stored content', () => {
    expect(isFileAvailable({ version: { storage_key: 'k' }, file: { deleted_at: null } })).toBe(true);
    expect(isFileAvailable({ version: { storage_key: 'k' }, file: { deleted_at: new Date() } })).toBe(false);
    expect(isFileAvailable({ version: null, file: { deleted_at: null } })).toBe(false);
    expect(isFileAvailable({ version: { storage_key: 'k' }, file: null })).toBe(false);
  });
});
