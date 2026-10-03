import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { SessionPayload } from '../../auth/session.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ChannelAccessPolicy, ChannelRow } from './channel-access.policy';
import { RealtimeService } from './realtime.service';

export const DEFAULT_CHANNEL_NAME = 'general';

export interface GeneralChannelItem {
  id: string;
  name: string;
  internal_only: boolean;
  unread_count: number;
}

export interface QuestionChannelItem {
  id: string;
  name: string;
  status: string;
  unread_count: number;
}

export interface ChannelListResponse {
  general: GeneralChannelItem[];
  questions: QuestionChannelItem[];
}

export interface CreateChannelBody {
  name?: unknown;
  internal_only?: unknown;
}

export interface CreatedChannel {
  id: string;
  name: string;
  kind: string;
  internal_only: boolean;
  status: string;
}

export function requireSession(req: Request): SessionPayload {
  if (!req.session) throw new UnauthorizedException('not authenticated');
  return req.session;
}

@Controller('api/projects')
export class ChannelsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: ChannelAccessPolicy,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * GET /api/projects/:id/channels — the first open of a project lazily
   * creates its default "general" channel, so the list always contains it.
   */
  @Get(':id/channels')
  async list(@Param('id') projectId: string, @Req() req: Request): Promise<ChannelListResponse> {
    const session = requireSession(req);
    const project = await this.policy.assertProjectAccess(session, projectId);
    await this.ensureDefaultChannel(project.id, project.created_by ?? session.userId);

    const rows: ChannelRow[] = await this.prisma.channels.findMany({
      where: { project_id: project.id },
      orderBy: { createdAt: 'asc' },
    });
    const external = await this.policy.isExternal(session);
    const visible = rows.filter((c) => c.status !== 'archived' && !(external && c.internal_only));

    const reads = visible.length
      ? await this.prisma.channel_read_state.findMany({
          where: { user_id: session.userId, channel_id: { in: visible.map((c) => c.id) } },
        })
      : [];
    const unread = new Map<string, number>();
    for (const r of reads) if (r.channel_id) unread.set(r.channel_id, r.unread_count ?? 0);

    const general: GeneralChannelItem[] = [];
    const questions: QuestionChannelItem[] = [];
    for (const c of visible) {
      if (c.kind === 'question') {
        questions.push({
          id: c.id,
          name: c.name ?? '',
          status: c.status ?? 'open',
          unread_count: unread.get(c.id) ?? 0,
        });
      } else {
        general.push({
          id: c.id,
          name: c.name ?? '',
          internal_only: !!c.internal_only,
          unread_count: unread.get(c.id) ?? 0,
        });
      }
    }
    return { general, questions };
  }

  /** POST /api/projects/:id/channels — Managers and Admins only (Employees get 403). */
  @Post(':id/channels')
  @HttpCode(201)
  async create(
    @Param('id') projectId: string,
    @Body() body: CreateChannelBody,
    @Req() req: Request,
  ): Promise<CreatedChannel> {
    const session = requireSession(req);
    if (!this.policy.canCreateChannel(session)) {
      throw new ForbiddenException('only Managers and Admins can create channels');
    }
    const name = typeof body?.name === 'string' ? body.name.trim().replace(/^#\s*/, '') : '';
    if (!name) throw new BadRequestException('channel name is required');
    if (name.length > 80) throw new BadRequestException('channel name is too long');
    const project = await this.policy.assertProjectAccess(session, projectId);

    const channel = await this.prisma.channels.create({
      data: {
        project_id: project.id,
        kind: 'general',
        name,
        internal_only: body?.internal_only === true || body?.internal_only === 'true',
        status: 'active',
        created_by: session.userId,
        created_at: new Date(),
      },
    });
    const out: CreatedChannel = {
      id: channel.id,
      name: channel.name ?? name,
      kind: channel.kind ?? 'general',
      internal_only: !!channel.internal_only,
      status: channel.status ?? 'active',
    };
    void this.realtime
      .publish({ type: 'channel.created', channel_id: channel.id, payload: { ...out } })
      .catch(() => undefined);
    return out;
  }

  private async ensureDefaultChannel(projectId: string, createdBy: string): Promise<void> {
    const existing = await this.prisma.channels.findFirst({
      where: { project_id: projectId, kind: 'general', name: DEFAULT_CHANNEL_NAME },
    });
    if (existing) return;
    await this.prisma.channels.create({
      data: {
        project_id: projectId,
        kind: 'general',
        name: DEFAULT_CHANNEL_NAME,
        internal_only: false,
        status: 'active',
        created_by: createdBy,
        created_at: new Date(),
      },
    });
  }
}
