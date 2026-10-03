import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { InvitationMailerService } from './invitation-mailer.service';
import { fakePrisma, FakeDb } from './fake-prisma.helper-spec';

/* eslint-disable @typescript-eslint/no-explicit-any */
const req = (session: any) => ({ session }) as unknown as Request;

describe('ProjectsController', () => {
  let db: FakeDb;
  let ctrl: ProjectsController;
  let internalOrg: any;
  let admin: any, manager: any, employee: any;

  beforeEach(async () => {
    db = fakePrisma();
    const service = new ProjectsService(db as any, new InvitationMailerService());
    ctrl = new ProjectsController(service);
    internalOrg = await db.organizations.create({ data: { name: 'Us', type: 'internal', is_internal: true } });
    admin = await db.user.create({ data: { email: 'a@x.io', role: 'ADMIN', organization_id: internalOrg.id } });
    manager = await db.user.create({ data: { email: 'm@x.io', role: 'MANAGER', organization_id: internalOrg.id } });
    employee = await db.user.create({ data: { email: 'e@x.io', role: 'USER', organization_id: internalOrg.id } });
  });

  const s = (u: any) => ({ userId: u.id, role: u.role, organizationId: u.organization_id });

  it('manager creates a project with a default channel and member row', async () => {
    const res = await ctrl.create(req(s(manager)), { organization_name: ' Acme ', organization_type: 'vendor' });
    expect(res).toEqual(expect.objectContaining({ name: 'Acme', status: 'active' }));
    expect(res.default_channel_id).toBeTruthy();
    expect(db.organizations.rows.find((o: any) => o.id === res.organization_id)?.type).toBe('vendor');
    expect(db.projects.rows).toHaveLength(1);
    expect(db.channels.rows[0].project_id).toBe(res.id);
    expect(db.project_members.rows[0]).toEqual(expect.objectContaining({ project_id: res.id, user_id: manager.id }));
  });

  it('rejects a blank organization name with 400 and creates nothing', async () => {
    await expect(ctrl.create(req(s(manager)), { organization_name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    expect(db.projects.rows).toHaveLength(0);
  });

  it('employee cannot create a project (403)', async () => {
    await expect(ctrl.create(req(s(employee)), { organization_name: 'Acme', organization_type: 'client' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(db.projects.rows).toHaveLength(0);
  });

  it('employee lists only assigned projects with organization names', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push((await ctrl.create(req(s(manager)), { organization_name: `Org ${i}`, organization_type: 'customer' })).id);
    }
    await ctrl.addMember(req(s(manager)), ids[1], { user_id: employee.id });
    await ctrl.addMember(req(s(manager)), ids[3], { user_id: employee.id });
    const list = await ctrl.list(req(s(employee)));
    expect(list.total).toBe(2);
    expect(list.page).toBe(1);
    expect(list.items.map((i) => i.organization.name).sort()).toEqual(['Org 1', 'Org 3']);
    expect(list.items[0].organization.type).toBe('customer');
    expect((await ctrl.list(req(s(admin)))).total).toBe(5);
  });

  it('get returns detail with organization and members; non-members get 403', async () => {
    const p = await ctrl.create(req(s(manager)), { organization_name: 'Globex', organization_type: 'client' });
    const detail = await ctrl.get(req(s(manager)), p.id);
    expect(detail.organization.name).toBe('Globex');
    expect(detail.members).toEqual([expect.objectContaining({ id: manager.id, role: 'manager' })]);
    await expect(ctrl.get(req(s(employee)), p.id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('external user of company A cannot read company B project', async () => {
    const a = await ctrl.create(req(s(manager)), { organization_name: 'A', organization_type: 'vendor' });
    const b = await ctrl.create(req(s(manager)), { organization_name: 'B', organization_type: 'vendor' });
    const ext = await db.user.create({ data: { email: 'x@a.io', role: 'USER', organization_id: a.organization_id } });
    await ctrl.addMember(req(s(manager)), a.id, { user_id: ext.id });
    await ctrl.addMember(req(s(manager)), b.id, { user_id: ext.id });
    expect((await ctrl.get(req(s(ext)), a.id)).id).toBe(a.id);
    await expect(ctrl.get(req(s(ext)), b.id)).rejects.toBeInstanceOf(ForbiddenException);
    const list = await ctrl.list(req(s(ext)));
    expect(list.items.map((i) => i.id)).toEqual([a.id]);
  });

  it('patch renames a project', async () => {
    const p = await ctrl.create(req(s(manager)), { organization_name: 'Acme', organization_type: 'other' });
    expect(await ctrl.update(req(s(manager)), p.id, { name: 'Acme Q3' })).toEqual({ id: p.id, name: 'Acme Q3', status: 'active' });
  });

  it('admin archives: hidden from list, writes 403, data retained', async () => {
    const p = await ctrl.create(req(s(manager)), { organization_name: 'Acme', organization_type: 'vendor' });
    await expect(ctrl.archive(req(s(manager)), p.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await ctrl.archive(req(s(admin)), p.id)).toEqual({ id: p.id, status: 'archived' });
    expect((await ctrl.list(req(s(admin)))).total).toBe(0);
    await expect(ctrl.update(req(s(admin)), p.id, { name: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctrl.addMember(req(s(admin)), p.id, { user_id: employee.id })).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.projects.rows).toHaveLength(1);
    expect(db.channels.rows).toHaveLength(1);
  });

  it('add member returns the project_members shape', async () => {
    const p = await ctrl.create(req(s(manager)), { organization_name: 'Acme', organization_type: 'vendor' });
    const m = await ctrl.addMember(req(s(admin)), p.id, { user_id: employee.id });
    expect(m).toEqual(expect.objectContaining({ project_id: p.id, user_id: employee.id }));
    expect(m.added_at).toBeInstanceOf(Date);
  });
});
