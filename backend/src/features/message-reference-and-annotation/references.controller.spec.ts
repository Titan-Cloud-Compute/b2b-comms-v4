import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  StreamableFile,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ReferencesController } from './references.controller';
import { ReferencesService } from './references.service';
import { PNG_SIGNATURE } from './page-render';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

let seq = 0;
function model() {
  const rows: Row[] = [];
  const match = (r: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => (r[k] ?? null) === v);
  return {
    rows,
    async findUnique(a: Row) { const r = rows.find((x) => match(x, a.where)); return r ? { ...r } : null; },
    async findFirst(a: Row = {}) { const r = rows.find((x) => match(x, a.where)); return r ? { ...r } : null; },
    async create(a: Row) { const r = { id: `id-${++seq}`, ...a.data }; rows.push(r); return { ...r }; },
    async update(a: Row) {
      const r = rows.find((x) => match(x, a.where));
      if (!r) throw new Error('not found');
      Object.assign(r, a.data);
      return { ...r };
    },
    async delete(a: Row) {
      const i = rows.findIndex((x) => match(x, a.where));
      if (i < 0) throw new Error('not found');
      return rows.splice(i, 1)[0];
    },
  };
}

function fakeDb() {
  return {
    projects: model(),
    project_members: model(),
    channels: model(),
    messages: model(),
    files: model(),
    file_versions: model(),
    references: model(),
  };
}

const PDF = Buffer.from(
  ['%PDF-1.4', '2 0 obj << /Type /Pages /Count 2 /MediaBox [0 0 612 792] >> endobj',
    '3 0 obj << /Type /Page >> endobj', '4 0 obj << /Type /Page >> endobj', '%%EOF'].join('\n'),
  'latin1',
);

const req = (userId?: string) => ({ session: userId ? { userId, role: 'USER' } : undefined }) as unknown as Request;
const ann = { text_boxes: [{ x: 0.1, y: 0.1, text: 'Look here' }], drawings: [{ points: [[0.2, 0.2], [0.3, 0.4]] }] };

describe('ReferencesController', () => {
  let db: ReturnType<typeof fakeDb>;
  let ctrl: ReferencesController;
  let message: Row;
  let pdfFile: Row;
  let v1: Row;
  let docx: Row;
  let docxV: Row;

  beforeEach(async () => {
    db = fakeDb();
    const storage = { getObjectBuffer: jest.fn(async () => PDF) };
    ctrl = new ReferencesController(new ReferencesService(db as any, storage as any));
    const project = await db.projects.create({ data: { name: 'P', created_by: 'owner' } });
    for (const u of ['author', 'viewer']) await db.project_members.create({ data: { project_id: project.id, user_id: u } });
    const ch = await db.channels.create({ data: { project_id: project.id, kind: 'general' } });
    message = await db.messages.create({ data: { channel_id: ch.id, author_id: 'author', body_html: '<p>see</p>', deleted_at: null } });
    pdfFile = await db.files.create({ data: { project_id: project.id, name: 'plan.pdf', mime_type: 'application/pdf', deleted_at: null } });
    v1 = await db.file_versions.create({ data: { file_id: pdfFile.id, version_number: 1, storage_key: 'k1' } });
    await db.files.update({ where: { id: pdfFile.id }, data: { current_version_id: v1.id } });
    docx = await db.files.create({ data: { project_id: project.id, name: 'a.docx', mime_type: 'application/msword', deleted_at: null } });
    docxV = await db.file_versions.create({ data: { file_id: docx.id, version_number: 1, storage_key: 'k2' } });
  });

  const createRef = () =>
    ctrl.create(message.id, { file_version_id: v1.id, page_number: 2, annotations: ann }, req('author'));

  it('author creates a reference (stored with annotations, page_number, file_version_id)', async () => {
    const res = await createRef();
    expect(res).toEqual(expect.objectContaining({
      message_id: message.id, file_version_id: v1.id, page_number: 2, author_id: 'author',
    }));
    expect(res.annotations).toEqual(ann);
    expect(db.references.rows).toHaveLength(1);
    await expect(createRef()).rejects.toBeInstanceOf(ConflictException);
  });

  it('pins the current version when only file_id is given', async () => {
    const res = await ctrl.create(message.id, { file_id: pdfFile.id, page_number: 1, annotations: ann }, req('author'));
    expect(res.file_version_id).toBe(v1.id);
  });

  it('rejects unsupported files, empty and malformed annotations with 400 and stores nothing', async () => {
    await expect(ctrl.create(message.id, { file_version_id: docxV.id, page_number: 1, annotations: ann }, req('author')))
      .rejects.toThrow('Only PDF and image files can be referenced');
    await expect(ctrl.create(message.id, { file_version_id: v1.id, page_number: 1, annotations: { text_boxes: [], drawings: [] } }, req('author')))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(ctrl.create(message.id, { file_version_id: v1.id, page_number: 1, annotations: 'garbage' }, req('author')))
      .rejects.toBeInstanceOf(BadRequestException);
    const huge = { text_boxes: [{ x: 0, y: 0, text: 'x'.repeat(1024 * 1024 + 10) }], drawings: [] };
    await expect(ctrl.create(message.id, { file_version_id: v1.id, page_number: 1, annotations: huge }, req('author')))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(db.references.rows).toHaveLength(0);
  });

  it('viewer gets the reference read-only; author gets can_edit', async () => {
    const created = await createRef();
    const asViewer = await ctrl.get(created.id, req('viewer'));
    expect(asViewer).toEqual(expect.objectContaining({ id: created.id, file_available: true, can_edit: false, page_number: 2 }));
    expect((await ctrl.get(created.id, req('author'))).can_edit).toBe(true);
  });

  it('viewer PUT / DELETE are 403 and nothing changes', async () => {
    const created = await createRef();
    await expect(ctrl.update(created.id, { annotations: ann }, req('viewer'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctrl.remove(created.id, req('viewer'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.references.rows).toHaveLength(1);
  });

  it('author edits annotations; updated_at moves and viewers see the new version', async () => {
    const created = await createRef();
    const before = db.references.rows[0].updated_at as Date;
    await new Promise((r) => setTimeout(r, 5));
    const next = { text_boxes: [{ x: 0.5, y: 0.5, text: 'Updated' }], drawings: [] };
    const res = await ctrl.update(created.id, { annotations: next }, req('author'));
    expect(res).toEqual(expect.objectContaining({ id: created.id, page_number: 2, annotations: next }));
    expect((res.updated_at as Date).getTime()).toBeGreaterThan(before.getTime());
    expect((await ctrl.get(created.id, req('viewer'))).annotations).toEqual(next);
    await expect(ctrl.update(created.id, { annotations: { drawings: 7 } }, req('author'))).rejects.toBeInstanceOf(BadRequestException);
    expect(db.references.rows[0].annotations).toEqual(next);
  });

  it('author deletes the reference', async () => {
    const created = await createRef();
    await ctrl.remove(created.id, req('author'));
    expect(db.references.rows).toHaveLength(0);
  });

  it('new file versions do not move the pinned file_version_id', async () => {
    const created = await createRef();
    const v2 = await db.file_versions.create({ data: { file_id: pdfFile.id, version_number: 2, storage_key: 'k3' } });
    await db.files.update({ where: { id: pdfFile.id }, data: { current_version_id: v2.id } });
    expect((await ctrl.get(created.id, req('viewer'))).file_version_id).toBe(v1.id);
    expect(db.references.rows[0].file_version_id).toBe(v1.id);
  });

  it('deleted file → 200 with file_available false', async () => {
    const created = await createRef();
    await db.files.update({ where: { id: pdfFile.id }, data: { deleted_at: new Date() } });
    const res = await ctrl.get(created.id, req('viewer'));
    expect(res.file_available).toBe(false);
  });

  it('non-members get 403, unauthenticated get 401', async () => {
    const created = await createRef();
    await expect(ctrl.get(created.id, req('stranger'))).rejects.toBeInstanceOf(ForbiddenException);
    const res = { setHeader: jest.fn() } as unknown as Response;
    await expect(ctrl.page(v1.id, '1', req('stranger'), res)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctrl.get(created.id, req())).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(ctrl.create(message.id, { file_version_id: v1.id, annotations: ann }, req())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('serves the referenced page as an image', async () => {
    const res = { setHeader: jest.fn() } as unknown as Response;
    const out = await ctrl.page(v1.id, '2', req('viewer'), res);
    expect(out).toBeInstanceOf(StreamableFile);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    await expect(ctrl.page(v1.id, '3', req('viewer'), res)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('unknown reference → 404', async () => {
    await expect(ctrl.get('missing', req('viewer'))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('exposes the PNG signature constant', () => {
    expect(PNG_SIGNATURE.length).toBe(8);
  });
});
