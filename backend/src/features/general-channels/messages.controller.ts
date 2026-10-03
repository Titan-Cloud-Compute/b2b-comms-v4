import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { SessionPayload } from '../../auth/session.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ChannelAccessPolicy } from './channel-access.policy';
import { requireSession } from './channels.controller';
import { isBlankHtml, sanitizeMessageHtml } from './message-sanitizer';
import { RealtimeService } from './realtime.service';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export interface MessageItem {
  id: string;
  author: { id: string; display_name: string };
  body_html: string;
  attachments: { file_id: string; name: string }[];
  reference_id: string | null;
  edited_at: string | null;
  created_at: string;
}

export interface MessagePage {
  items: MessageItem[];
  next_cursor: string | null;
}

export interface PostMessageBody {
  body_html?: unknown;
  attachments?: unknown;
  reference_id?: unknown;
}

export interface CreatedMessage {
  id: string;
  channel_id: string;
  author_id: string;
  body_html: string;
  created_at: string;
}

interface MessageRow {
  id: string;
  channel_id: string | null;
  author_id: string | null;
  body_html: string | null;
  edited_at: Date | null;
  deleted_at: Date | null;
  created_at: Date | null;
  createdAt: Date;
}

function toFileIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw
    .map((a) => (typeof a === 'string' ? a : a && typeof a === 'object' ? (a as { file_id?: unknown }).file_id : null))
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  return Array.from(new Set(ids));
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

@Controller('api')
export class MessagesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: ChannelAccessPolicy,
    private readonly realtime: RealtimeService,
  ) {}

  /** GET /api/channels/:id/messages?cursor=&limit= — newest page first, items oldest→newest. */
  @Get('channels/:id/messages')
  async list(
    @Param('id') channelId: string,
    @Req() req: Request,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<MessagePage> {
    const session = requireSession(req);
    await this.policy.assertChannelAccess(session, channelId);
    const take = Math.min(Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const before = cursor ? new Date(cursor) : null;
    if (before && Number.isNaN(before.getTime())) throw new BadRequestException('invalid cursor');

    const rows: MessageRow[] = await this.prisma.messages.findMany({
      where: {
        channel_id: channelId,
        deleted_at: null,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
    });
    const hasMore = rows.length > take;
    const page = rows.slice(0, take).reverse();
    const items = await this.hydrate(page);
    return {
      items,
      next_cursor: hasMore && page.length ? page[0].createdAt.toISOString() : null,
    };
  }

  /** POST /api/channels/:id/messages — 400 when blank; body_html is sanitized before storing. */
  @Post('channels/:id/messages')
  @HttpCode(201)
  async create(
    @Param('id') channelId: string,
    @Body() body: PostMessageBody,
    @Req() req: Request,
  ): Promise<CreatedMessage> {
    const session = requireSession(req);
    const bodyHtml = sanitizeMessageHtml(body?.body_html);
    const fileIds = toFileIds(body?.attachments);
    const referenceId = typeof body?.reference_id === 'string' && body.reference_id ? body.reference_id : null;
    if (isBlankHtml(bodyHtml) && fileIds.length === 0 && !referenceId) {
      throw new BadRequestException('message must contain text, an attachment or a reference');
    }
    const channel = await this.policy.assertChannelAccess(session, channelId);
    if (channel.status === 'archived') throw new ForbiddenException('channel is archived');

    const now = new Date();
    const msg = await this.prisma.messages.create({
      data: {
        channel_id: channelId,
        author_id: session.userId,
        body_html: bodyHtml,
        created_at: now,
      },
    });
    if (fileIds.length) {
      await this.prisma.message_attachments.createMany({
        data: fileIds.map((file_id) => ({ message_id: msg.id, file_id })),
      });
    }
    const created: CreatedMessage = {
      id: msg.id,
      channel_id: channelId,
      author_id: session.userId,
      body_html: bodyHtml,
      created_at: (msg.created_at ?? now).toISOString(),
    };
    const [item] = await this.hydrate([msg as MessageRow]);
    void this.realtime
      .publish({
        type: 'message.created',
        channel_id: channelId,
        payload: { ...item, reference_id: item?.reference_id ?? referenceId } as unknown as Record<string, unknown>,
      })
      .catch(() => undefined);
    return created;
  }

  /** PATCH /api/messages/:id — author only (others 403); stores edited_at. */
  @Patch('messages/:id')
  async update(
    @Param('id') id: string,
    @Body() body: PostMessageBody,
    @Req() req: Request,
  ): Promise<{ id: string; body_html: string; edited_at: string }> {
    const session = requireSession(req);
    const msg = await this.loadOwnMessage(session, id);
    const bodyHtml = sanitizeMessageHtml(body?.body_html);
    if (isBlankHtml(bodyHtml)) throw new BadRequestException('message body cannot be blank');
    const editedAt = new Date();
    await this.prisma.messages.update({ where: { id }, data: { body_html: bodyHtml, edited_at: editedAt } });
    const out = { id, body_html: bodyHtml, edited_at: editedAt.toISOString() };
    void this.realtime
      .publish({ type: 'message.updated', channel_id: msg.channel_id ?? '', payload: { ...out } })
      .catch(() => undefined);
    return out;
  }

  /** DELETE /api/messages/:id — author only (others 403); soft-deletes via deleted_at. */
  @Delete('messages/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Req() req: Request): Promise<void> {
    const session = requireSession(req);
    const msg = await this.loadOwnMessage(session, id);
    const deletedAt = new Date();
    await this.prisma.messages.update({ where: { id }, data: { deleted_at: deletedAt } });
    void this.realtime
      .publish({
        type: 'message.deleted',
        channel_id: msg.channel_id ?? '',
        payload: { id, deleted_at: deletedAt.toISOString() },
      })
      .catch(() => undefined);
  }

  private async loadOwnMessage(session: SessionPayload, id: string): Promise<MessageRow> {
    const msg: MessageRow | null = await this.prisma.messages.findUnique({ where: { id } });
    if (!msg || msg.deleted_at) throw new NotFoundException('message not found');
    if (msg.author_id !== session.userId) {
      throw new ForbiddenException('you can only change your own messages');
    }
    if (msg.channel_id) await this.policy.assertChannelAccess(session, msg.channel_id);
    return msg;
  }

  private async hydrate(rows: MessageRow[]): Promise<MessageItem[]> {
    if (!rows.length) return [];
    const messageIds = rows.map((r) => r.id);
    const authorIds = Array.from(new Set(rows.map((r) => r.author_id).filter((x): x is string => !!x)));
    const [users, atts, refs] = await Promise.all([
      authorIds.length
        ? this.prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true, email: true } })
        : Promise.resolve([] as { id: string; name: string | null; email: string }[]),
      this.prisma.message_attachments.findMany({ where: { message_id: { in: messageIds } } }),
      this.prisma.references.findMany({ where: { message_id: { in: messageIds } }, select: { id: true, message_id: true } }),
    ]);
    const fileIds = atts.map((a) => a.file_id).filter((x): x is string => !!x);
    const files = fileIds.length
      ? await this.prisma.files.findMany({ where: { id: { in: fileIds } }, select: { id: true, name: true } })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));
    const fileName = new Map(files.map((f) => [f.id, f.name ?? '']));
    const refByMsg = new Map(refs.map((r) => [r.message_id, r.id]));

    return rows.map((r) => {
      const u = r.author_id ? userById.get(r.author_id) : undefined;
      return {
        id: r.id,
        author: {
          id: r.author_id ?? '',
          display_name: u?.name || u?.email || 'Unknown user',
        },
        body_html: r.body_html ?? '',
        attachments: atts
          .filter((a) => a.message_id === r.id && a.file_id)
          .map((a) => ({ file_id: a.file_id as string, name: fileName.get(a.file_id as string) ?? '' })),
        reference_id: refByMsg.get(r.id) ?? null,
        edited_at: iso(r.edited_at),
        created_at: (r.created_at ?? r.createdAt).toISOString(),
      };
    });
  }
}
