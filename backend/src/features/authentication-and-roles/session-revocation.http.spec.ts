/**
 * HTTP integration spec: JwtAuthGuard re-checks the account on every request.
 *
 * Proves:
 *   1. An active user gets 200 on GET /api/auth/me.
 *   2. A user flipped to active=false gets 401 on the next request, and the
 *      response carries a Set-Cookie header that clears the session cookie.
 *   3. A deleted user (row removed from DB) gets 401 + cleared cookie.
 *   4. A user whose DB role changed from ADMIN to USER gets 403 on an
 *      @RequireAdmin() route (role enforcement uses the live DB value, not the
 *      value baked into the JWT).
 */
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  INestApplication,
  Module,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import { GlobalExceptionFilter } from '../../common/global-exception.filter';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard, RequireAdmin } from '../../auth/roles.guard';
import { AuthController } from '../../auth/auth.controller';
import { AuthService } from '../../auth/auth.service';
import { Public } from '../../auth/decorators/public.decorator';
import { SESSION_COOKIE_NAME } from '../../auth/session-cookie';

const JWT_SECRET = 'test-secret';

// ─── In-memory user store ────────────────────────────────────────────────────

interface FakeUser {
  id: string;
  role: string;
  active: boolean | null;
  organization_id: string | null;
}

const users: Map<string, FakeUser> = new Map();

// ─── Fake PrismaService ───────────────────────────────────────────────────────

class FakePrismaService {
  runAsAdmin<T>(fn: (tx: any) => T): T {
    const tx = {
      user: {
        findUnique: ({ where, select }: any) => {
          const u = users.get(where.id);
          if (!u) return Promise.resolve(null);
          const result: any = {};
          if (select?.id) result.id = u.id;
          if (select?.role) result.role = u.role;
          if (select?.active) result.active = u.active;
          if ('active' in select) result.active = u.active;
          if (select?.organization_id) result.organization_id = u.organization_id;
          return Promise.resolve(result);
        },
        count: () => Promise.resolve(users.size),
      },
    };
    return fn(tx) as T;
  }
}

// ─── Tiny test controller ─────────────────────────────────────────────────────

@Controller('api/test-admin')
class TestAdminController {
  @RequireAdmin()
  @Get()
  @HttpCode(HttpStatus.OK)
  adminOnly() {
    return { ok: true };
  }
}

// ─── Fake AuthService ─────────────────────────────────────────────────────────

class FakeAuthService {
  async getCurrentUser(userId: string) {
    const u = users.get(userId);
    if (!u) throw new Error('not found');
    return { id: u.id, email: 'user@test.local', name: 'Test User', role: u.role };
  }
  async login() { throw new Error('not implemented'); }
  async signup() { throw new Error('not implemented'); }
  async updateProfile() { throw new Error('not implemented'); }
  async changePassword() { throw new Error('not implemented'); }
  async createInvite() { throw new Error('not implemented'); }
  async requestPasswordReset() { return; }
  async confirmPasswordReset() { return false; }
  async previewRegistrationToken() { return { valid: false, models: [] }; }
  async issueToken() { return ''; }
}

// ─── Test module ──────────────────────────────────────────────────────────────

@Module({
  imports: [JwtModule.register({ secret: JWT_SECRET })],
  controllers: [AuthController, TestAdminController],
  providers: [
    { provide: 'PrismaService', useClass: FakePrismaService },
    // Provide PrismaService under its class token so JwtAuthGuard's DI resolves.
    { provide: FakePrismaService, useClass: FakePrismaService },
    { provide: AuthService, useClass: FakeAuthService },
    JwtAuthGuard,
    RolesGuard,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
class TestAppModule {}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cookieHeader(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function isSessionCleared(setCookieHeader: string | string[] | undefined): boolean {
  if (!setCookieHeader) return false;
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  return headers.some((h) => {
    const lower = h.toLowerCase();
    // Either the cookie value is empty (session=;) OR the Expires is in the past.
    if (lower.startsWith(`${SESSION_COOKIE_NAME.toLowerCase()}=;`)) return true;
    if (lower.startsWith(`${SESSION_COOKIE_NAME.toLowerCase()}=`) &&
        lower.includes('max-age=0')) return true;
    if (lower.includes('expires=') && !lower.includes('max-age=0')) {
      // Check if expires is in the past
      const match = lower.match(/expires=([^;]+)/);
      if (match) {
        const exp = new Date(match[1]);
        return exp.getTime() <= Date.now();
      }
    }
    return false;
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('JwtAuthGuard — session revocation (HTTP)', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  beforeAll(async () => {
    // We need to provide PrismaService under its actual class so JwtAuthGuard's
    // constructor injection (private readonly prisma: PrismaService) resolves.
    // Import it so the DI token matches.
    const { PrismaService } = await import('../../prisma/prisma.service');

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: JWT_SECRET })],
      controllers: [AuthController, TestAdminController],
      providers: [
        { provide: PrismaService, useClass: FakePrismaService },
        { provide: AuthService, useClass: FakeAuthService },
        JwtAuthGuard,
        RolesGuard,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    jwtService = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    users.clear();
  });

  async function signToken(userId: string, role: string): Promise<string> {
    return jwtService.signAsync({ userId, role, firmId: null });
  }

  // ── Scenario 1: active user ────────────────────────────────────────────────

  it('returns 200 on GET /api/auth/me for an active user', async () => {
    users.set('u-1', { id: 'u-1', role: 'USER', active: true, organization_id: null });
    const token = await signToken('u-1', 'USER');

    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', cookieHeader(token));

    expect(res.status).toBe(200);
  });

  // ── Scenario 2: deactivated user ──────────────────────────────────────────

  it('returns 401 and clears the session cookie when user is deactivated', async () => {
    users.set('u-2', { id: 'u-2', role: 'USER', active: false, organization_id: null });
    const token = await signToken('u-2', 'USER');

    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', cookieHeader(token));

    expect(res.status).toBe(401);
    const setCookie = res.headers['set-cookie'];
    expect(isSessionCleared(setCookie)).toBe(true);
  });

  // ── Scenario 3: deleted user (row gone) ───────────────────────────────────

  it('returns 401 and clears the session cookie when the user row is deleted', async () => {
    // Sign a token for a user that is NOT in the users map (simulates deletion).
    const token = await signToken('u-deleted', 'USER');

    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', cookieHeader(token));

    expect(res.status).toBe(401);
    const setCookie = res.headers['set-cookie'];
    expect(isSessionCleared(setCookie)).toBe(true);
  });

  // ── Scenario 4: role downgraded in DB → 403 on admin route ───────────────

  it('returns 403 on an admin-only route when the DB role changed from ADMIN to USER', async () => {
    // Token was signed when the user was ADMIN, but DB now shows USER.
    users.set('u-4', { id: 'u-4', role: 'USER', active: true, organization_id: null });
    const token = await signToken('u-4', 'ADMIN');

    const res = await request(app.getHttpServer())
      .get('/api/test-admin')
      .set('Cookie', cookieHeader(token));

    expect(res.status).toBe(403);
    // Cookie should NOT be cleared — the session is still valid, role just changed.
    const setCookie = res.headers['set-cookie'];
    expect(isSessionCleared(setCookie)).toBe(false);
  });
});
