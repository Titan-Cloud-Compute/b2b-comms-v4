/**
 * Messages API — HTTP-level spec using an in-memory Prisma fake.
 * Covers: POST, GET (cursor paging), PATCH, DELETE, auth/access cases.
 */
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ChannelsController,
  ChannelMessagesController,
  MessageController,
} from './channels.controller';
import { ChannelsService } from './channels.service';
import { MessagesService } from './messages.service';
import { ChannelAccessService } from './channel-access.service';
import { makeFakePrisma, type FakePrisma } from './testing/fake-prisma';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Stub guard: reads x-test-session header → req.session; missing → 401 */
class StubAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const raw: string | undefined = req.headers['x-test-session'];
    if (!raw) throw new UnauthorizedException('not authenticated');
    req.session = JSON.parse(raw);
    return true;
  }
}

describe('Messages API', () => {
  let app: INestApplication;
  let db: FakePrisma;

  const INTERNAL_ORG_ID = 'org-internal';
  const PROJECT_ID = 'proj-1';
  const CHANNEL_ID = 'ch-1';
  const AUTHOR_ID = 'user-author';
  const OTHER_ID = 'user-other';
  const ADMIN_ID = 'user-admin';

  const session = (userId: string, role: string, orgId = INTERNAL_ORG_ID) =>
    JSON.stringify({ userId, role, organizationId: orgId, firmId: null });

  beforeEach(async () => {
    db = makeFakePrisma();

    db.organizations.rows.push({ id: INTERNAL_ORG_ID, name: 'Firm', is_internal: true });
    db.projects.rows.push({ id: PROJECT_ID, name: 'P1', status: 'active', organization_id: INTERNAL_ORG_ID });
    db.project_members.rows.push(
      { project_id: PROJECT_ID, user_id: AUTHOR_ID },
      { project_id: PROJECT_ID, user_id: OTHER_ID },
      { project_id: PROJECT_ID, user_id: ADMIN_ID },
    );
    db.channels.rows.push({
      id: CHANNEL_ID,
      project_id: PROJECT_ID,
      kind: 'general',
      name: 'general',
      internal_only: false,
      status: 'active',
      created_at: new Date(),
    });
    db.users.rows.push(
      { id: AUTHOR_ID, display_name: 'Alice', email: 'alice@example.com' },
      { id: OTHER_ID, display_name: 'Bob', email: 'bob@example.com' },
      { id: ADMIN_ID, display_name: 'Carol Admin', email: 'carol@example.com' },
    );

    const mod = await Test.createTestingModule({
      controllers: [ChannelsController, ChannelMessagesController, MessageController],
      providers: [
        ChannelsService,
        MessagesService,
        ChannelAccessService,
        { provide: PrismaService, useValue: db },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubAuthGuard)
      .compile();

    app = mod.createNestApplication();
    await app.init();
  });

  afterEach(() => app.close());

  // ── POST /api/channels/:id/messages ────────────────────────────────────

  it('POST 201 stores message and attachment row, returns correct shape', async () => {
    // Seed a file the author can attach
    db.files.rows.push({ id: 'file-1', project_id: PROJECT_ID, name: 'doc.pdf', deleted_at: null });

    const res = await request(app.getHttpServer())
      .post(`/api/channels/${CHANNEL_ID}/messages`)
      .set('x-test-session', session(AUTHOR_ID, 'USER'))
      .send({ body_html: '<b>hello</b>', attachments: ['file-1'] })
      .expect(201);

    expect(res.body).toMatchObject({
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: '<b>hello</b>',
    });
    expect(res.body.id).toBeTruthy();
    expect(res.body.created_at).toBeTruthy();

    // Verify DB rows
    const msgRow = db.messages.rows.find((m: any) => m.channel_id === CHANNEL_ID);
    expect(msgRow).toBeTruthy();
    const attRow = db.message_attachments.rows.find((a: any) => a.file_id === 'file-1');
    expect(attRow).toBeTruthy();
  });

  it('POST sanitizes body_html: strips script and onerror, keeps b', async () => {
    const dirty = '<script>alert(1)</script><img src=x onerror=alert(1)><b>hi</b>';
    const res = await request(app.getHttpServer())
      .post(`/api/channels/${CHANNEL_ID}/messages`)
      .set('x-test-session', session(AUTHOR_ID, 'USER'))
      .send({ body_html: dirty })
      .expect(201);

    expect(res.body.body_html).not.toContain('<script');
    expect(res.body.body_html).not.toContain('onerror');
    expect(res.body.body_html).toContain('<b>hi</b>');
  });

  it('POST sanitizes: keeps strong, em, ul, ol, li, a, and mention spans', async () => {
    const html = '<strong>bold</strong><em>italic</em><ul><li>item</li></ul><ol><li>one</li></ol><a href="https://example.com">link</a><span class="mention" data-mention-user-id="u1">@Alice</span>';
    const res = await request(app.getHttpServer())
      .post(`/api/channels/${CHANNEL_ID}/messages`)
      .set('x-test-session', session(AUTHOR_ID, 'USER'))
      .send({ body_html: html })
      .expect(201);

    expect(res.body.body_html).toContain('<strong>bold</strong>');
    expect(res.body.body_html).toContain('<em>italic</em>');
    expect(res.body.body_html).toContain('<ul>');
    expect(res.body.body_html).toContain('<ol>');
    expect(res.body.body_html).toContain('<li>');
    expect(res.body.body_html).toContain('href="https://example.com"');
    expect(res.body.body_html).toContain('data-mention-user-id="u1"');
  });

  it('POST 400 for blank body with no attachments — stores no row', async () => {
    const initialCount = db.messages.rows.length;
    await request(app.getHttpServer())
      .post(`/api/channels/${CHANNEL_ID}/messages`)
      .set('x-test-session', session(AUTHOR_ID, 'USER'))
      .send({ body_html: '   ' })
      .expect(400);

    expect(db.messages.rows.length).toBe(initialCount);
  });

  it('POST 400 for body with only script tag (stripped → blank) and no attachments', async () => {
    const initialCount = db.messages.rows.length;
    await request(app.getHttpServer())
      .post(`/api/channels/${CHANNEL_ID}/messages`)
      .set('x-test-session', session(AUTHOR_ID, 'USER'))
      .send({ body_html: '<script>alert(1)</script>' })
      .expect(400);

    expect(db.messages.rows.length).toBe(initialCount);
  });

  it('POST 401 without session', async () => {
    await request(app.getHttpServer())
      .post(`/api/channels/${CHANNEL_ID}/messages`)
      .send({ body_html: '<b>hi</b>' })
      .expect(401);
  });

  // ── GET /api/channels/:id/messages ─────────────────────────────────────

  it('GET returns items newest-first with author.display_name, attachments, reference_id, edited_at', async () => {
    const now = new Date();
    const older = new Date(now.getTime() - 60000);
    db.messages.rows.push(
      { id: 'msg-1', channel_id: CHANNEL_ID, author_id: AUTHOR_ID, body_html: '<b>first</b>', created_at: older, edited_at: null, deleted_at: null },
      { id: 'msg-2', channel_id: CHANNEL_ID, author_id: AUTHOR_ID, body_html: '<b>second</b>', created_at: now, edited_at: null, deleted_at: null },
    );
    db.files.rows.push({ id: 'file-1', project_id: PROJECT_ID, name: 'doc.pdf', deleted_at: null });
    db.message_attachments.rows.push({ id: 'att-1', message_id: 'msg-1', file_id: 'file-1' });
    db.references.rows.push({ id: 'ref-1', message_id: 'msg-2', file_version_id: 'fv-1' });

    const res = await request(app.getHttpServer())
      .get(`/api/channels/${CHANNEL_ID}/messages`)
      .set('x-test-session', session(AUTHOR_ID, 'USER'))
      .expect(200);

    const items = res.body.items;
    expect(items).toHaveLength(2);
    // newest first
    expect(items[0].id).toBe('msg-2');
    expect(items[1].id).toBe('msg-1');

    expect(items[0].author.display_name).toBe('Alice');
    expect(items[0].reference_id).toBe('ref-1');
    expect(items[0].edited_at).toBeNull();

    expect(items[1].attachments).toHaveLength(1);
    expect(items[1].attachments[0]).toMatchObject({ file_id: 'file-1', name: 'doc.pdf' });

    expect(res.body.next_cursor).toBeNull();
  });

  it('GET excludes deleted messages', async () => {
    const now = new Date();
    db.messages.rows.push(
      { id: 'msg-del', channel_id: CHANNEL_ID, author_id: AUTHOR_ID, body_html: '<b>gone</b>', created_at: now, deleted_at: new Date() },
      { id: 'msg-ok', channel_id: CHANNEL_ID, author_id: AUTHOR_ID, body_html: '<b>here</b>', created_at: now, deleted_at: null },
    );

    const res = await request(app.getHttpServer())
      .get(`/api/channels/${CHANNEL_ID}/messages`)
      .set('x-test-session', session(AUTHOR_ID, 'USER'))
      .expect(200);

    const ids = res.body.items.map((i: any) => i.id);
    expect(ids).not.toContain('msg-del');
    expect(ids).toContain('msg-ok');
  });

  it('GET cursor paginates correctly (next_cursor set, then second page empty)', async () => {
    // Seed 3 messages
    const t0 = new Date('2024-01-01T00:00:00Z');
    const t1 = new Date('2024-01-01T00:01:00Z');
    const t2 = new Date('2024-01-01T00:02:00Z');
    db.messages.rows.push(
      { id: 'msg-a', channel_id: CHANNEL_ID, author_id: AUTHOR_ID, body_html: 'a', created_at: t0, deleted_at: null },
      { id: 'msg-b', channel_id: CHANNEL_ID, author_id: AUTHOR_ID, body_html: 'b', created_at: t1, deleted_at: null },
      { id: 'msg-c', channel_id: CHANNEL_ID, author_id: AUTHOR_ID, body_html: 'c', created_at: t2, deleted_at: null },
    );

    // page 1: limit=2
    const res1 = await request(app.getHttpServer())
      .get(`/api/channels/${CHANNEL_ID}/messages?limit=2`)
      .set('x-test-session', session(AUTHOR_ID, 'USER'))
      .expect(200);

    expect(res1.body.items).toHaveLength(2);
    expect(res1.body.items[0].id).toBe('msg-c'); // newest first
    expect(res1.body.items[1].id).toBe('msg-b');
    expect(res1.body.next_cursor).toBeTruthy();

    // page 2: use cursor
    const res2 = await request(app.getHttpServer())
      .get(`/api/channels/${CHANNEL_ID}/messages?limit=2&cursor=${res1.body.next_cursor}`)
      .set('x-test-session', session(AUTHOR_ID, 'USER'))
      .expect(200);

    expect(res2.body.items).toHaveLength(1);
    expect(res2.body.items[0].id).toBe('msg-a');
    expect(res2.body.next_cursor).toBeNull();
  });

  it('GET 401 without session', async () => {
    await request(app.getHttpServer())
      .get(`/api/channels/${CHANNEL_ID}/messages`)
      .expect(401);
  });

  // ── PATCH /api/messages/:id ─────────────────────────────────────────────

  it('PATCH by author returns 200 with edited_at set', async () => {
    db.messages.rows.push({
      id: 'msg-e',
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: '<b>old</b>',
      created_at: new Date(),
      edited_at: null,
      deleted_at: null,
    });

    const res = await request(app.getHttpServer())
      .patch('/api/messages/msg-e')
      .set('x-test-session', session(AUTHOR_ID, 'USER'))
      .send({ body_html: '<b>new</b>' })
      .expect(200);

    expect(res.body).toMatchObject({ id: 'msg-e', body_html: '<b>new</b>' });
    expect(res.body.edited_at).toBeTruthy();

    const row = db.messages.rows.find((m: any) => m.id === 'msg-e');
    expect(row.edited_at).toBeTruthy();
  });

  it('PATCH by non-author (OTHER user) returns 403', async () => {
    db.messages.rows.push({
      id: 'msg-f',
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: '<b>content</b>',
      created_at: new Date(),
      deleted_at: null,
    });

    await request(app.getHttpServer())
      .patch('/api/messages/msg-f')
      .set('x-test-session', session(OTHER_ID, 'USER'))
      .send({ body_html: '<b>hacked</b>' })
      .expect(403);
  });

  it('PATCH by admin (different user) returns 403', async () => {
    db.messages.rows.push({
      id: 'msg-g',
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: '<b>content</b>',
      created_at: new Date(),
      deleted_at: null,
    });

    await request(app.getHttpServer())
      .patch('/api/messages/msg-g')
      .set('x-test-session', session(ADMIN_ID, 'ADMIN'))
      .send({ body_html: '<b>admin edit</b>' })
      .expect(403);
  });

  it('PATCH 401 without session', async () => {
    await request(app.getHttpServer())
      .patch('/api/messages/some-id')
      .send({ body_html: '<b>x</b>' })
      .expect(401);
  });

  // ── DELETE /api/messages/:id ────────────────────────────────────────────

  it('DELETE by author returns 204 and sets deleted_at', async () => {
    db.messages.rows.push({
      id: 'msg-d',
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: '<b>bye</b>',
      created_at: new Date(),
      deleted_at: null,
    });

    await request(app.getHttpServer())
      .delete('/api/messages/msg-d')
      .set('x-test-session', session(AUTHOR_ID, 'USER'))
      .expect(204);

    const row = db.messages.rows.find((m: any) => m.id === 'msg-d');
    expect(row.deleted_at).toBeTruthy();
  });

  it('DELETE by non-author (OTHER user) returns 403', async () => {
    db.messages.rows.push({
      id: 'msg-h',
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: '<b>keep</b>',
      created_at: new Date(),
      deleted_at: null,
    });

    await request(app.getHttpServer())
      .delete('/api/messages/msg-h')
      .set('x-test-session', session(OTHER_ID, 'USER'))
      .expect(403);

    const row = db.messages.rows.find((m: any) => m.id === 'msg-h');
    expect(row.deleted_at).toBeNull();
  });

  it('DELETE by admin (different user) returns 403', async () => {
    db.messages.rows.push({
      id: 'msg-i',
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: '<b>keep</b>',
      created_at: new Date(),
      deleted_at: null,
    });

    await request(app.getHttpServer())
      .delete('/api/messages/msg-i')
      .set('x-test-session', session(ADMIN_ID, 'ADMIN'))
      .expect(403);
  });

  it('DELETE 401 without session', async () => {
    await request(app.getHttpServer())
      .delete('/api/messages/some-id')
      .expect(401);
  });
});
