/**
 * InvitationsAccept HTTP spec — tests POST /api/invitations/accept.
 * Uses real JwtAuthGuard + GlobalExceptionFilter with a test JWT secret
 * and a fully in-memory fake PrismaService.
 */
import { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import * as cookieParser from 'cookie-parser';
import request = require('supertest');
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { GlobalExceptionFilter } from '../../common/global-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { InvitationsAcceptController } from './invitations-accept.controller';
import { InvitationsAcceptService } from './invitations-accept.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function makeDb() {
  const users: Row[] = [];
  const invitations: Row[] = [];
  const projects: Row[] = [];
  let seq = 0;
  const nextId = () => `id-${++seq}`;

  function matchesWhere(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([k, cond]) => {
      const v = row[k] ?? null;
      if (cond === null || cond === undefined) return v === null || v === undefined;
      if (typeof cond === 'object' && !Array.isArray(cond)) {
        if ('in' in cond) return (cond.in as unknown[]).includes(v);
        return false;
      }
      return v === cond;
    });
  }

  const userTable = {
    rows: users,
    findUnique: async (args: any) => {
      const r = users.find((x) => matchesWhere(x, args.where));
      return r ? { ...r } : null;
    },
    create: async (args: any) => {
      const row: Row = { id: nextId(), createdAt: new Date(), ...args.data };
      if (users.some((u) => u.email === row.email)) {
        throw new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`email`)',
          { code: 'P2002', clientVersion: '7', meta: { target: ['email'] } },
        );
      }
      users.push(row);
      return { ...row };
    },
  };

  const invitationTable = {
    findFirst: async (args: any = {}) => {
      const r = invitations.find((x) => matchesWhere(x, args.where));
      return r ? { ...r } : null;
    },
  };

  const projectTable = {
    findUnique: async (args: any) => {
      const r = projects.find((x) => matchesWhere(x, args.where));
      return r ? { ...r } : null;
    },
  };

  const fakeTx = {
    user: userTable,
    invitations: invitationTable,
    projects: projectTable,
  };

  return {
    users,
    invitations,
    projects,
    user: userTable,
    runAsAdmin: async (fn: (tx: any) => any) => fn(fakeTx),
    $connect: async () => undefined,
    $disconnect: async () => undefined,
  };
}

describe('InvitationsAccept HTTP', () => {
  let app: INestApplication;
  let db: ReturnType<typeof makeDb>;

  const VALID_TOKEN = 'abc123validtoken';
  const EXPIRED_TOKEN = 'expiredtoken999';
  const ACCEPTED_TOKEN = 'acceptedtoken111';
  const UNKNOWN_TOKEN = 'unknowntokenxyz';
  const EXISTING_TOKEN = 'existingemailtoken';
  const EXISTING_EMAIL = 'existing@example.com';
  const ORG_ID = 'org-1';
  const PROJECT_ID = 'proj-1';

  beforeAll(async () => {
    db = makeDb();

    // Seed project
    db.projects.push({
      id: PROJECT_ID,
      organization_id: ORG_ID,
      name: 'Test Project',
    });

    // Seed invitations
    db.invitations.push({
      id: 'inv-valid',
      token_hash: sha256hex(VALID_TOKEN),
      status: 'pending',
      email: 'newuser@example.com',
      project_id: PROJECT_ID,
      expires_at: new Date(Date.now() + 86_400_000), // 1 day from now
    });

    db.invitations.push({
      id: 'inv-expired',
      token_hash: sha256hex(EXPIRED_TOKEN),
      status: 'pending',
      email: 'expired@example.com',
      project_id: PROJECT_ID,
      expires_at: new Date(Date.now() - 1_000), // 1 s ago
    });

    db.invitations.push({
      id: 'inv-accepted',
      token_hash: sha256hex(ACCEPTED_TOKEN),
      status: 'accepted',
      email: 'alreadyaccepted@example.com',
      project_id: PROJECT_ID,
      expires_at: new Date(Date.now() + 86_400_000),
    });

    // Invitation for an email that already has a users row
    db.invitations.push({
      id: 'inv-existing',
      token_hash: sha256hex(EXISTING_TOKEN),
      status: 'pending',
      email: EXISTING_EMAIL,
      project_id: PROJECT_ID,
      expires_at: new Date(Date.now() + 86_400_000),
    });

    // Pre-seed the user row so the duplicate-email path is exercised
    db.users.push({
      id: 'user-existing',
      email: EXISTING_EMAIL,
      role: 'USER',
      organization_id: ORG_ID,
      active: true,
      createdAt: new Date(),
    });

    const mod = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: 'test', signOptions: { expiresIn: '1h' } }),
      ],
      controllers: [InvitationsAcceptController],
      providers: [
        InvitationsAcceptService,
        { provide: PrismaService, useValue: db },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
      ],
    }).compile();

    app = mod.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── Happy path ──────────────────────────────────────────────────────────────

  it('returns 201 with user+project_id and sets session cookie for a valid token', async () => {
    const before = db.users.length;

    const res = await request(app.getHttpServer())
      .post('/api/invitations/accept')
      .send({ token: VALID_TOKEN, password: 'password123', display_name: 'New User' })
      .expect(201);

    expect(res.body).toMatchObject({
      user: {
        id: expect.any(String),
        email: 'newuser@example.com',
        role: 'USER',
        organization_id: ORG_ID,
      },
      project_id: PROJECT_ID,
    });
    expect(res.headers['set-cookie']).toBeDefined();
    // Exactly one new users row
    expect(db.users.length).toBe(before + 1);
    // The new row has the project's organization_id
    const newUser = db.users[db.users.length - 1];
    expect(newUser.organization_id).toBe(ORG_ID);
  });

  // ─── Error paths ─────────────────────────────────────────────────────────────

  it('returns 400 for an expired token and creates no users row', async () => {
    const before = db.users.length;

    const res = await request(app.getHttpServer())
      .post('/api/invitations/accept')
      .send({ token: EXPIRED_TOKEN, password: 'password123' })
      .expect(400);

    expect(res.body).toHaveProperty('error');
    expect(db.users.length).toBe(before);
  });

  it('returns 400 for an unknown token and creates no users row', async () => {
    const before = db.users.length;

    const res = await request(app.getHttpServer())
      .post('/api/invitations/accept')
      .send({ token: UNKNOWN_TOKEN, password: 'password123' })
      .expect(400);

    expect(res.body).toHaveProperty('error');
    expect(db.users.length).toBe(before);
  });

  it('returns 400 when invitation status is not pending and creates no users row', async () => {
    const before = db.users.length;

    const res = await request(app.getHttpServer())
      .post('/api/invitations/accept')
      .send({ token: ACCEPTED_TOKEN, password: 'password123' })
      .expect(400);

    expect(res.body).toHaveProperty('error');
    expect(db.users.length).toBe(before);
  });

  it('returns 400 when email already has a users row and creates no new users row', async () => {
    const before = db.users.length;

    const res = await request(app.getHttpServer())
      .post('/api/invitations/accept')
      .send({ token: EXISTING_TOKEN, password: 'password123' })
      .expect(400);

    expect(res.body).toHaveProperty('error');
    expect(db.users.length).toBe(before);
  });

  it('returns 400 for a second accept of the same token (user already created)', async () => {
    // The happy-path test already created a user for VALID_TOKEN's email.
    const before = db.users.length;

    const res = await request(app.getHttpServer())
      .post('/api/invitations/accept')
      .send({ token: VALID_TOKEN, password: 'password123' })
      .expect(400);

    expect(res.body).toHaveProperty('error');
    expect(db.users.length).toBe(before);
  });

  // ─── Validation / field errors ───────────────────────────────────────────────

  it('returns 400 with fields when token is blank', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/invitations/accept')
      .send({ token: '', password: 'password123' })
      .expect(400);

    expect(res.body).toHaveProperty('fields');
  });

  it('returns 400 with fields when token is missing', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/invitations/accept')
      .send({ password: 'password123' })
      .expect(400);

    expect(res.body).toHaveProperty('fields');
  });

  it('returns 400 with fields when password is under 8 characters', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/invitations/accept')
      .send({ token: VALID_TOKEN, password: 'short' })
      .expect(400);

    expect(res.body).toHaveProperty('fields');
  });
});
