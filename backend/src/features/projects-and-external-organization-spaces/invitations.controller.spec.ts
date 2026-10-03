import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { InvitationsController } from './invitations.controller';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { InvitationMailerService } from './invitation-mailer.service';
import { fakePrisma, FakeDb } from './fake-prisma.helper-spec';

/* eslint-disable @typescript-eslint/no-explicit-any */
const req = (session: any) => ({ session }) as unknown as Request;

describe('InvitationsController', () => {
  let db: FakeDb;
  let mailer: InvitationMailerService;
  let projects: ProjectsController;
  let invitations: InvitationsController;
  let manager: any, employee: any, project: any;
  let lastToken = '';

  const s = (u: any) => ({ userId: u.id, role: u.role, organizationId: u.organization_id });

  beforeEach(async () => {
    db = fakePrisma();
    mailer = new InvitationMailerService();
    jest.spyOn(mailer, 'sendInvitation').mockImplementation(async (_e: string, t: string) => { lastToken = t; });
    const service = new ProjectsService(db as any, mailer);
    projects = new ProjectsController(service);
    invitations = new InvitationsController(service);
    const org = await db.organizations.create({ data: { name: 'Us', is_internal: true } });
    manager = await db.user.create({ data: { email: 'm@x.io', role: 'MANAGER', organization_id: org.id } });
    employee = await db.user.create({ data: { email: 'e@x.io', role: 'USER', organization_id: org.id } });
    project = await projects.create(req(s(manager)), { organization_name: 'Acme', organization_type: 'vendor' });
  });

  it('manager invites: pending row with hashed token, delivery sent', async () => {
    const inv = await projects.invite(req(s(manager)), project.id, { email: 'Contact@Acme.com' });
    expect(inv).toEqual(expect.objectContaining({ project_id: project.id, email: 'contact@acme.com', status: 'pending', delivery: 'sent' }));
    expect(inv.expires_at).toBeInstanceOf(Date);
    const row = db.invitations.rows[0];
    expect(row.token_hash).toBeTruthy();
    expect(row.token_hash).not.toBe(lastToken);
  });

  it('employee cannot invite (403) and no row is created', async () => {
    await expect(projects.invite(req(s(employee)), project.id, { email: 'c@acme.com' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.invitations.rows).toHaveLength(0);
  });

  it('email relay down: 201 with delivery failed, row pending, resend works', async () => {
    (mailer.sendInvitation as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const inv = await projects.invite(req(s(manager)), project.id, { email: 'c@acme.com' });
    expect(inv.delivery).toBe('failed');
    expect(db.invitations.rows[0].status).toBe('pending');
    const res = await invitations.resend(req(s(manager)), inv.id);
    expect(res).toEqual(expect.objectContaining({ id: inv.id, status: 'pending', delivery: 'sent' }));
  });

  it('employee cannot resend', async () => {
    const inv = await projects.invite(req(s(manager)), project.id, { email: 'c@acme.com' });
    await expect(invitations.resend(req(s(employee)), inv.id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepting creates an external user scoped to the project organization and a membership', async () => {
    await projects.invite(req(s(manager)), project.id, { email: 'c@acme.com' });
    const res = await invitations.accept({ token: lastToken, password: 'supersecret1' });
    expect(res.status).toBe('accepted');
    const user = db.user.rows.find((u: any) => u.email === 'c@acme.com');
    expect(user?.organization_id).toBe(project.organization_id);
    expect(db.invitations.rows[0].status).toBe('accepted');
    expect(db.project_members.rows.some((m: any) => m.user_id === user?.id && m.project_id === project.id)).toBe(true);
    const detail = await projects.get(req(s(manager)), project.id);
    expect(detail.members.find((m) => m.id === user?.id)?.role).toBe('external');
  });
});
