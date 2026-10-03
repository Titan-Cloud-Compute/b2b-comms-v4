import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { SessionPayload } from '../../auth/session.types';
import { canViewProject, canViewChannel } from './channel-access.policy';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

@Injectable()
export class ChannelAccessService {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): Db {
    return this.prisma as Db;
  }

  /**
   * Returns true when the user's organization is a non-internal (external) org.
   */
  async isExternal(session: SessionPayload): Promise<boolean> {
    const orgId = session.organizationId ?? null;
    if (!orgId) return false;
    const org: Db = await this.db.organizations.findUnique({ where: { id: orgId } });
    return !!org && org.is_internal === false;
  }

  async isMember(projectId: string, userId: string): Promise<boolean> {
    const m: Db = await this.db.project_members.findFirst({
      where: { project_id: projectId, user_id: userId },
    });
    return !!m;
  }

  /**
   * Throws 404 if the project doesn't exist.
   * Throws 403 if the caller has no view access to the project.
   * Returns { isExternal } for downstream use.
   */
  async assertProjectAccess(
    session: SessionPayload | undefined,
    projectId: string,
  ): Promise<{ isExternal: boolean }> {
    if (!session?.userId) throw new UnauthorizedException('not authenticated');
    const project: Db = await this.db.projects.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('project not found');
    const memberFlag = await this.isMember(projectId, session.userId);
    if (!canViewProject(session.role as string, memberFlag)) {
      throw new ForbiddenException('forbidden');
    }
    const ext = await this.isExternal(session);
    return { isExternal: ext };
  }

  /**
   * Throws 404 if the channel doesn't exist.
   * Throws 403 if the caller cannot access the channel (not a project member,
   * or channel is internal_only and caller is external).
   * Returns { channel, isExternal } for downstream use.
   */
  async assertChannelAccess(
    session: SessionPayload | undefined,
    channelId: string,
  ): Promise<{ channel: Db; isExternal: boolean }> {
    if (!session?.userId) throw new UnauthorizedException('not authenticated');
    const channel: Db = await this.db.channels.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('channel not found');
    const memberFlag = channel.project_id
      ? await this.isMember(channel.project_id as string, session.userId)
      : false;
    const canProject = canViewProject(session.role as string, memberFlag);
    const ext = await this.isExternal(session);
    if (!canViewChannel(channel, ext, canProject)) {
      throw new ForbiddenException('forbidden');
    }
    return { channel, isExternal: ext };
  }
}
