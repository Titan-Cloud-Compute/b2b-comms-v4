import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChannelAccessService } from './channel-access.service';
import { sanitizeMessageHtml, isBlankHtml } from './message-sanitizer';
import type { SessionPayload } from '../../auth/session.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface CreateMessageDto {
  body_html?: unknown;
  attachments?: unknown;
}

export interface ListMessagesQuery {
  cursor?: unknown;
  limit?: unknown;
}

export interface UpdateMessageDto {
  body_html?: unknown;
}

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChannelAccessService,
  ) {}

  private get db(): Db {
    return this.prisma as Db;
  }

  /** POST /api/channels/:id/messages */
  async create(session: SessionPayload, channelId: string, dto: CreateMessageDto) {
    const rawHtml = typeof dto.body_html === 'string' ? dto.body_html : '';
    if (rawHtml.length > 20000) throw new BadRequestException('body_html too long');

    const attachments: string[] = Array.isArray(dto.attachments)
      ? (dto.attachments as unknown[])
          .filter((a): a is string => typeof a === 'string')
          .slice(0, 10)
      : [];
    if (attachments.length > 10) throw new BadRequestException('too many attachments');

    // Assert channel access — also returns the channel row with project_id.
    const { channel } = await this.access.assertChannelAccess(session, channelId);
    const projectId: string = channel.project_id as string;

    // Sanitize body and validate it is non-blank (unless attachments present).
    const body_html = sanitizeMessageHtml(rawHtml);
    if (isBlankHtml(body_html) && attachments.length === 0) {
      throw new BadRequestException('message is empty');
    }

    // Validate every attachment file exists in this project and is not deleted.
    for (const fileId of attachments) {
      const file: Db = await this.db.files.findFirst({
        where: { id: fileId, project_id: projectId, deleted_at: null },
      });
      if (!file) throw new BadRequestException(`file not found: ${fileId}`);
    }

    return this.prisma.runAsAdmin(async (tx: Db) => {
      const now = new Date();
      const msg: Db = await tx.messages.create({
        data: {
          channel_id: channelId,
          author_id: session.userId,
          body_html,
          created_at: now,
        },
      });
      for (const fileId of attachments) {
        await tx.message_attachments.create({
          data: { message_id: msg.id, file_id: fileId },
        });
      }
      return {
        id: msg.id as string,
        channel_id: msg.channel_id as string,
        author_id: msg.author_id as string,
        body_html: msg.body_html as string,
        created_at: msg.created_at as Date,
      };
    });
  }

  /** GET /api/channels/:id/messages */
  async list(session: SessionPayload, channelId: string, query: ListMessagesQuery = {}) {
    await this.access.assertChannelAccess(session, channelId);

    const rawLimit = Number(query.limit ?? 50);
    const limit = isNaN(rawLimit) ? 50 : Math.min(Math.max(1, rawLimit), 100);

    // Build WHERE clause, optionally applying a keyset cursor.
    const where: Db = { channel_id: channelId, deleted_at: null };

    if (query.cursor && typeof query.cursor === 'string') {
      try {
        const decoded = JSON.parse(
          Buffer.from(query.cursor as string, 'base64').toString('utf8'),
        ) as { c: string; i: string };
        // Keyset: (created_at < cursor.c) OR (created_at = cursor.c AND id < cursor.i)
        where.OR = [
          { created_at: { lt: decoded.c } },
          { AND: [{ created_at: decoded.c }, { id: { lt: decoded.i } }] },
        ];
      } catch {
        // Ignore malformed cursors — fall back to first page.
      }
    }

    const rows: Db[] = await this.db.messages.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items: Db[] = hasMore ? rows.slice(0, limit) : rows;

    const nextCursor: string | null = hasMore
      ? Buffer.from(
          JSON.stringify({
            c: items[items.length - 1].created_at,
            i: items[items.length - 1].id,
          }),
        ).toString('base64')
      : null;

    // Batch-fetch authors.
    const authorIds = [...new Set(items.map((m: Db) => m.author_id as string).filter(Boolean))];
    const users: Db[] = authorIds.length > 0
      ? await this.db.users.findMany({ where: { id: { in: authorIds } } })
      : [];
    const userMap = new Map<string, Db>(users.map((u: Db) => [u.id as string, u]));

    // Batch-fetch attachments and their file names.
    const messageIds = items.map((m: Db) => m.id as string);
    const msgAttachRows: Db[] =
      messageIds.length > 0
        ? await this.db.message_attachments.findMany({ where: { message_id: { in: messageIds } } })
        : [];

    const fileIds = [
      ...new Set(msgAttachRows.map((a: Db) => a.file_id as string).filter(Boolean)),
    ];
    const fileRows: Db[] =
      fileIds.length > 0
        ? await this.db.files.findMany({ where: { id: { in: fileIds } } })
        : [];
    const fileMap = new Map<string, Db>(fileRows.map((f: Db) => [f.id as string, f]));

    // Batch-fetch references (at most one per message).
    const refRows: Db[] =
      messageIds.length > 0
        ? await this.db.references.findMany({ where: { message_id: { in: messageIds } } })
        : [];
    const refMap = new Map<string, string>(
      refRows.map((r: Db) => [r.message_id as string, r.id as string]),
    );

    // Assemble the response items.
    const responseItems = items.map((msg: Db) => {
      const author = userMap.get(msg.author_id as string);
      const attachments = msgAttachRows
        .filter((a: Db) => a.message_id === msg.id)
        .map((a: Db) => ({
          file_id: a.file_id as string,
          name: (fileMap.get(a.file_id as string)?.name as string | null) ?? null,
        }));
      return {
        id: msg.id as string,
        author: {
          id: msg.author_id as string,
          display_name: author
            ? ((author.display_name ?? author.name ?? author.email ?? null) as string | null)
            : null,
        },
        body_html: (msg.body_html as string) ?? '',
        attachments,
        reference_id: refMap.get(msg.id as string) ?? null,
        edited_at: (msg.edited_at as Date | null) ?? null,
        created_at: msg.created_at as Date,
      };
    });

    return { items: responseItems, next_cursor: nextCursor };
  }

  /** PATCH /api/messages/:id */
  async update(session: SessionPayload, messageId: string, dto: UpdateMessageDto) {
    const msg: Db = await this.db.messages.findFirst({
      where: { id: messageId, deleted_at: null },
    });
    if (!msg) throw new NotFoundException('message not found');

    await this.access.assertChannelAccess(session, msg.channel_id as string);

    if ((msg.author_id as string) !== session.userId) {
      throw new ForbiddenException('only the author can edit this message');
    }

    const rawHtml = typeof dto.body_html === 'string' ? dto.body_html : '';
    const body_html = sanitizeMessageHtml(rawHtml);
    if (isBlankHtml(body_html)) throw new BadRequestException('message is empty');

    return this.prisma.runAsAdmin(async (tx: Db) => {
      const now = new Date();
      const updated: Db = await tx.messages.update({
        where: { id: messageId },
        data: { body_html, edited_at: now },
      });
      return {
        id: updated.id as string,
        body_html: updated.body_html as string,
        edited_at: updated.edited_at as Date,
      };
    });
  }

  /** DELETE /api/messages/:id */
  async remove(session: SessionPayload, messageId: string) {
    const msg: Db = await this.db.messages.findFirst({
      where: { id: messageId, deleted_at: null },
    });
    if (!msg) throw new NotFoundException('message not found');

    await this.access.assertChannelAccess(session, msg.channel_id as string);

    if ((msg.author_id as string) !== session.userId) {
      throw new ForbiddenException('only the author can delete this message');
    }

    await this.prisma.runAsAdmin(async (tx: Db) => {
      await tx.messages.update({
        where: { id: messageId },
        data: { deleted_at: new Date() },
      });
    });
  }
}
