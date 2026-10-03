import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Actor } from './general-channels.types';
import { canViewChannel } from './channel-access.policy';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/**
 * Resolves caller context (member? external?) and enforces object-level
 * authorization for projects and channels.
 *
 * Exported so the forthcoming Messages and Realtime units can reuse it.
 */
@Injectable()
export class ChannelAccessService {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): Db {
    return this.prisma as Db;
  }

  /**
   * Returns true when the actor belongs to a non-internal (vendor/customer/…)
   * organization — i.e. they are an External user.
   */
  async isExternal(actor: Actor): Promise<boolean> {
    let orgId = actor.organizationId ?? null;
    if (!orgId) {
      const user = await this.db.user.findUnique({ where: { id: actor.userId } });
      orgId = (user?.organization_id as string | null) ?? null;
    }
    if (!orgId) return false;
    const org = await this.db.organizations.findUnique({ where: { id: orgId } });
    return !!org && org.is_internal === false;
  }

  /** True when actor has a project_members row for the given project. */
  async isMember(projectId: string, userId: string): Promise<boolean> {
    const m = await this.db.project_members.findFirst({
      where: { project_id: projectId, user_id: userId },
    });
    return !!m;
  }

  /**
   * Throws 404 when the project does not exist.
   * Throws 403 when the actor is not allowed to access it:
   *   - External non-members always get 403.
   *   - Non-staff (USER role) non-members get 403.
   *   - Staff (ADMIN / MANAGER) of internal org always pass.
   * Returns the project row on success.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async assertProjectAccess(actor: Actor, projectId: string): Promise<any> {
    const project = await this.db.projects.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('project not found');

    const ext = await this.isExternal(actor);
    const member = await this.isMember(projectId, actor.userId);

    // External users must be explicit project members.
    if (ext && !member) throw new ForbiddenException('forbidden');

    // Non-staff internal users must also be members.
    if (actor.role !== 'ADMIN' && actor.role !== 'MANAGER' && !member) {
      throw new ForbiddenException('forbidden');
    }

    return project;
  }

  /**
   * Throws 404 when the channel does not exist.
   * Throws 403 when the actor cannot access it (project-level check first,
   * then internal-only gate for external users).
   * Returns the channel row on success.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async assertChannelAccess(actor: Actor, channelId: string): Promise<any> {
    const channel = await this.db.channels.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('channel not found');

    // Verify project-level access first (throws 404/403 on failure).
    await this.assertProjectAccess(actor, channel.project_id);

    const ext = await this.isExternal(actor);
    if (!canViewChannel(channel, ext, true)) {
      throw new ForbiddenException('forbidden');
    }

    return channel;
  }
}
