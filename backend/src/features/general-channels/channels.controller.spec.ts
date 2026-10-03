/**
 * General Channels — HTTP-level spec against an in-memory Prisma fake.
 * The JWT guard is replaced with a header-driven stub (x-test-session) so the
 * tests exercise routing, status codes, and the full access-policy flow.
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
import { ChannelsController, ChannelMessagesController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { ChannelAccessService } from './channel-access.service';
import { MessagesService } from './messages.service';
import { makeFakePrisma, type FakePrisma } from './testing/fake-prisma';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Stub guard: reads x-test-session header (JSON) → sets req.session; missing → 401. */
class StubAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const raw: string | undefined = req.headers['x-test-session'];
    if (!raw) throw new UnauthorizedException('not authenticated');
    req.session = JSON.parse(raw);
    return true;
  }
}

describe('General Channels API', () => {
  let app: INestApplication;
  let db: FakePrisma;

  // Fixed IDs for test data
  const INTERNAL_ORG_ID = 'org-internal';
  const EXTERNAL_ORG_ID = 'org-external';
  const PROJECT_ID = 'proj-1';
  const ADMIN_ID = 'user-admin';
  const MANAGER_ID = 'user-manager';
  const EMPLOYEE_ID = 'user-employee';
  const EXTERNAL_ID = 'user-external';
  const OUTSIDER_ID = 'user-outsider';

  /** Build a JSON session header value */
  const session = (userId: string, role: string, organizationId: string | null = INTERNAL_ORG_ID) =>
    JSON.stringify({ userId, role, organizationId, firmId: null });

  beforeEach(async () => {
    db = makeFakePrisma();

    // Seed organizations
    db.organizations.rows.push(
      { id: INTERNAL_ORG_ID, name: 'Our Firm', is_internal: true },
      { id: EXTERNAL_ORG_ID, name: 'Acme', is_internal: false },
    );

    // Seed project
    db.projects.rows.push({
      id: PROJECT_ID,
      name: 'Main Project',
      status: 'active',
      organization_id: INTERNAL_ORG_ID,
    });

    // Seed project members (admin, manager, employee are members; outsider is not)
    db.project_members.rows.push(
      { project_id: PROJECT_ID, user_id: ADMIN_ID },
      { project_id: PROJECT_ID, user_id: MANAGER_ID },
      { project_id: PROJECT_ID, user_id: EMPLOYEE_ID },
      { project_id: PROJECT_ID, user_id: EXTERNAL_ID },
    );

    const mod = await Test.createTestingModule({
      controllers: [ChannelsController, ChannelMessagesController],
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

  // ── Lazy default channel creation ──────────────────────────────────────

  it('GET list on a project with no channels returns 200 with general[] containing "general"', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/projects/${PROJECT_ID}/channels`)
      .set('x-test-session', session(ADMIN_ID, 'ADMIN'))
      .expect(200);

    expect(res.body.general).toHaveLength(1);
    expect(res.body.general[0]).toMatchObject({
      name: 'general',
      internal_only: false,
      unread_count: 0,
    });
    expect(res.body.general[0].id).toBeTruthy();
    expect(res.body.questions).toEqual([]);
  });

  it('second GET list creates no additional channels (idempotent)', async () => {
    await request(app.getHttpServer())
      .get(`/api/projects/${PROJECT_ID}/channels`)
      .set('x-test-session', session(ADMIN_ID, 'ADMIN'))
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/projects/${PROJECT_ID}/channels`)
      .set('x-test-session', session(ADMIN_ID, 'ADMIN'))
      .expect(200);

    const generalChannels = db.channels.rows.filter(
      (c: any) => c.kind === 'general',
    );
    expect(generalChannels).toHaveLength(1);
  });

  // ── POST create channel ────────────────────────────────────────────────

  it('MANAGER creates a general channel and gets 201 with correct shape', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/projects/${PROJECT_ID}/channels`)
      .set('x-test-session', session(MANAGER_ID, 'MANAGER'))
      .send({ name: 'announcements' })
      .expect(201);

    expect(res.body).toMatchObject({
      name: 'announcements',
      kind: 'general',
      internal_only: false,
      status: 'active',
    });
    expect(res.body.id).toBeTruthy();
    expect(db.channels.rows.find((c: any) => c.name === 'announcements')).toBeTruthy();
  });

  it('ADMIN creates an internal-only channel', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/projects/${PROJECT_ID}/channels`)
      .set('x-test-session', session(ADMIN_ID, 'ADMIN'))
      .send({ name: 'staff-only', internal_only: true })
      .expect(201);

    expect(res.body).toMatchObject({
      name: 'staff-only',
      kind: 'general',
      internal_only: true,
      status: 'active',
    });
    const row = db.channels.rows.find((c: any) => c.name === 'staff-only');
    expect(row).toBeTruthy();
    expect(row.internal_only).toBe(true);
  });

  it('Employee (USER role) cannot create a channel — 403, no row created', async () => {
    await request(app.getHttpServer())
      .post(`/api/projects/${PROJECT_ID}/channels`)
      .set('x-test-session', session(EMPLOYEE_ID, 'USER'))
      .send({ name: 'nope' })
      .expect(403);

    expect(db.channels.rows.filter((c: any) => c.name === 'nope')).toHaveLength(0);
  });

  // ── External user access ───────────────────────────────────────────────

  it('External user list omits internal-only channels', async () => {
    // Create an internal-only channel
    db.channels.rows.push({
      id: 'ch-internal',
      project_id: PROJECT_ID,
      kind: 'general',
      name: 'staff-notes',
      internal_only: true,
      status: 'active',
      created_at: new Date(),
    });

    // Also seed the default 'general' channel to avoid lazy-create
    db.channels.rows.push({
      id: 'ch-general',
      project_id: PROJECT_ID,
      kind: 'general',
      name: 'general',
      internal_only: false,
      status: 'active',
      created_at: new Date(),
    });

    // External user (is_internal: false org) should not see internal-only
    const res = await request(app.getHttpServer())
      .get(`/api/projects/${PROJECT_ID}/channels`)
      .set('x-test-session', session(EXTERNAL_ID, 'USER', EXTERNAL_ORG_ID))
      .expect(200);

    const names = res.body.general.map((c: any) => c.name);
    expect(names).not.toContain('staff-notes');
    expect(names).toContain('general');
  });

  it('External user gets 403 on GET /api/channels/:id/messages for internal-only channel', async () => {
    db.channels.rows.push({
      id: 'ch-internal',
      project_id: PROJECT_ID,
      kind: 'general',
      name: 'staff-notes',
      internal_only: true,
      status: 'active',
    });

    await request(app.getHttpServer())
      .get('/api/channels/ch-internal/messages')
      .set('x-test-session', session(EXTERNAL_ID, 'USER', EXTERNAL_ORG_ID))
      .expect(403);
  });

  // ── Non-member access ──────────────────────────────────────────────────

  it('USER not a project member gets 403 on GET list', async () => {
    await request(app.getHttpServer())
      .get(`/api/projects/${PROJECT_ID}/channels`)
      .set('x-test-session', session(OUTSIDER_ID, 'USER'))
      .expect(403);
  });

  it('USER not a project member gets 403 on GET /api/channels/:id/messages', async () => {
    db.channels.rows.push({
      id: 'ch-pub',
      project_id: PROJECT_ID,
      kind: 'general',
      name: 'general',
      internal_only: false,
      status: 'active',
    });

    await request(app.getHttpServer())
      .get('/api/channels/ch-pub/messages')
      .set('x-test-session', session(OUTSIDER_ID, 'USER'))
      .expect(403);
  });

  // ── Unauthenticated ────────────────────────────────────────────────────

  it('GET list without a session returns 401', async () => {
    await request(app.getHttpServer())
      .get(`/api/projects/${PROJECT_ID}/channels`)
      .expect(401);
  });

  it('POST without a session returns 401', async () => {
    await request(app.getHttpServer())
      .post(`/api/projects/${PROJECT_ID}/channels`)
      .send({ name: 'test' })
      .expect(401);
  });

  it('GET /api/channels/:id/messages without a session returns 401', async () => {
    await request(app.getHttpServer())
      .get('/api/channels/any-channel/messages')
      .expect(401);
  });
});
