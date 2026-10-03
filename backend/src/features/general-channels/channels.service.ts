import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { SessionPayload } from '../../auth/session.types';
import { ChannelAccessService } from './channel-access.service';
import { canCreateChannel } from './channel-access.policy';
import type {
  ChannelListResponse,
  ChannelResponse,
  CreateChannelRequest,
} from './general-channels.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChannelAccessService,
  ) {}

  private get db(): Db {
    return this.prisma as Db;
  }

  /**
   * List channels for a project.
   * Lazily creates the default "general" channel if none exists yet.
   * External users do not see internal_only channels.
   */
  async list(session: SessionPayload | undefined, projectId: string): Promise<ChannelListResponse> {
    if (!session?.userId) throw new UnauthorizedException('not authenticated');
    const { isExternal } = await this.access.assertProjectAccess(session, projectId);

    const channels: Db[] = await this.prisma.runAsAdmin(async (tx: Db) => {
      // Idempotent: ensure exactly one kind='general'/name='general' default channel.
      const generalDefault: Db = await tx.channels.findFirst({
        where: { project_id: projectId, kind: 'general', name: 'general' },
      });
      if (!generalDefault) {
        await tx.channels.create({
          data: {
            project_id: projectId,
            kind: 'general',
            name: 'general',
            internal_only: false,
            status: 'active',
            created_by: session.userId,
            created_at: new Date(),
          },
        });
      }
      return tx.channels.findMany({
        where: { project_id: projectId },
        orderBy: { created_at: 'asc' },
      });
    });

    const result: ChannelListResponse = { general: [], questions: [] };
    for (const ch of channels) {
      // Hide internal-only channels from external users.
      if (isExternal && ch.internal_only) continue;

      const readState: Db = await this.db.channel_read_state.findFirst({
        where: { channel_id: ch.id, user_id: session.userId },
      });
      const unread_count: number = readState?.unread_count ?? 0;

      if (ch.kind === 'general') {
        result.general.push({
          id: ch.id as string,
          name: (ch.name ?? '') as string,
          internal_only: !!ch.internal_only,
          unread_count,
        });
      } else if (ch.kind === 'question') {
        result.questions.push({
          id: ch.id as string,
          name: (ch.name ?? '') as string,
          status: (ch.status ?? 'active') as string,
          unread_count,
        });
      }
    }
    return result;
  }

  /**
   * Create a new general channel in a project.
   * Only ADMIN and MANAGER may create channels.
   * Archived projects reject new channels.
   */
  async create(
    session: SessionPayload | undefined,
    projectId: string,
    body: CreateChannelRequest,
  ): Promise<ChannelResponse> {
    if (!session?.userId) throw new UnauthorizedException('not authenticated');
    if (!canCreateChannel(session.role as string)) {
      throw new ForbiddenException('only ADMIN or MANAGER can create channels');
    }

    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80) {
      throw new BadRequestException('name must be between 1 and 80 characters');
    }

    await this.access.assertProjectAccess(session, projectId);

    const project: Db = await this.db.projects.findUnique({ where: { id: projectId } });
    if (project?.status === 'archived') {
      throw new ForbiddenException('project is archived');
    }

    const channel: Db = await this.db.channels.create({
      data: {
        project_id: projectId,
        kind: 'general',
        name,
        internal_only: !!body.internal_only,
        status: 'active',
        created_by: session.userId,
        created_at: new Date(),
      },
    });

    return {
      id: channel.id as string,
      name: (channel.name ?? '') as string,
      kind: (channel.kind ?? 'general') as string,
      internal_only: !!channel.internal_only,
      status: (channel.status ?? 'active') as string,
    };
  }
}
