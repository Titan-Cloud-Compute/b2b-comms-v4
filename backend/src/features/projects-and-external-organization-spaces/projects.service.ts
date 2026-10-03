import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { InvitationMailerService } from './invitation-mailer.service';

/** The subset of the session payload this feature needs. */
export interface Actor {
  userId: string;
  role: string;
  organizationId?: string | null;
}

export const ORGANIZATION_TYPES = ['vendor', 'customer', 'client', 'other'] as const;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PAGE_SIZE = 100;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function notArchived(): Record<string, unknown> {
  return { OR: [{ status: null }, { status: { not: 'archived' } }] };
}

@Injectable()
export class ProjectsService implements OnApplicationBootstrap {
  private readonly logger = new Logger('ProjectsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: InvitationMailerService,
  ) {}

  private get db(): Db {
    return this.prisma as Db;
  }

  // ── actor helpers ──────────────────────────────────────────────────────

  private requireActor(actor: Actor | undefined): Actor {
    if (!actor || !actor.userId) throw new UnauthorizedException('not authenticated');
    return actor;
  }

  /** External = the user's organization is a non-internal (customer/vendor/…) org. */
  private async isExternal(actor: Actor): Promise<boolean> {
    let orgId = actor.organizationId ?? null;
    if (!orgId) {
      const user = await this.db.user.findUnique({ where: { id: actor.userId } });
      orgId = user?.organization_id ?? null;
    }
    if (!orgId) return false;
    const org = await this.db.organizations.findUnique({ where: { id: orgId } });
    return !!org && org.is_internal === false;
  }

  private async actorOrgId(actor: Actor): Promise<string | null> {
    if (actor.organizationId) return actor.organizationId;
    const user = await this.db.user.findUnique({ where: { id: actor.userId } });
    return user?.organization_id ?? null;
  }

  private isStaff(actor: Actor): boolean {
    return actor.role === 'ADMIN' || actor.role === 'MANAGER';
  }

  private async canSeeAll(actor: Actor): Promise<boolean> {
    return this.isStaff(actor) && !(await this.isExternal(actor));
  }

  private async isMember(projectId: string, userId: string): Promise<boolean> {
    const m = await this.db.project_members.findFirst({ where: { project_id: projectId, user_id: userId } });
    return !!m;
  }

  private async loadProject(id: string) {
    const project = await this.db.projects.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('project not found');
    return project;
  }

  /** 403 unless the actor may see this project (body never includes project data). */
  private async assertAccess(actor: Actor, project: { id: string; organization_id: string | null }) {
    if (await this.isExternal(actor)) {
      const orgId = await this.actorOrgId(actor);
      if (project.organization_id !== orgId || !(await this.isMember(project.id, actor.userId))) {
        throw new ForbiddenException('forbidden');
      }
      return;
    }
    if (this.isStaff(actor)) return;
    if (!(await this.isMember(project.id, actor.userId))) throw new ForbiddenException('forbidden');
  }

  private assertWritable(project: { status: string | null }) {
    if (project.status === 'archived') throw new ForbiddenException('project is archived');
  }

  private async assertCanManage(actor: Actor) {
    if (!(await this.canSeeAll(actor))) throw new ForbiddenException('forbidden');
  }

  // ── projects ───────────────────────────────────────────────────────────

  async list(rawActor: Actor | undefined, page = 1, pageSize = 20) {
    const actor = this.requireActor(rawActor);
    const p = Math.max(1, Math.floor(Number(page) || 1));
    const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(pageSize) || 20)));

    const where: Record<string, unknown> = { ...notArchived() };
    if (!(await this.canSeeAll(actor))) {
      const memberships: { project_id: string | null }[] = await this.db.project_members.findMany({
        where: { user_id: actor.userId },
      });
      const ids = memberships.map((m) => m.project_id).filter((x): x is string => !!x);
      where.id = { in: ids };
      if (await this.isExternal(actor)) where.organization_id = await this.actorOrgId(actor);
    }

    const [total, rows] = await Promise.all([
      this.db.projects.count({ where }),
      this.db.projects.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (p - 1) * size, take: size }),
    ]);
    const orgIds = [...new Set(rows.map((r: { organization_id: string | null }) => r.organization_id).filter(Boolean))];
    const orgs: { id: string; name: string | null; type: string | null }[] = orgIds.length
      ? await this.db.organizations.findMany({ where: { id: { in: orgIds } } })
      : [];
    const orgById = new Map(orgs.map((o) => [o.id, o]));

    return {
      items: rows.map((r: { id: string; name: string | null; status: string | null; organization_id: string | null }) => {
        const org = r.organization_id ? orgById.get(r.organization_id) : undefined;
        return {
          id: r.id,
          name: r.name ?? org?.name ?? '',
          status: r.status ?? 'active',
          organization: { id: org?.id ?? r.organization_id ?? '', name: org?.name ?? '', type: org?.type ?? 'other' },
        };
      }),
      page: p,
      total,
    };
  }

  async create(
    rawActor: Actor | undefined,
    body: { organization_name?: unknown; organization_type?: unknown; name?: unknown } | undefined,
  ) {
    const actor = this.requireActor(rawActor);
    await this.assertCanManage(actor);
    const orgName = typeof body?.organization_name === 'string' ? body.organization_name.trim() : '';
    if (!orgName) throw new BadRequestException('organization_name is required');
    const type = body?.organization_type ?? 'other';
    if (typeof type !== 'string' || !(ORGANIZATION_TYPES as readonly string[]).includes(type)) {
      throw new BadRequestException(`organization_type must be one of ${ORGANIZATION_TYPES.join(', ')}`);
    }
    const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : orgName;
    const now = new Date();

    return this.db.$transaction(async (tx: Db) => {
      const org = await tx.organizations.create({
        data: { name: orgName, type, is_internal: false, created_at: now },
      });
      const project = await tx.projects.create({
        data: { organization_id: org.id, name, status: 'active', created_by: actor.userId, created_at: now },
      });
      const channel = await tx.channels.create({
        data: {
          project_id: project.id, kind: 'general', name: 'General', internal_only: false,
          status: 'active', created_by: actor.userId, created_at: now,
        },
      });
      await tx.project_members.create({ data: { project_id: project.id, user_id: actor.userId, added_at: now } });
      return {
        id: project.id,
        name: project.name,
        organization_id: org.id,
        status: project.status,
        default_channel_id: channel.id,
      };
    });
  }

  async get(rawActor: Actor | undefined, id: string) {
    const actor = this.requireActor(rawActor);
    const project = await this.loadProject(id);
    await this.assertAccess(actor, project);
    const org = project.organization_id
      ? await this.db.organizations.findUnique({ where: { id: project.organization_id } })
      : null;
    const memberships: { user_id: string | null }[] = await this.db.project_members.findMany({
      where: { project_id: project.id },
    });
    const userIds = memberships.map((m) => m.user_id).filter((x): x is string => !!x);
    const users: { id: string; display_name: string | null; name: string | null; email: string; role: string; organization_id: string | null }[] =
      userIds.length ? await this.db.user.findMany({ where: { id: { in: userIds } } }) : [];
    const internalByOrg = new Map<string, boolean>();
    for (const u of users) {
      if (u.organization_id && !internalByOrg.has(u.organization_id)) {
        const o = await this.db.organizations.findUnique({ where: { id: u.organization_id } });
        internalByOrg.set(u.organization_id, !o || o.is_internal !== false);
      }
    }
    const roleLabel = (u: (typeof users)[number]) => {
      if (u.organization_id && internalByOrg.get(u.organization_id) === false) return 'external';
      return u.role === 'ADMIN' ? 'admin' : u.role === 'MANAGER' ? 'manager' : 'employee';
    };
    return {
      id: project.id,
      name: project.name ?? org?.name ?? '',
      status: project.status ?? 'active',
      organization: { id: org?.id ?? project.organization_id ?? '', name: org?.name ?? '', type: org?.type ?? 'other' },
      members: users.map((u) => ({ id: u.id, display_name: u.display_name ?? u.name ?? u.email, role: roleLabel(u) })),
    };
  }

  async update(rawActor: Actor | undefined, id: string, body: { name?: unknown } | undefined) {
    const actor = this.requireActor(rawActor);
    await this.assertCanManage(actor);
    const project = await this.loadProject(id);
    this.assertWritable(project);
    const data: Record<string, unknown> = {};
    if (body?.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim()) throw new BadRequestException('name must not be blank');
      data.name = body.name.trim();
    }
    const updated = await this.db.projects.update({ where: { id }, data });
    return { id: updated.id, name: updated.name, status: updated.status };
  }

  async archive(rawActor: Actor | undefined, id: string) {
    const actor = this.requireActor(rawActor);
    if (actor.role !== 'ADMIN' || (await this.isExternal(actor))) throw new ForbiddenException('forbidden');
    await this.loadProject(id);
    const updated = await this.db.projects.update({ where: { id }, data: { status: 'archived' } });
    return { id: updated.id, status: updated.status };
  }

  async addMember(rawActor: Actor | undefined, id: string, body: { user_id?: unknown } | undefined) {
    const actor = this.requireActor(rawActor);
    await this.assertCanManage(actor);
    const project = await this.loadProject(id);
    this.assertWritable(project);
    const userId = typeof body?.user_id === 'string' ? body.user_id : '';
    if (!userId) throw new BadRequestException('user_id is required');
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('user not found');
    const existing = await this.db.project_members.findFirst({ where: { project_id: id, user_id: userId } });
    const row = existing ?? (await this.db.project_members.create({
      data: { project_id: id, user_id: userId, added_at: new Date() },
    }));
    return { project_id: row.project_id, user_id: row.user_id, added_at: row.added_at };
  }

  // ── invitations ────────────────────────────────────────────────────────

  private async deliver(email: string, token: string): Promise<'sent' | 'failed'> {
    try {
      await this.mailer.sendInvitation(email, token);
      return 'sent';
    } catch (err) {
      this.logger.warn(`invitation email to ${email} failed: ${err instanceof Error ? err.message : err}`);
      return 'failed';
    }
  }

  async invite(rawActor: Actor | undefined, projectId: string, body: { email?: unknown } | undefined) {
    const actor = this.requireActor(rawActor);
    await this.assertCanManage(actor);
    const project = await this.loadProject(projectId);
    this.assertWritable(project);
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('a valid email is required');
    const token = randomBytes(32).toString('hex');
    const inv = await this.db.invitations.create({
      data: {
        project_id: projectId, email, token_hash: hashToken(token), status: 'pending',
        invited_by: actor.userId, expires_at: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
    const delivery = await this.deliver(email, token);
    return { id: inv.id, project_id: inv.project_id, email: inv.email, status: inv.status, delivery, expires_at: inv.expires_at };
  }

  async resend(rawActor: Actor | undefined, invitationId: string) {
    const actor = this.requireActor(rawActor);
    await this.assertCanManage(actor);
    const inv = await this.db.invitations.findUnique({ where: { id: invitationId } });
    if (!inv) throw new NotFoundException('invitation not found');
    if (inv.status !== 'pending') throw new BadRequestException(`invitation is ${inv.status}`);
    if (inv.project_id) this.assertWritable(await this.loadProject(inv.project_id));
    const token = randomBytes(32).toString('hex');
    const updated = await this.db.invitations.update({
      where: { id: invitationId },
      data: { token_hash: hashToken(token), expires_at: new Date(Date.now() + INVITE_TTL_MS) },
    });
    const delivery = await this.deliver(updated.email, token);
    return { id: updated.id, status: updated.status, delivery, expires_at: updated.expires_at };
  }

  async accept(body: { token?: unknown; password?: unknown; display_name?: unknown } | undefined) {
    const token = typeof body?.token === 'string' ? body.token : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!token) throw new BadRequestException('token is required');
    if (password.length < 8) throw new BadRequestException('password must be at least 8 characters');
    const inv = await this.db.invitations.findFirst({ where: { token_hash: hashToken(token) } });
    if (!inv || inv.status !== 'pending') throw new BadRequestException('invitation is invalid or already used');
    if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
      throw new BadRequestException('invitation has expired');
    }
    const project = await this.loadProject(inv.project_id);
    const existing = await this.db.user.findUnique({ where: { email: inv.email } });
    if (existing) throw new ConflictException('an account with this email already exists');
    const hash = await bcrypt.hash(password, 10);
    const now = new Date();
    const displayName = typeof body?.display_name === 'string' && body.display_name.trim()
      ? body.display_name.trim() : inv.email;

    return this.db.$transaction(async (tx: Db) => {
      // The auth enum has no EXTERNAL role; externality is carried by the
      // non-internal organization the user is scoped to.
      const user = await tx.user.create({
        data: {
          email: inv.email, passwordHash: hash, password_hash: hash, name: displayName,
          display_name: displayName, role: 'USER', organization_id: project.organization_id,
          active: true, created_at: now,
        },
      });
      await tx.invitations.update({ where: { id: inv.id }, data: { status: 'accepted' } });
      await tx.project_members.create({ data: { project_id: project.id, user_id: user.id, added_at: now } });
      return { id: inv.id, status: 'accepted', user_id: user.id, project_id: project.id, role: 'external' };
    });
  }

  // ── demo seed ──────────────────────────────────────────────────────────

  /**
   * Fresh environments have no projects, so the home screen would be empty.
   * Seed two demo spaces once (only when the table is empty) and assign the
   * existing internal users. Disable with SEED_DEMO_PROJECTS=false.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (process.env.SEED_DEMO_PROJECTS === 'false' || process.env.NODE_ENV === 'test') return;
    try {
      if ((await this.db.projects.count()) > 0) return;
      const users: { id: string; organization_id: string | null }[] = await this.db.user.findMany({});
      const internalUsers: string[] = [];
      for (const u of users) {
        const org = u.organization_id
          ? await this.db.organizations.findUnique({ where: { id: u.organization_id } })
          : null;
        if (!org || org.is_internal !== false) internalUsers.push(u.id);
      }
      const now = new Date();
      for (const [orgName, type] of [['Acme Supplies', 'vendor'], ['Globex Corporation', 'customer']]) {
        const org = await this.db.organizations.create({ data: { name: orgName, type, is_internal: false, created_at: now } });
        const project = await this.db.projects.create({
          data: { organization_id: org.id, name: orgName, status: 'active', created_by: internalUsers[0] ?? null, created_at: now },
        });
        await this.db.channels.create({
          data: { project_id: project.id, kind: 'general', name: 'General', internal_only: false, status: 'active', created_at: now },
        });
        for (const userId of internalUsers) {
          await this.db.project_members.create({ data: { project_id: project.id, user_id: userId, added_at: now } });
        }
      }
      this.logger.log(`seeded demo projects for ${internalUsers.length} users`);
    } catch (err) {
      this.logger.warn(`demo project seed skipped: ${err instanceof Error ? err.message : err}`);
    }
  }
}
