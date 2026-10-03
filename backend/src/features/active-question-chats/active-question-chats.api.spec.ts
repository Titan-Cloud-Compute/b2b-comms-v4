/**
 * Active Question Chats — HTTP-level spec against an in-memory Prisma fake.
 * The JWT guard is replaced with a header-driven stub (x-test-user) so the
 * tests exercise routing, status codes, validation and the two-sided resolve flow.
 */
import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ActiveQuestionChatsController } from './active-question-chats.controller';
import { ActiveQuestionChatsService } from './active-question-chats.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && Array.isArray(v.in)) return v.in.includes(row[k]);
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

function table(rows: Row[], prefix: string) {
  let n = 0;
  return {
    rows,
    findUnique: jest.fn(async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null),
    findFirst: jest.fn(async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null),
    findMany: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matches(r, where))),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `${prefix}-${++n}`, createdAt: new Date(), ...data };
      rows.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      Object.assign(row!, data);
      return row;
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      const keep = rows.filter((r) => !matches(r, where));
      const count = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count };
    }),
  };
}

function makeDb() {
  const db: any = {
    organizations: table([
      { id: 'org-in', is_internal: true },
      { id: 'org-ex', is_internal: false },
    ], 'org'),
    user: table([
      { id: 'u-int', organization_id: 'org-in' },
      { id: 'u-ext', organization_id: 'org-ex' },
      { id: 'u-out', organization_id: 'org-in' },
    ], 'u'),
    projects: table([{ id: 'p1', created_by: 'u-int' }], 'p'),
    project_members: table([{ project_id: 'p1', user_id: 'u-ext' }], 'pm'),
    channels: table([], 'ch'),
    messages: table([], 'm'),
    question_resolutions: table([], 'qr'),
  };
  db.$transaction = jest.fn(async (fn: any) => fn(db));
  return db;
}

class HeaderAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const uid = req.headers['x-test-user'];
    if (!uid) throw new UnauthorizedException('Unauthorized');
    req.session = { userId: uid, role: 'USER', firmId: null };
    return true;
  }
}

describe('Active Question Chats API', () => {
  let app: INestApplication;
  let db: any;

  beforeEach(async () => {
    db = makeDb();
    const mod = await Test.createTestingModule({
      controllers: [ActiveQuestionChatsController],
      providers: [ActiveQuestionChatsService, { provide: PrismaService, useValue: db }],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(HeaderAuthGuard)
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const as = (uid: string) => ({ 'x-test-user': uid });

  async function openQuestion(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/projects/p1/questions')
      .set(as('u-int'))
      .send({ title: 'Which beam spec?', message: '<p>Please confirm</p>' })
      .expect(201);
    return res.body.id;
  }

  it('creates a question channel + first message and lists it', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/projects/p1/questions')
      .set(as('u-ext'))
      .send({ title: 'Door finish', message: 'Matte or gloss?' })
      .expect(201);
    expect(res.body).toMatchObject({ name: 'Door finish', kind: 'question', status: 'open' });
    expect(res.body.id).toBeTruthy();
    expect(res.body.first_message_id).toBeTruthy();
    expect(db.channels.rows).toHaveLength(1);
    expect(db.channels.rows[0]).toMatchObject({ kind: 'question', status: 'open', project_id: 'p1' });
    expect(db.messages.rows).toHaveLength(1);

    const list = await request(app.getHttpServer()).get('/api/projects/p1/questions').set(as('u-int')).expect(200);
    expect(list.body.items).toEqual([
      { id: res.body.id, name: 'Door finish', status: 'open', resolved_sides: '', unread_count: 0 },
    ]);
  });

  it('rejects a blank title or first message with 400 and stores nothing', async () => {
    await request(app.getHttpServer())
      .post('/api/projects/p1/questions').set(as('u-int')).send({ title: '  ', message: 'x' }).expect(400);
    await request(app.getHttpServer())
      .post('/api/projects/p1/questions').set(as('u-int')).send({ title: 'T', message: '' }).expect(400);
    expect(db.channels.rows).toHaveLength(0);
    expect(db.messages.rows).toHaveLength(0);
  });

  it('first mark keeps status open; second side resolves; later posts are 403', async () => {
    const id = await openQuestion();

    const first = await request(app.getHttpServer()).post(`/api/questions/${id}/resolve`).set(as('u-int')).expect(200);
    expect(first.body).toEqual({ id, status: 'open', resolved_sides: 'internal' });
    expect(db.question_resolutions.rows).toHaveLength(1);
    expect(db.question_resolutions.rows[0]).toMatchObject({ channel_id: id, side: 'internal', resolved_by: 'u-int' });

    const second = await request(app.getHttpServer()).post(`/api/questions/${id}/resolve`).set(as('u-ext')).expect(200);
    expect(second.body).toEqual({ id, status: 'resolved', resolved_sides: 'internal,external' });
    expect(db.channels.rows[0].status).toBe('resolved');

    await request(app.getHttpServer())
      .post(`/api/questions/${id}/messages`).set(as('u-ext')).send({ body_html: 'one more' }).expect(403);
  });

  it('withdrawing a mark deletes the resolution rows and stays open', async () => {
    const id = await openQuestion();
    await request(app.getHttpServer()).post(`/api/questions/${id}/resolve`).set(as('u-ext')).expect(200);
    const res = await request(app.getHttpServer()).delete(`/api/questions/${id}/resolve`).set(as('u-ext')).expect(200);
    expect(res.body).toEqual({ id, status: 'open', resolved_sides: '' });
    expect(db.question_resolutions.rows).toHaveLength(0);
  });

  it('a new message clears pending resolution marks', async () => {
    const id = await openQuestion();
    await request(app.getHttpServer()).post(`/api/questions/${id}/resolve`).set(as('u-int')).expect(200);
    await request(app.getHttpServer())
      .post(`/api/questions/${id}/messages`).set(as('u-ext')).send({ body_html: '<b>wait</b>' }).expect(201);
    expect(db.question_resolutions.rows).toHaveLength(0);
    expect(db.channels.rows[0].status).toBe('open');
  });

  it('returns 403 to non-members and 401 to unauthenticated callers', async () => {
    const id = await openQuestion();
    await request(app.getHttpServer()).get('/api/projects/p1/questions').set(as('u-out')).expect(403);
    await request(app.getHttpServer()).get(`/api/questions/${id}`).set(as('u-out')).expect(403);
    await request(app.getHttpServer()).get(`/api/questions/${id}/messages`).set(as('u-out')).expect(403);
    await request(app.getHttpServer()).get(`/api/questions/${id}`).expect(401);
  });
});
