import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { ChannelAccessService } from './channel-access.service';
import { canCreateChannel } from './channel-access.policy';
import type {
  Actor,
  ChannelListResponse,
  ChannelResponse,
  CreateChannelRequest,
} from './general-channels.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const createChannelSchema = z.object({
  name: z
    .string({ required_error: 'name is required' })
    .trim()
    .min(1, 'name must not be blank')
    .max(80, 'name must be 80 characters or fewer'),
  internal_only: z.boolean().optional().default(false),
});

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChannelAccessService,
  ) {}

  private requireActor(actor: Actor | undefined): Actor {
    if (!actor || !actor.userId) throw new UnauthorizedException('not authenticated');
    return actor;
  }

  /**
   * List channels for a project.
   *
   * On first access (no channels exist yet), a default channel named "general"
   * with kind "general" is created atomically. External users never see
   * internal-only channels in the response.
   */
  async list(rawActor: Actor | undefined, projectId: string): Promise<ChannelListResponse> {
    const actor = this.requireActor(rawActor);
    await this.access.assertProjectAccess(actor, projectId);
    const isExternal = await this.access.isExternal(actor);

    return this.prisma.runAsAdmin(async (tx) => {
      const txDb = tx as Db;

      // Lazy-create the default "general" channel if none exists for this project.
      const existingGeneral = await txDb.channels.findFirst({
        where: { project_id: projectId, kind: 'general' },
      });
      if (!existingGeneral) {
        await txDb.channels.create({
          data: {
            project_id: projectId,
            kind: 'general',
            name: 'general',
            internal_only: false,
            status: 'active',
            created_by: actor.userId,
            created_at: new Date(),
          },
        });
      }

      // Load all channels for the project ordered by creation time.
      const allChannels: Db[] = await txDb.channels.findMany({
        where: { project_id: projectId },
        orderBy: { created_at: 'asc' },
      });

      const general: ChannelListResponse['general'] = [];
      const questions: ChannelListResponse['questions'] = [];

      for (const ch of allChannels) {
        // Hide internal-only channels from external users.
        if (ch.internal_only && isExternal) continue;

        // Read unread count (owned by Unread Message Indicators story — read-only here).
        const readState = await txDb.channel_read_state.findFirst({
          where: { channel_id: ch.id, user_id: actor.userId },
        });
        const unread_count: number = (readState?.unread_count as number | null) ?? 0;

        if (ch.kind === 'general') {
          general.push({
            id: ch.id as string,
            name: (ch.name as string) ?? '',
            internal_only: !!(ch.internal_only as boolean | null),
            unread_count,
          });
        } else if (ch.kind === 'question') {
          questions.push({
            id: ch.id as string,
            name: (ch.name as string) ?? '',
            status: (ch.status as string) ?? 'active',
            unread_count,
          });
        }
      }

      return { general, questions };
    });
  }

  /**
   * Create a new general channel in a project.
   * Only ADMIN and MANAGER roles are permitted.
   */
  async create(
    rawActor: Actor | undefined,
    projectId: string,
    body: CreateChannelRequest,
  ): Promise<ChannelResponse> {
    const actor = this.requireActor(rawActor);

    if (!canCreateChannel(actor.role)) {
      throw new ForbiddenException('only managers and admins can create channels');
    }

    const project = await this.access.assertProjectAccess(actor, projectId);
    if (project.status === 'archived') {
      throw new ForbiddenException('project is archived');
    }

    const parsed = createChannelSchema.safeParse({
      name: body.name,
      internal_only: body.internal_only ?? false,
    });
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.errors[0]?.message ?? 'invalid request');
    }

    const { name, internal_only } = parsed.data;
    const now = new Date();

    const channel = await this.prisma.runAsAdmin(async (tx) => {
      const txDb = tx as Db;
      return txDb.channels.create({
        data: {
          project_id: projectId,
          kind: 'general',
          name,
          internal_only,
          status: 'active',
          created_by: actor.userId,
          created_at: now,
        },
      });
    });

    return {
      id: channel.id as string,
      name: channel.name as string,
      kind: channel.kind as string,
      internal_only: !!(channel.internal_only as boolean | null),
      status: channel.status as string,
    };
  }
}
