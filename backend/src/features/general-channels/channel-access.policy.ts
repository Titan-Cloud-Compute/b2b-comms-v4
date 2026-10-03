import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { SessionPayload } from '../../auth/session.types';

export interface ChannelRow {
  id: string;
  project_id: string | null;
  kind: string | null;
  name: string | null;
  internal_only: boolean | null;
  status: string | null;
  created_by: string | null;
  created_at: Date | null;
}

export interface ProjectRow {
  id: string;
  organization_id: string | null;
  created_by: string | null;
}

/** Roles allowed to create channels. Employees (USER) are not. */
export const CHANNEL_CREATOR_ROLES: readonly string[] = ['MANAGER', 'ADMIN'];

/**
 * Access rules for General Channels:
 *  - a project is visible to ADMINs, its creator, its members, and users of
 *    the project's own organization;
 *  - External users (organization.is_internal === false) never see channels
 *    marked internal_only — they are filtered from lists and direct access
 *    returns 403.
 */
@Injectable()
export class ChannelAccessPolicy {
  constructor(private readonly prisma: PrismaService) {}

  canCreateChannel(session: SessionPayload): boolean {
    return CHANNEL_CREATOR_ROLES.includes(String(session.role));
  }

  async isExternal(session: SessionPayload): Promise<boolean> {
    const orgId = session.organizationId;
    if (!orgId) return false;
    const org = await this.prisma.organizations.findUnique({ where: { id: orgId } });
    return !!org && org.is_internal === false;
  }

  async loadProject(projectId: string): Promise<ProjectRow> {
    const project = await this.prisma.projects.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('project not found');
    return project;
  }

  async canAccessProject(session: SessionPayload, project: ProjectRow): Promise<boolean> {
    if (session.role === 'ADMIN') return true;
    if (project.created_by && project.created_by === session.userId) return true;
    if (project.organization_id && session.organizationId && project.organization_id === session.organizationId) {
      return true;
    }
    const member = await this.prisma.project_members.findFirst({
      where: { project_id: project.id, user_id: session.userId },
    });
    return !!member;
  }

  async assertProjectAccess(session: SessionPayload, projectId: string): Promise<ProjectRow> {
    const project = await this.loadProject(projectId);
    if (!(await this.canAccessProject(session, project))) {
      throw new ForbiddenException('not a member of this project');
    }
    return project;
  }

  /** Throws 404 when the channel is missing, 403 when the user may not see it. */
  async assertChannelAccess(session: SessionPayload, channelId: string): Promise<ChannelRow> {
    const channel = await this.prisma.channels.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('channel not found');
    if (!(await this.canSeeChannel(session, channel))) {
      throw new ForbiddenException('you do not have access to this channel');
    }
    return channel;
  }

  /** Non-throwing variant used by the realtime fan-out. */
  async canSeeChannel(session: SessionPayload, channel: ChannelRow): Promise<boolean> {
    if (channel.internal_only && (await this.isExternal(session))) return false;
    if (!channel.project_id) return session.role === 'ADMIN';
    const project = await this.prisma.projects.findUnique({ where: { id: channel.project_id } });
    if (!project) return false;
    return this.canAccessProject(session, project);
  }

  async canSeeChannelId(session: SessionPayload, channelId: string): Promise<boolean> {
    const channel = await this.prisma.channels.findUnique({ where: { id: channelId } });
    if (!channel) return false;
    return this.canSeeChannel(session, channel);
  }
}
