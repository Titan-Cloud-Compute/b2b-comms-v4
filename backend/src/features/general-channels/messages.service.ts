import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { ChannelAccessService } from './channel-access.service';
import { sanitizeMessageHtml, isBlankHtml } from './message-sanitizer';
import type {
  Actor,
  CreateMessageRequest,
  UpdateMessageRequest,
  MessageCreatedResponse,
  MessageListResponse,
  MessageUpdatedResponse,
  MessageListQuery,
} from './general-channels.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const createSchema = z.object({
  body_html: z
    .string({ required_error: 'body_html is required' })
    .max(20000, 'body_html must be 20000 characters or fewer')
    .default(''),
  attachments: z
    .array(z.string())
    .max(10, 'at most 10 attachments')
    .optional()
    .default([]),
});

const updateSchema = z.object({
  body_html: z
    .string({ required_error: 'body_html is required' })
    .max(20000)
    .min(1, 'body_html must not be blank'),
});

const listSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function encodeCursor(created_at: Date, id: string): string {
  return Buffer.from(JSON.stringify({ created_at: created_at.toISOString(), id })).toString(
    'base64',
  );
}

function decodeCursor(cursor: string): { created_at: Date; id: string } | null {
  try {
    const data = JSON.parse(Buffer.from(cursor, 'base64').toString()) as {
      created_at: string;
      id: string;
    };
    return { created_at: new Date(data.created_at), id: data.id };
  } catch {
    return null;
  }
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

  private requireActor(actor: Actor | undefined): Actor {
    if (!actor || !actor.userId) throw new UnauthorizedException('not authenticated');
    return actor;
  }

  /**
   * Post a new message to a channel.
   */
  async create(
    rawActor: Actor | undefined,
    channelId: string,
    body: CreateMessageRequest,
  ): Promise<MessageCreatedResponse> {
    const actor = this.requireActor(rawActor);
    const channel = await this.access.assertChannelAccess(actor, channelId);

    const parsed = createSchema.safeParse({
      body_html: body.body_html ?? '',
      attachments: body.attachments ?? [],
    });
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.errors[0]?.message ?? 'invalid request');
    }

    const sanitized = sanitizeMessageHtml(parsed.data.body_html);
    const fileIds: string[] = parsed.data.attachments;

    if (isBlankHtml(sanitized) && fileIds.length === 0) {
      throw new BadRequestException('message is empty');
    }

    // Verify all attachment file IDs exist and belong to the channel's project.
    if (fileIds.length > 0) {
      for (const fileId of fileIds) {
        const file = await this.db.files.findFirst({
          where: { id: fileId, project_id: channel.project_id, deleted_at: null },
        });
        if (!file) {
          throw new BadRequestException(`file ${fileId} not found`);
        }
      }
    }

    const now = new Date();

    return this.db.runAsAdmin(async (tx: Db) => {
      const message = await tx.messages.create({
        data: {
          channel_id: channelId,
          author_id: actor.userId,
          body_html: sanitized,
          created_at: now,
          edited_at: null,
          deleted_at: null,
        },
      });

      for (const fileId of fileIds) {
        await tx.message_attachments.create({
          data: {
            message_id: message.id,
            file_id: fileId,
          },
        });
      }

      return {
        id: message.id as string,
        channel_id: message.channel_id as string,
        author_id: message.author_id as string,
        body_html: message.body_html as string,
        created_at: message.created_at as Date,
      };
    });
  }

  /**
   * List messages in a channel, newest first, with cursor pagination.
   */
  async list(
    rawActor: Actor | undefined,
    channelId: string,
    query: MessageListQuery,
  ): Promise<MessageListResponse> {
    const actor = this.requireActor(rawActor);
    await this.access.assertChannelAccess(actor, channelId);

    const parsed = listSchema.safeParse({
      cursor: query.cursor,
      limit: query.limit ?? 50,
    });
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.errors[0]?.message ?? 'invalid query');
    }

    const { cursor, limit } = parsed.data;

    // Decode cursor
    let cursorWhere: Db = {};
    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (decoded) {
        cursorWhere = {
          OR: [
            { created_at: { lt: decoded.created_at } },
            {
              AND: [{ created_at: decoded.created_at }, { id: { lt: decoded.id } }],
            },
          ],
        };
      }
    }

    const where: Db = {
      channel_id: channelId,
      deleted_at: null,
      ...cursorWhere,
    };

    const rows: Db[] = await this.db.messages.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const next_cursor =
      hasMore && last ? encodeCursor(last.created_at as Date, last.id as string) : null;

    // Enrich each message with author, attachments, and reference_id.
    const enriched = await Promise.all(
      items.map(async (msg: Db) => {
        const authorRow = await this.db.user.findUnique({ where: { id: msg.author_id } });
        const display_name: string =
          (authorRow?.display_name as string | null) ??
          (authorRow?.name as string | null) ??
          (authorRow?.email as string | null) ??
          '';

        const attachmentRows: Db[] = await this.db.message_attachments.findMany({
          where: { message_id: msg.id },
        });

        const attachments = await Promise.all(
          attachmentRows.map(async (att: Db) => {
            const file = await this.db.files.findUnique({ where: { id: att.file_id } });
            return {
              file_id: att.file_id as string,
              name: (file?.name as string | null) ?? '',
            };
          }),
        );

        const ref = await this.db.references.findFirst({ where: { message_id: msg.id } });

        return {
          id: msg.id as string,
          author: { id: msg.author_id as string, display_name },
          body_html: msg.body_html as string,
          attachments,
          reference_id: (ref?.id as string | null) ?? null,
          edited_at: (msg.edited_at as Date | null) ?? null,
          created_at: msg.created_at as Date,
        };
      }),
    );

    return { items: enriched, next_cursor };
  }

  /**
   * Edit a message. Only the original author may edit.
   */
  async update(
    rawActor: Actor | undefined,
    messageId: string,
    body: UpdateMessageRequest,
  ): Promise<MessageUpdatedResponse> {
    const actor = this.requireActor(rawActor);

    const message = await this.db.messages.findFirst({
      where: { id: messageId, deleted_at: null },
    });
    if (!message) throw new NotFoundException('message not found');

    await this.access.assertChannelAccess(actor, message.channel_id as string);

    if ((message.author_id as string) !== actor.userId) {
      throw new ForbiddenException('only the author may edit this message');
    }

    const parsed = updateSchema.safeParse({ body_html: body.body_html });
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.errors[0]?.message ?? 'invalid request');
    }

    const sanitized = sanitizeMessageHtml(parsed.data.body_html);
    if (isBlankHtml(sanitized)) {
      throw new BadRequestException('message is empty');
    }

    const now = new Date();
    const updated = await this.db.messages.update({
      where: { id: messageId },
      data: { body_html: sanitized, edited_at: now },
    });

    return {
      id: updated.id as string,
      body_html: updated.body_html as string,
      edited_at: updated.edited_at as Date,
    };
  }

  /**
   * Soft-delete a message. Only the original author may delete.
   */
  async remove(rawActor: Actor | undefined, messageId: string): Promise<void> {
    const actor = this.requireActor(rawActor);

    const message = await this.db.messages.findFirst({
      where: { id: messageId, deleted_at: null },
    });
    if (!message) throw new NotFoundException('message not found');

    await this.access.assertChannelAccess(actor, message.channel_id as string);

    if ((message.author_id as string) !== actor.userId) {
      throw new ForbiddenException('only the author may delete this message');
    }

    await this.db.messages.update({
      where: { id: messageId },
      data: { deleted_at: new Date() },
    });
  }
}
