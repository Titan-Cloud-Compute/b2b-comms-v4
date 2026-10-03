/**
 * POST /api/auth/login — HTTP-level contract spec.
 *
 * Proves four things:
 *   1. Valid credentials → 200 + Set-Cookie containing 'session=' +
 *      body {user:{id,email,display_name,role,organization_id}, landing:'/projects'}
 *      for ADMIN, MANAGER and USER.
 *   2. Wrong password / unknown email / inactive account → 401 {error:'Invalid credentials'}
 *      with NO Set-Cookie header.
 *   3. Blank email → 400 {error, fields:{email}} with NO Set-Cookie.
 *   4. Blank password → 400 {error, fields:{password}} with NO Set-Cookie.
 *
 * Uses a fully in-memory fake PrismaService (no DB).
 * APP_GUARDs are NOT registered so the @Public() decorator is irrelevant here.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import * as bcrypt from 'bcryptjs';
import { AuthController } from '../../auth/auth.controller';
import { AuthService } from '../../auth/auth.service';
import { GlobalExceptionFilter } from '../../common/global-exception.filter';
import { AppConfigService } from '../../config/config.service';
import { MailerService } from '../../auth/mailer.service';
import { PrismaService } from '../../prisma/prisma.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PASSWORD = 'password1234';
const WRONG_PASSWORD = 'wrong-password';

// Pre-hashed at cost 4 (fast for tests).
let hashed: string;

async function buildUsers() {
  hashed = await bcrypt.hash(PASSWORD, 4);
  return [
    {
      id: 'u-admin',
      email: 'admin@demo.local',
      password_hash: hashed,
      passwordHash: hashed,
      display_name: 'Admin User',
      name: 'Admin User',
      role: 'ADMIN',
      organization_id: 'org-1',
      active: true,
    },
    {
      id: 'u-manager',
      email: 'manager@demo.local',
      password_hash: hashed,
      passwordHash: hashed,
      display_name: 'Manager User',
      name: 'Manager User',
      role: 'MANAGER',
      organization_id: 'org-1',
      active: true,
    },
    {
      id: 'u-user',
      email: 'user@demo.local',
      password_hash: hashed,
      passwordHash: hashed,
      display_name: 'Regular User',
      name: 'Regular User',
      role: 'USER',
      organization_id: 'org-1',
      active: true,
    },
    {
      id: 'u-inactive',
      email: 'inactive@demo.local',
      password_hash: hashed,
      passwordHash: hashed,
      display_name: 'Inactive User',
      name: 'Inactive User',
      role: 'USER',
      organization_id: 'org-1',
      active: false,
    },
  ];
}

function makeFakePrisma(users: any[]) {
  const findUnique = jest.fn(async ({ where }: any) => {
    return users.find((u) => u.email === where.email) ?? null;
  });
  const tx = { user: { findUnique } };
  return {
    runAsAdmin: (fn: (t: typeof tx) => unknown) => fn(tx),
  };
}

describe('POST /api/auth/login — contract', () => {
  let app: INestApplication;
  let users: any[];

  beforeAll(async () => {
    users = await buildUsers();
  });

  beforeEach(async () => {
    const fakePrisma = makeFakePrisma(users);

    const mod = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: 'test', signOptions: { expiresIn: '1h' } }),
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: fakePrisma },
        { provide: AppConfigService, useValue: {} },
        { provide: MailerService, useValue: {} },
      ],
    }).compile();

    app = mod.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── Scenario 1: Successful login for each role ──────────────────────────────

  it.each([
    ['ADMIN',   'admin@demo.local',   'Admin User',   'org-1'],
    ['MANAGER', 'manager@demo.local', 'Manager User', 'org-1'],
    ['USER',    'user@demo.local',    'Regular User', 'org-1'],
  ])('%s can log in and receives the correct body and a session cookie',
    async (role, email, displayName, orgId) => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);

      // Session cookie must be set.
      const setCookie = res.headers['set-cookie'] as string | string[] | undefined;
      expect(setCookie).toBeDefined();
      expect(Array.isArray(setCookie) ? setCookie.join(';') : setCookie).toMatch(/session=/);

      // Body shape.
      expect(res.body).toMatchObject({
        user: {
          id: expect.any(String),
          email,
          display_name: displayName,
          role,
          organization_id: orgId,
        },
        landing: '/projects',
      });
    },
  );

  // ── Scenario 2: 401 with no cookie ─────────────────────────────────────────

  it('wrong password → 401 {error:"Invalid credentials"}, no Set-Cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@demo.local', password: WRONG_PASSWORD })
      .expect(401);

    expect(res.body).toMatchObject({ error: 'Invalid credentials' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('unknown email → 401 {error:"Invalid credentials"}, no Set-Cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'nobody@demo.local', password: PASSWORD })
      .expect(401);

    expect(res.body).toMatchObject({ error: 'Invalid credentials' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('inactive account → 401 {error:"Invalid credentials"}, no Set-Cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'inactive@demo.local', password: PASSWORD })
      .expect(401);

    expect(res.body).toMatchObject({ error: 'Invalid credentials' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  // ── Scenario 3 & 4: 400 field errors on blank input ────────────────────────

  it('blank email → 400 with fields.email, no Set-Cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: '', password: PASSWORD })
      .expect(400);

    expect(res.body.fields?.email).toBeDefined();
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('blank password → 400 with fields.password, no Set-Cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@demo.local', password: '' })
      .expect(400);

    expect(res.body.fields?.password).toBeDefined();
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('both blank → 400 with fields.email and fields.password, no Set-Cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: '', password: '' })
      .expect(400);

    expect(res.body.fields?.email).toBeDefined();
    expect(res.body.fields?.password).toBeDefined();
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
