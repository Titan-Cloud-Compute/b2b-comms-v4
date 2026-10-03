/**
 * UsersAdmin HTTP spec — tests GET/POST /api/users and PATCH /api/users/:id.
 * Uses real JwtAuthGuard + RolesGuard with a test JWT secret and cookie-parser,
 * plus a fully in-memory fake PrismaService.
 */
import { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as cookieParser from 'cookie-parser';
import request = require('supertest');
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { GlobalExceptionFilter } from '../../common/global-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersAdminController } from './users-admin.controller';
import { UsersAdminService } from './users-admin.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function makeDb() {
  const users: Row[] = [];
  const organizations: Row[] = [];
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
    findMany: async (args: any = {}) => {
      let out = users.filter((r) => matchesWhere(r, args.where));
      if (args.orderBy?.createdAt === 'desc') {
        out = [...out].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
      }
      if (args.skip) out = out.slice(args.skip as number);
      if (args.take) out = out.slice(0, args.take as number);
      return out.map((r) => ({ ...r }));
    },
    count: async (args: any = {}) => users.filter((r) => matchesWhere(r, args.where)).length,
    findUnique: async (args: any) => {
      const r = users.find((x) => matchesWhere(x, args.where));
      return r ? { ...r } : null;
    },
    findFirst: async (args: any = {}) => {
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
    update: async (args: any) => {
      const r = users.find((x) => matchesWhere(x, args.where));
      if (!r) throw new Error('Record not found');
      Object.assign(r, args.data);
      return { ...r };
    },
  };

  const orgTable = {
    rows: organizations,
    findFirst: async (args: any = {}) => {
      const r = organizations.find((x) => matchesWhere(x, args.where));
      return r ? { ...r } : null;
    },
    create: async (args: any) => {
      const row: Row = { id: nextId(), createdAt: new Date(), ...args.data };
      organizations.push(row);
      return { ...row };
    },
  };

  const fakeTx = { user: userTable, organizations: orgTable };

  return {
    users,
    organizations,
    user: userTable,
    orgTable,
    runAsAdmin: async (fn: (tx: any) => any) => fn(fakeTx),
    // keep $connect / $disconnect as no-ops so the module lifecycle doesn't fail
    $connect: async () => undefined,
    $disconnect: async () => undefined,
  };
}

describe('UsersAdmin HTTP', () => {
  let app: INestApplication;
  let db: ReturnType<typeof makeDb>;
  let adminCookie: string;
  let managerCookie: string;
  let userCookie: string;

  beforeAll(async () => {
    db = makeDb();

    // Pre-seed auth rows so PATCH tests have a target
    db.users.push({ id: 'admin-1', email: 'admin@test.com', role: 'ADMIN', active: true, organization_id: 'org-1', createdAt: new Date(), created_at: new Date() });
    db.users.push({ id: 'manager-1', email: 'manager@test.com', role: 'MANAGER', active: true, organization_id: 'org-1', createdAt: new Date(), created_at: new Date() });
    db.users.push({ id: 'user-1', email: 'user@test.com', role: 'USER', active: true, organization_id: 'org-1', createdAt: new Date(), created_at: new Date() });
    db.organizations.push({ id: 'org-1', name: 'Internal', type: 'internal', is_internal: true, createdAt: new Date() });

    const mod = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: 'test', signOptions: { expiresIn: '1h' } }),
      ],
      controllers: [UsersAdminController],
      providers: [
        UsersAdminService,
        { provide: PrismaService, useValue: db },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
      ],
    }).compile();

    app = mod.createNestApplication();
    app.use(cookieParser());
    await app.init();

    const jwtService = mod.get(JwtService);
    adminCookie = `session=${await jwtService.signAsync({ userId: 'admin-1', role: 'ADMIN', firmId: null })}`;
    managerCookie = `session=${await jwtService.signAsync({ userId: 'manager-1', role: 'MANAGER', firmId: null })}`;
    userCookie = `session=${await jwtService.signAsync({ userId: 'user-1', role: 'USER', firmId: null })}`;
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── GET /api/users ─────────────────────────────────────────────────────────

  describe('GET /api/users', () => {
    it('returns 401 when not authenticated', async () => {
      await request(app.getHttpServer()).get('/api/users').expect(401);
    });

    it('returns 403 for MANAGER', async () => {
      await request(app.getHttpServer())
        .get('/api/users')
        .set('Cookie', managerCookie)
        .expect(403);
    });

    it('returns 403 for USER', async () => {
      await request(app.getHttpServer())
        .get('/api/users')
        .set('Cookie', userCookie)
        .expect(403);
    });

    it('returns 200 with items/page/total for ADMIN', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body).toMatchObject({
        page: 1,
        total: expect.any(Number),
        items: expect.any(Array),
      });
      expect(res.body.total).toBeGreaterThanOrEqual(3);
      const item = res.body.items[0];
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('email');
      expect(item).toHaveProperty('display_name');
      expect(item).toHaveProperty('role');
      expect(item).toHaveProperty('organization_id');
      expect(item).toHaveProperty('active');
      expect(item).toHaveProperty('created_at');
      expect(item).not.toHaveProperty('passwordHash');
      expect(item).not.toHaveProperty('password_hash');
    });
  });

  // ─── POST /api/users ─────────────────────────────────────────────────────────

  describe('POST /api/users', () => {
    it('returns 401 when not authenticated', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .send({ email: 'new@test.com', password: 'password123' })
        .expect(401);
    });

    it('returns 403 for MANAGER', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .set('Cookie', managerCookie)
        .send({ email: 'new@test.com', password: 'password123' })
        .expect(403);
    });

    it('returns 403 for USER', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .set('Cookie', userCookie)
        .send({ email: 'new@test.com', password: 'password123' })
        .expect(403);
    });

    it('returns 400 when email is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .set('Cookie', adminCookie)
        .send({ password: 'password123' })
        .expect(400);
    });

    it('returns 400 when password is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .set('Cookie', adminCookie)
        .send({ email: 'new@test.com' })
        .expect(400);
    });

    it('returns 400 when email is invalid', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .set('Cookie', adminCookie)
        .send({ email: 'not-an-email', password: 'password123' })
        .expect(400);
    });

    it('returns 201 and public user shape when ADMIN creates a user', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .set('Cookie', adminCookie)
        .send({ email: 'Created@Example.com', password: 'password123', display_name: 'Created User' })
        .expect(201);

      expect(res.body).toMatchObject({
        id: expect.any(String),
        email: 'created@example.com',
        display_name: 'Created User',
        role: 'USER',
        active: true,
      });
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('password_hash');
      expect(res.body).not.toHaveProperty('password');
    });

    it('returns 409 for duplicate email', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .set('Cookie', adminCookie)
        .send({ email: 'admin@test.com', password: 'password123' })
        .expect(409);
    });
  });

  // ─── PATCH /api/users/:id ────────────────────────────────────────────────────

  describe('PATCH /api/users/:id', () => {
    it('returns 401 when not authenticated', async () => {
      await request(app.getHttpServer())
        .patch('/api/users/user-1')
        .send({ display_name: 'New Name' })
        .expect(401);
    });

    it('returns 403 for MANAGER', async () => {
      await request(app.getHttpServer())
        .patch('/api/users/user-1')
        .set('Cookie', managerCookie)
        .send({ display_name: 'New Name' })
        .expect(403);
    });

    it('returns 403 for USER', async () => {
      await request(app.getHttpServer())
        .patch('/api/users/user-1')
        .set('Cookie', userCookie)
        .send({ display_name: 'New Name' })
        .expect(403);
    });

    it('returns 404 for unknown id', async () => {
      await request(app.getHttpServer())
        .patch('/api/users/nonexistent-id')
        .set('Cookie', adminCookie)
        .send({ display_name: 'X' })
        .expect(404);
    });

    it('returns 200 with updated row for ADMIN', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/users/user-1')
        .set('Cookie', adminCookie)
        .send({ display_name: 'Updated Name', active: false })
        .expect(200);

      expect(res.body).toMatchObject({
        id: 'user-1',
        email: 'user@test.com',
        display_name: 'Updated Name',
        active: false,
      });
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('password_hash');
    });
  });
});
