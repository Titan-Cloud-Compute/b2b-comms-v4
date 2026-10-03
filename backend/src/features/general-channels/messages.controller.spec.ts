/**
 * Messages API — HTTP-level spec.
 * Tests POST / GET / PATCH / DELETE as described in the done_when contract.
 * Uses an in-memory Prisma fake and a stub JWT guard (x-test-session header).
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
import { MessagesController, MessageActionsController } from './messages.controller';
import { MessagesService } from './messages.service';
import { ChannelAccessService } from './channel-access.service';
import { makeFakePrisma, type FakePrisma } from './testing/fake-prisma';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Stub guard: reads x-test-session header → req.session; missing → 401. */
class StubAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const raw: string | undefined = req.headers['x-test-session'];
    if (!raw) throw new UnauthorizedException('not authenticated');
    req.session = JSON.parse(raw);
    return true;
  }
}

// ── Fixed test IDs ──────────────────────────────────────────────────────────

const ORG_INTERNAL = 'org-internal';
const ORG_EXTERNAL = 'org-external';
const PROJECT_ID = 'proj-1';
const CHANNEL_ID = 'ch-1';
const CHANNEL_INTERNAL_ID = 'ch-internal';
const AUTHOR_ID = 'user-author';
const OTHER_ID = 'user-other';
const ADMIN_ID = 'user-admin';
const FILE_ID = 'file-1';

/** Build a JSON session header */
const session = (
  userId: string,
  role = 'EMPLOYEE',
  orgId: string | null = ORG_INTERNAL,
) => JSON.stringify({ userId, role, organizationId: orgId, firmId: null });

// ── Test module setup ───────────────────────────────────────────────────────

describe('Messages API', () => {
  let app: INestApplication;
  let db: FakePrisma;

  beforeEach(async () => {
    db = makeFakePrisma();

    // Seed orgs
    db.organizations.rows.push(
      { id: ORG_INTERNAL, name: 'Our Firm', is_internal: true },
      { id: ORG_EXTERNAL, name: 'Acme', is_internal: false },
    );
    // Seed project
    db.projects.rows.push({ id: PROJECT_ID, name: 'P1', status: 'active', organization_id: ORG_INTERNAL });
    // Seed project members
    db.project_members.rows.push(
      { project_id: PROJECT_ID, user_id: AUTHOR_ID },
      { project_id: PROJECT_ID, user_id: OTHER_ID },
      { project_id: PROJECT_ID, user_id: ADMIN_ID },
    );
    // Seed channels
    db.channels.rows.push(
      { id: CHANNEL_ID, project_id: PROJECT_ID, kind: 'general', name: 'general', internal_only: false, status: 'active' },
      { id: CHANNEL_INTERNAL_ID, project_id: PROJECT_ID, kind: 'general', name: 'internal', internal_only: true, status: 'active' },
    );
    // Seed users
    db.users.rows.push(
      { id: AUTHOR_ID, email: 'author@test.com', display_name: 'Alice Author', role: 'EMPLOYEE', organization_id: ORG_INTERNAL },
      { id: OTHER_ID, email: 'other@test.com', display_name: 'Bob Other', role: 'EMPLOYEE', organization_id: ORG_INTERNAL },
      { id: ADMIN_ID, email: 'admin@test.com', display_name: 'Admin User', role: 'ADMIN', organization_id: ORG_INTERNAL },
    );
    // Seed a file
    db.files.rows.push({ id: FILE_ID, project_id: PROJECT_ID, name: 'report.pdf', deleted_at: null });

    const mod = await Test.createTestingModule({
      controllers: [MessagesController, MessageActionsController],
      providers: [
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

  afterEach(async () => {
    await app.close();
  });

  // ── POST /api/channels/:id/messages ─────────────────────────────────────

  it('POST 201: stores message row and returns {id,channel_id,author_id,body_html,created_at}', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/channels/${CHANNEL_ID}/messages`)
      .set('x-test-session', session(AUTHOR_ID))
      .send({ body_html: '<b>hello</b>' })
      .expect(201);

    expect(res.body).toMatchObject({
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: '<b>hello</b>',
    });
    expect(typeof res.body.id).toBe('string');
    expect(res.body.created_at).toBeTruthy();
    expect(db.messages.rows).toHaveLength(1);
  });

  it('POST 201: stores message_attachments row per file_id', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/channels/${CHANNEL_ID}/messages`)
      .set('x-test-session', session(AUTHOR_ID))
      .send({ body_html: '<b>with file</b>', attachments: [FILE_ID] })
      .expect(201);

    expect(res.body.id).toBeTruthy();
    expect(db.message_attachments.rows).toHaveLength(1);
    expect(db.message_attachments.rows[0]).toMatchObject({ file_id: FILE_ID, message_id: res.body.id });
  });

  it('POST 201: sanitizes XSS payload — no <script or onerror in stored html', async () => {
    const xss = '<script>alert(1)</script><img src=x onerror=alert(1)><b>hi</b>';
    const res = await request(app.getHttpServer())
      .post(`/api/channels/${CHANNEL_ID}/messages`)
      .set('x-test-session', session(AUTHOR_ID))
      .send({ body_html: xss })
      .expect(201);

    expect(res.body.body_html).not.toContain('<script');
    expect(res.body.body_html).not.toContain('onerror');
    expect(res.body.body_html).toContain('<b>hi</b>');
    // Confirm stored row matches
    expect(db.messages.rows[0].body_html).not.toContain('<script');
    expect(db.messages.rows[0].body_html).not.toContain('onerror');
  });

  it('POST 400: blank body with no attachments returns 400 and stores no row', async () => {
    await request(app.getHttpServer())
      .post(`/api/channels/${CHANNEL_ID}/messages`)
      .set('x-test-session', session(AUTHOR_ID))
      .send({ body_html: '<p>&nbsp;</p>' })
      .expect(400);

    expect(db.messages.rows).toHaveLength(0);
  });

  it('POST 400: empty string body with no attachments returns 400', async () => {
    await request(app.getHttpServer())
      .post(`/api/channels/${CHANNEL_ID}/messages`)
      .set('x-test-session', session(AUTHOR_ID))
      .send({ body_html: '' })
      .expect(400);

    expect(db.messages.rows).toHaveLength(0);
  });

  it('POST 401: no session returns 401', async () => {
    await request(app.getHttpServer())
      .post(`/api/channels/${CHANNEL_ID}/messages`)
      .send({ body_html: '<b>hi</b>' })
      .expect(401);
  });

  // ── GET /api/channels/:id/messages ──────────────────────────────────────

  it('GET 200: returns items[] newest-first with author.display_name, attachments[].name, reference_id, edited_at', async () => {
    // Seed two messages
    const t1 = '2024-01-01T10:00:00.000Z';
    const t2 = '2024-01-02T10:00:00.000Z';
    db.messages.rows.push(
      { id: 'msg-1', channel_id: CHANNEL_ID, author_id: AUTHOR_ID, body_html: '<b>first</b>', created_at: t1, deleted_at: null, edited_at: null },
      { id: 'msg-2', channel_id: CHANNEL_ID, author_id: OTHER_ID, body_html: '<em>second</em>', created_at: t2, deleted_at: null, edited_at: null },
    );
    db.message_attachments.rows.push({ id: 'att-1', message_id: 'msg-1', file_id: FILE_ID });

    const res = await request(app.getHttpServer())
      .get(`/api/channels/${CHANNEL_ID}/messages`)
      .set('x-test-session', session(AUTHOR_ID))
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items).toHaveLength(2);

    // Newest first (msg-2 has later created_at)
    expect(res.body.items[0].id).toBe('msg-2');
    expect(res.body.items[1].id).toBe('msg-1');

    // Author display_name populated
    expect(res.body.items[0].author.display_name).toBe('Bob Other');
    expect(res.body.items[1].author.display_name).toBe('Alice Author');

    // Attachment on msg-1
    expect(res.body.items[1].attachments).toHaveLength(1);
    expect(res.body.items[1].attachments[0]).toMatchObject({ file_id: FILE_ID, name: 'report.pdf' });

    // reference_id and edited_at fields present (null when absent)
    expect(res.body.items[0].reference_id).toBeNull();
    expect(res.body.items[0].edited_at).toBeNull();
  });

  it('GET 200: excludes deleted messages', async () => {
    const t1 = '2024-01-01T10:00:00.000Z';
    const t2 = '2024-01-02T10:00:00.000Z';
    db.messages.rows.push(
      { id: 'msg-1', channel_id: CHANNEL_ID, author_id: AUTHOR_ID, body_html: '<b>visible</b>', created_at: t1, deleted_at: null },
      { id: 'msg-2', channel_id: CHANNEL_ID, author_id: AUTHOR_ID, body_html: '<b>deleted</b>', created_at: t2, deleted_at: '2024-01-03T00:00:00.000Z' },
    );

    const res = await request(app.getHttpServer())
      .get(`/api/channels/${CHANNEL_ID}/messages`)
      .set('x-test-session', session(AUTHOR_ID))
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe('msg-1');
  });

  it('GET 200: cursor pagination — next_cursor on first page, null on last page', async () => {
    // Seed 3 messages with different created_at
    for (let i = 1; i <= 3; i++) {
      const ts = `2024-01-0${i}T10:00:00.000Z`;
      db.messages.rows.push({
        id: `msg-${i}`,
        channel_id: CHANNEL_ID,
        author_id: AUTHOR_ID,
        body_html: `<b>msg ${i}</b>`,
        created_at: ts,
        deleted_at: null,
      });
    }

    // First page: limit=2 → gets msg-3 and msg-2 (newest first), next_cursor set
    const res1 = await request(app.getHttpServer())
      .get(`/api/channels/${CHANNEL_ID}/messages?limit=2`)
      .set('x-test-session', session(AUTHOR_ID))
      .expect(200);

    expect(res1.body.items).toHaveLength(2);
    expect(res1.body.items[0].id).toBe('msg-3');
    expect(res1.body.items[1].id).toBe('msg-2');
    expect(typeof res1.body.next_cursor).toBe('string');

    // Second page using the cursor → gets msg-1, no next_cursor
    const res2 = await request(app.getHttpServer())
      .get(`/api/channels/${CHANNEL_ID}/messages?limit=2&cursor=${res1.body.next_cursor}`)
      .set('x-test-session', session(AUTHOR_ID))
      .expect(200);

    expect(res2.body.items).toHaveLength(1);
    expect(res2.body.items[0].id).toBe('msg-1');
    expect(res2.body.next_cursor).toBeNull();
  });

  it('GET 401: no session returns 401', async () => {
    await request(app.getHttpServer())
      .get(`/api/channels/${CHANNEL_ID}/messages`)
      .expect(401);
  });

  // ── PATCH /api/messages/:id ──────────────────────────────────────────────

  it('PATCH 200: author can edit own message — edited_at is set', async () => {
    db.messages.rows.push({
      id: 'msg-1',
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: '<b>original</b>',
      created_at: '2024-01-01T10:00:00.000Z',
      deleted_at: null,
      edited_at: null,
    });

    const res = await request(app.getHttpServer())
      .patch('/api/messages/msg-1')
      .set('x-test-session', session(AUTHOR_ID))
      .send({ body_html: '<em>edited</em>' })
      .expect(200);

    expect(res.body.id).toBe('msg-1');
    expect(res.body.body_html).toBe('<em>edited</em>');
    expect(res.body.edited_at).toBeTruthy();
  });

  it('PATCH 403: another user (non-author) cannot edit the message', async () => {
    db.messages.rows.push({
      id: 'msg-1',
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: '<b>original</b>',
      created_at: '2024-01-01T10:00:00.000Z',
      deleted_at: null,
    });

    await request(app.getHttpServer())
      .patch('/api/messages/msg-1')
      .set('x-test-session', session(OTHER_ID))
      .send({ body_html: '<em>edited by other</em>' })
      .expect(403);
  });

  it('PATCH 403: Admin cannot edit another user\'s message', async () => {
    db.messages.rows.push({
      id: 'msg-1',
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: '<b>original</b>',
      created_at: '2024-01-01T10:00:00.000Z',
      deleted_at: null,
    });

    await request(app.getHttpServer())
      .patch('/api/messages/msg-1')
      .set('x-test-session', session(ADMIN_ID, 'ADMIN'))
      .send({ body_html: '<em>admin edit</em>' })
      .expect(403);
  });

  it('PATCH 401: no session returns 401', async () => {
    await request(app.getHttpServer())
      .patch('/api/messages/msg-1')
      .send({ body_html: '<b>hi</b>' })
      .expect(401);
  });

  // ── DELETE /api/messages/:id ─────────────────────────────────────────────

  it('DELETE 204: author can delete own message — deleted_at is set', async () => {
    db.messages.rows.push({
      id: 'msg-1',
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: '<b>bye</b>',
      created_at: '2024-01-01T10:00:00.000Z',
      deleted_at: null,
    });

    await request(app.getHttpServer())
      .delete('/api/messages/msg-1')
      .set('x-test-session', session(AUTHOR_ID))
      .expect(204);

    // Confirm deleted_at was set on the stored row
    expect(db.messages.rows[0].deleted_at).toBeTruthy();
  });

  it('DELETE 403: another user (non-author) cannot delete the message', async () => {
    db.messages.rows.push({
      id: 'msg-1',
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: '<b>bye</b>',
      created_at: '2024-01-01T10:00:00.000Z',
      deleted_at: null,
    });

    await request(app.getHttpServer())
      .delete('/api/messages/msg-1')
      .set('x-test-session', session(OTHER_ID))
      .expect(403);
  });

  it('DELETE 403: Admin cannot delete another user\'s message', async () => {
    db.messages.rows.push({
      id: 'msg-1',
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: '<b>bye</b>',
      created_at: '2024-01-01T10:00:00.000Z',
      deleted_at: null,
    });

    await request(app.getHttpServer())
      .delete('/api/messages/msg-1')
      .set('x-test-session', session(ADMIN_ID, 'ADMIN'))
      .expect(403);
  });

  it('DELETE 401: no session returns 401', async () => {
    await request(app.getHttpServer())
      .delete('/api/messages/msg-1')
      .expect(401);
  });
});
