/**
 * Messages API spec — covers POST/GET /api/channels/:id/messages,
 * PATCH /api/messages/:id, DELETE /api/messages/:id.
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
  MessageActionsController,
} from './channels.controller';
import { ChannelsService } from './channels.service';
import { ChannelAccessService } from './channel-access.service';
import { MessagesService } from './messages.service';
import { makeFakePrisma, type FakePrisma } from './testing/fake-prisma';

/* eslint-disable @typescript-eslint/no-explicit-any */

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
  const EXTERNAL_ORG_ID = 'org-external';
  const PROJECT_ID = 'proj-1';
  const CHANNEL_ID = 'ch-1';
  const AUTHOR_ID = 'user-author';
  const OTHER_ID = 'user-other';
  const ADMIN_ID = 'user-admin';

  const session = (userId: string, role = 'USER', orgId: string | null = INTERNAL_ORG_ID) =>
    JSON.stringify({ userId, role, organizationId: orgId, firmId: null });

  beforeEach(async () => {
    db = makeFakePrisma();

    db.organizations.rows.push(
      { id: INTERNAL_ORG_ID, name: 'Our Firm', is_internal: true },
      { id: EXTERNAL_ORG_ID, name: 'Acme', is_internal: false },
    );

    db.projects.rows.push({
      id: PROJECT_ID,
      name: 'Main Project',
      status: 'active',
      organization_id: INTERNAL_ORG_ID,
    });

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
    });

    db.users.rows.push(
      { id: AUTHOR_ID, email: 'author@test.com', display_name: 'Alice Author' },
      { id: OTHER_ID, email: 'other@test.com', display_name: 'Bob Other' },
      { id: ADMIN_ID, email: 'admin@test.com', display_name: 'Admin User', role: 'ADMIN' },
    );

    const mod = await Test.createTestingModule({
      controllers: [ChannelsController, ChannelMessagesController, MessageActionsController],
      providers: [
        ChannelsService,
        ChannelAccessService,
        MessagesService,
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

  it('POST returns 201 with correct shape and stores row + attachments', async () => {
    // Seed a file
    db.files.rows.push({
      id: 'file-1',
      project_id: PROJECT_ID,
      name: 'report.pdf',
      deleted_at: null,
    });

    const res = await request(app.getHttpServer())
      .post(`/api/channels/${CHANNEL_ID}/messages`)
      .set('x-test-session', session(AUTHOR_ID))
      .send({ body_html: '<b>hello world</b>', attachments: ['file-1'] })
      .expect(201);

    expect(res.body).toMatchObject({
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: expect.stringContaining('hello world'),
    });
    expect(res.body.id).toBeTruthy();
    expect(res.body.created_at).toBeTruthy();

    const msgRows = db.messages.rows;
    expect(msgRows).toHaveLength(1);
    expect(db.message_attachments.rows).toHaveLength(1);
    expect(db.message_attachments.rows[0].file_id).toBe('file-1');
  });

  it('POST sanitizes script tags and onerror but keeps <b>', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/channels/${CHANNEL_ID}/messages`)
      .set('x-test-session', session(AUTHOR_ID))
      .send({ body_html: '<script>alert(1)</script><img src=x onerror=alert(1)><b>hi</b>' })
      .expect(201);

    expect(res.body.body_html).not.toContain('<script');
    expect(res.body.body_html).not.toContain('onerror');
    expect(res.body.body_html).toContain('<b>hi</b>');
  });

  it('POST with blank body and no attachments returns 400 and stores no row', async () => {
    await request(app.getHttpServer())
      .post(`/api/channels/${CHANNEL_ID}/messages`)
      .set('x-test-session', session(AUTHOR_ID))
      .send({ body_html: '<p><br></p>' })
      .expect(400);

    expect(db.messages.rows).toHaveLength(0);
  });

  it('POST with empty body_html but an attachment is accepted', async () => {
    db.files.rows.push({
      id: 'file-2',
      project_id: PROJECT_ID,
      name: 'image.png',
      deleted_at: null,
    });

    await request(app.getHttpServer())
      .post(`/api/channels/${CHANNEL_ID}/messages`)
      .set('x-test-session', session(AUTHOR_ID))
      .send({ body_html: '', attachments: ['file-2'] })
      .expect(201);
  });

  it('POST without session returns 401', async () => {
    await request(app.getHttpServer())
      .post(`/api/channels/${CHANNEL_ID}/messages`)
      .send({ body_html: '<p>hi</p>' })
      .expect(401);
  });

  // ── GET /api/channels/:id/messages ──────────────────────────────────────

  it('GET returns items newest-first with author.display_name, attachments, reference_id, edited_at', async () => {
    const now = new Date();
    const older = new Date(now.getTime() - 10000);

    db.messages.rows.push(
      {
        id: 'msg-1',
        channel_id: CHANNEL_ID,
        author_id: AUTHOR_ID,
        body_html: '<p>first</p>',
        created_at: older,
        edited_at: null,
        deleted_at: null,
      },
      {
        id: 'msg-2',
        channel_id: CHANNEL_ID,
        author_id: OTHER_ID,
        body_html: '<p>second</p>',
        created_at: now,
        edited_at: null,
        deleted_at: null,
      },
    );

    // Add an attachment to msg-1
    db.message_attachments.rows.push({ id: 'att-1', message_id: 'msg-1', file_id: 'file-3' });
    db.files.rows.push({ id: 'file-3', project_id: PROJECT_ID, name: 'doc.pdf', deleted_at: null });

    const res = await request(app.getHttpServer())
      .get(`/api/channels/${CHANNEL_ID}/messages`)
      .set('x-test-session', session(AUTHOR_ID))
      .expect(200);

    expect(res.body.items).toHaveLength(2);
    // Newest first
    expect(res.body.items[0].id).toBe('msg-2');
    expect(res.body.items[1].id).toBe('msg-1');

    expect(res.body.items[0].author.display_name).toBe('Bob Other');
    expect(res.body.items[1].attachments).toHaveLength(1);
    expect(res.body.items[1].attachments[0].name).toBe('doc.pdf');
    expect(res.body.items[1].reference_id).toBeNull();
    expect(res.body.next_cursor).toBeNull();
  });

  it('GET excludes deleted messages', async () => {
    db.messages.rows.push({
      id: 'msg-del',
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: '<p>gone</p>',
      created_at: new Date(),
      deleted_at: new Date(),
    });

    const res = await request(app.getHttpServer())
      .get(`/api/channels/${CHANNEL_ID}/messages`)
      .set('x-test-session', session(AUTHOR_ID))
      .expect(200);

    expect(res.body.items).toHaveLength(0);
  });

  it('GET paginates using next_cursor', async () => {
    const base = new Date('2024-01-01T00:00:00Z');
    for (let i = 1; i <= 3; i++) {
      db.messages.rows.push({
        id: `msg-${i}`,
        channel_id: CHANNEL_ID,
        author_id: AUTHOR_ID,
        body_html: `<p>msg ${i}</p>`,
        created_at: new Date(base.getTime() + i * 1000),
        edited_at: null,
        deleted_at: null,
      });
    }

    // First page: limit=2
    const res1 = await request(app.getHttpServer())
      .get(`/api/channels/${CHANNEL_ID}/messages?limit=2`)
      .set('x-test-session', session(AUTHOR_ID))
      .expect(200);

    expect(res1.body.items).toHaveLength(2);
    expect(res1.body.next_cursor).toBeTruthy();
    // Newest first: msg-3, msg-2
    expect(res1.body.items[0].id).toBe('msg-3');
    expect(res1.body.items[1].id).toBe('msg-2');

    // Second page
    const res2 = await request(app.getHttpServer())
      .get(`/api/channels/${CHANNEL_ID}/messages?limit=2&cursor=${res1.body.next_cursor}`)
      .set('x-test-session', session(AUTHOR_ID))
      .expect(200);

    expect(res2.body.items).toHaveLength(1);
    expect(res2.body.items[0].id).toBe('msg-1');
    expect(res2.body.next_cursor).toBeNull();
  });

  it('GET without session returns 401', async () => {
    await request(app.getHttpServer())
      .get(`/api/channels/${CHANNEL_ID}/messages`)
      .expect(401);
  });

  // ── PATCH /api/messages/:id ──────────────────────────────────────────────

  it('PATCH by author returns 200 with edited_at set', async () => {
    db.messages.rows.push({
      id: 'msg-edit',
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: '<p>original</p>',
      created_at: new Date(),
      edited_at: null,
      deleted_at: null,
    });

    const res = await request(app.getHttpServer())
      .patch('/api/messages/msg-edit')
      .set('x-test-session', session(AUTHOR_ID))
      .send({ body_html: '<p>updated</p>' })
      .expect(200);

    expect(res.body.id).toBe('msg-edit');
    expect(res.body.body_html).toContain('updated');
    expect(res.body.edited_at).toBeTruthy();
  });

  it('PATCH by other user (not author) returns 403', async () => {
    db.messages.rows.push({
      id: 'msg-other',
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: '<p>mine</p>',
      created_at: new Date(),
      edited_at: null,
      deleted_at: null,
    });

    await request(app.getHttpServer())
      .patch('/api/messages/msg-other')
      .set('x-test-session', session(OTHER_ID))
      .send({ body_html: '<p>hacked</p>' })
      .expect(403);
  });

  it('PATCH by Admin (not author) returns 403', async () => {
    db.messages.rows.push({
      id: 'msg-admin-test',
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: '<p>mine</p>',
      created_at: new Date(),
      edited_at: null,
      deleted_at: null,
    });

    await request(app.getHttpServer())
      .patch('/api/messages/msg-admin-test')
      .set('x-test-session', session(ADMIN_ID, 'ADMIN'))
      .send({ body_html: '<p>admin edit</p>' })
      .expect(403);
  });

  it('PATCH without session returns 401', async () => {
    await request(app.getHttpServer())
      .patch('/api/messages/msg-edit')
      .send({ body_html: '<p>test</p>' })
      .expect(401);
  });

  // ── DELETE /api/messages/:id ─────────────────────────────────────────────

  it('DELETE by author returns 204 with deleted_at set', async () => {
    db.messages.rows.push({
      id: 'msg-del-test',
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: '<p>to delete</p>',
      created_at: new Date(),
      edited_at: null,
      deleted_at: null,
    });

    await request(app.getHttpServer())
      .delete('/api/messages/msg-del-test')
      .set('x-test-session', session(AUTHOR_ID))
      .expect(204);

    const row = db.messages.rows.find((m: any) => m.id === 'msg-del-test');
    expect(row.deleted_at).toBeTruthy();
  });

  it('DELETE by other user (not author) returns 403', async () => {
    db.messages.rows.push({
      id: 'msg-del-other',
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: '<p>mine</p>',
      created_at: new Date(),
      edited_at: null,
      deleted_at: null,
    });

    await request(app.getHttpServer())
      .delete('/api/messages/msg-del-other')
      .set('x-test-session', session(OTHER_ID))
      .expect(403);
  });

  it('DELETE by Admin (not author) returns 403', async () => {
    db.messages.rows.push({
      id: 'msg-del-admin',
      channel_id: CHANNEL_ID,
      author_id: AUTHOR_ID,
      body_html: '<p>mine</p>',
      created_at: new Date(),
      edited_at: null,
      deleted_at: null,
    });

    await request(app.getHttpServer())
      .delete('/api/messages/msg-del-admin')
      .set('x-test-session', session(ADMIN_ID, 'ADMIN'))
      .expect(403);
  });

  it('DELETE without session returns 401', async () => {
    await request(app.getHttpServer())
      .delete('/api/messages/some-id')
      .expect(401);
  });
});
