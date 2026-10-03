/**
 * Channels controller spec — covers all done_when scenarios:
 *
 * 1. GET /api/projects/:id/channels on a project with no channels → 200 with
 *    general[] containing name "general" (lazy create); exactly one row stored.
 * 2. A second call creates no additional channel rows.
 * 3. POST as Manager → 201 {id,name,kind:"general",internal_only,status}; row stored.
 * 4. POST as Admin (with internal_only:true) → 201.
 * 5. POST as Employee → 403; no row created.
 * 6. External user list omits internal-only channels; assertChannelAccess on one → 403
 *    (simulates GET /api/channels/:id/messages access guard).
 * 7. USER non-member → 403.
 * 8. No session → 401.
 */

import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { ChannelAccessService } from './channel-access.service';
import { fakePrisma, FakeDb } from './testing/fake-prisma';

/* eslint-disable @typescript-eslint/no-explicit-any */
const req = (session: any) => ({ session }) as unknown as Request;

describe('ChannelsController', () => {
  let db: FakeDb;
  let access: ChannelAccessService;
  let service: ChannelsService;
  let ctrl: ChannelsController;

  let internalOrg: any;
  let externalOrg: any;
  let admin: any, manager: any, employee: any, external: any, nonMember: any;
  let project: any;

  const s = (u: any) => ({ userId: u.id, role: u.role, organizationId: u.organization_id });

  beforeEach(async () => {
    db = fakePrisma();
    access = new ChannelAccessService(db as any);
    service = new ChannelsService(db as any, access);
    ctrl = new ChannelsController(service);

    internalOrg = await db.organizations.create({
      data: { name: 'Internal Co', is_internal: true },
    });
    externalOrg = await db.organizations.create({
      data: { name: 'External Co', is_internal: false },
    });

    admin = await db.user.create({ data: { email: 'admin@x.io', role: 'ADMIN', organization_id: internalOrg.id } });
    manager = await db.user.create({ data: { email: 'mgr@x.io', role: 'MANAGER', organization_id: internalOrg.id } });
    employee = await db.user.create({ data: { email: 'emp@x.io', role: 'USER', organization_id: internalOrg.id } });
    external = await db.user.create({ data: { email: 'ext@external.io', role: 'USER', organization_id: externalOrg.id } });
    nonMember = await db.user.create({ data: { email: 'nm@x.io', role: 'USER', organization_id: internalOrg.id } });

    // Project belongs to externalOrg so organization cross-checks are realistic.
    project = await db.projects.create({
      data: { name: 'Proj', status: 'active', organization_id: externalOrg.id },
    });

    const now = new Date();
    for (const u of [admin, manager, employee, external]) {
      await db.project_members.create({ data: { project_id: project.id, user_id: u.id, added_at: now } });
    }
    // nonMember is deliberately NOT added.
  });

  // ── 1. Lazy create ─────────────────────────────────────────────────────────

  it('GET on empty project returns 200 with general[] containing name "general"', async () => {
    expect(db.channels.rows).toHaveLength(0);
    const res = await ctrl.list(req(s(admin)), project.id);
    expect(res.general).toHaveLength(1);
    expect(res.general[0].name).toBe('general');
    expect(res.general[0].internal_only).toBe(false);
    expect(typeof res.general[0].unread_count).toBe('number');
    expect(db.channels.rows).toHaveLength(1);
    expect(db.channels.rows[0].kind).toBe('general');
  });

  // ── 2. Idempotent default channel ─────────────────────────────────────────

  it('second GET call creates no additional default channel', async () => {
    await ctrl.list(req(s(admin)), project.id);
    await ctrl.list(req(s(admin)), project.id);
    expect(db.channels.rows.filter((c: any) => c.kind === 'general')).toHaveLength(1);
  });

  // ── 3. POST as Manager → 201 ───────────────────────────────────────────────

  it('POST as Manager returns 201 and stores the row', async () => {
    const res = await ctrl.create(req(s(manager)), project.id, { name: 'design' });
    expect(res).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        name: 'design',
        kind: 'general',
        internal_only: false,
        status: 'active',
      }),
    );
    expect(db.channels.rows.find((c: any) => c.id === res.id)).toBeDefined();
  });

  // ── 4. POST as Admin with internal_only → 201 ─────────────────────────────

  it('POST as Admin with internal_only:true returns 201', async () => {
    const res = await ctrl.create(req(s(admin)), project.id, { name: 'internal-chat', internal_only: true });
    expect(res.internal_only).toBe(true);
    expect(res.kind).toBe('general');
    expect(res.status).toBe('active');
    expect(db.channels.rows.find((c: any) => c.id === res.id)?.internal_only).toBe(true);
  });

  // ── 5. POST as Employee → 403, no row ─────────────────────────────────────

  it('POST as Employee returns 403 and creates no channel row', async () => {
    await expect(
      ctrl.create(req(s(employee)), project.id, { name: 'my-channel' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.channels.rows).toHaveLength(0);
  });

  // ── 6. External user: list filters + message access denied ────────────────

  it('external user list omits internal-only; assertChannelAccess on one returns 403', async () => {
    const internalCh = await ctrl.create(req(s(admin)), project.id, {
      name: 'internal-ch',
      internal_only: true,
    });
    await ctrl.create(req(s(admin)), project.id, { name: 'public-ch', internal_only: false });

    const res = await ctrl.list(req(s(external)), project.id);

    // Internal-only channel must be absent from the external user's list.
    expect(res.general.find((c: any) => c.id === internalCh.id)).toBeUndefined();
    // Public channel must be visible.
    expect(res.general.find((c: any) => c.name === 'public-ch')).toBeDefined();

    // Simulates GET /api/channels/:id/messages: assertChannelAccess → 403 for external user.
    await expect(
      access.assertChannelAccess(s(external), internalCh.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── 7. Non-member USER → 403 ──────────────────────────────────────────────

  it('non-member USER gets 403 on list', async () => {
    await expect(ctrl.list(req(s(nonMember)), project.id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('non-member USER gets 403 on create (employee role check fires first)', async () => {
    // Employee role → canCreateChannel returns false before membership is checked
    await expect(
      ctrl.create(req(s(nonMember)), project.id, { name: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── 8. No session → 401 ───────────────────────────────────────────────────

  it('no session returns 401 on list', async () => {
    await expect(ctrl.list(req(undefined), project.id)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('no session returns 401 on create', async () => {
    await expect(
      ctrl.create(req(undefined), project.id, { name: 'x' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // ── extra: 404 on unknown project ─────────────────────────────────────────

  it('list returns 404 when the project does not exist', async () => {
    await expect(ctrl.list(req(s(admin)), 'no-such-project')).rejects.toBeInstanceOf(NotFoundException);
  });
});
