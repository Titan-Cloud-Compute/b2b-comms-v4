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
import type { Actor } from './general-channels.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const createMessageSchema = z.object({
  body_html: z.string().max(20000, 'message body too long').optional().default(''),
  attachments: z.array(z.string()).max(10, 'too many attachments').optional().default([]),
});

const updateMessageSchema = z.object({
  body_html: z.string().max(20000, 'message body too long'),
});

/** Encode a keyset cursor from created_at and id. */
function encodeCursor(created_at: Date, id: string): string {
  return Buffer.from(`${created_at.toISOString()}|${id}`).toString('base64');
}

/** Decode a cursor back into { created_at, id }. */
function decodeCursor(cursor: string): { created_at: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf8');
    const sep = raw.lastIndexOf('|');
    if (sep === -1) return null;
    const ts = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    const d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    return { created_at: d, id };
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

  // ── POST /api/channels/:id/messages ──────────────────────────────────────

  async create(
    rawActor: Actor | undefined,
    channelId: string,
    body: unknown,
  ) {
    const actor = this.requireActor(rawActor);
    await this.access.assertChannelAccess(actor, channelId);

    const parsed = createMessageSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.errors[0]?.message ?? 'invalid request');
    }
    const { body_html: rawHtml, attachments } = parsed.data;

    const sanitized = sanitizeMessageHtml(rawHtml);

    if (isBlankHtml(sanitized) && attachments.length === 0) {
      throw new BadRequestException('message is empty');
    }

    // Validate all attachment file IDs.
    if (attachments.length > 0) {
      const channel = await this.db.channels.findUnique({ where: { id: channelId } });
      for (const fileId of attachments) {
        const file = await this.db.files.findFirst({
          where: { id: fileId, project_id: channel.project_id, deleted_at: null },
        });
        if (!file) {
          throw new BadRequestException(`file not found: ${fileId}`);
        }
      }
    }

    const now = new Date();

    const message = await this.prisma.runAsAdmin(async (tx: Db) => {
      const msg = await tx.messages.create({
        data: {
          channel_id: channelId,
          author_id: actor.userId,
          body_html: sanitized,
          created_at: now,
        },
      });

      for (const fileId of attachments) {
        await tx.message_attachments.create({
          data: { message_id: msg.id, file_id: fileId },
        });
      }

      return msg;
    });

    return {
      id: message.id as string,
      channel_id: message.channel_id as string,
      author_id: message.author_id as string,
      body_html: message.body_html as string,
      created_at: message.created_at as Date,
    };
  }

  // ── GET /api/channels/:id/messages ───────────────────────────────────────

  async list(
    rawActor: Actor | undefined,
    channelId: string,
    query: { cursor?: string; limit?: number },
  ) {
    const actor = this.requireActor(rawActor);
    await this.access.assertChannelAccess(actor, channelId);

    const limit = Math.min(query.limit ?? 50, 100);
    const fetchCount = limit + 1;

    // Build filter: non-deleted messages in this channel.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { channel_id: channelId, deleted_at: null };

    // Apply keyset cursor (created_at desc, id desc).
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (cursor) {
      // We want messages older than the cursor (earlier created_at, or same time with smaller id).
      where.OR = [
        { created_at: { lt: cursor.created_at } },
        { AND: [{ created_at: cursor.created_at }, { id: { lt: cursor.id } }] },
      ];
    }

    // Fetch all messages matching the filter (fake prisma handles simple sorting).
    const allMessages: Db[] = await this.db.messages.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });

    // Apply secondary sort by id desc and limit.
    const sorted = allMessages.sort((a: Db, b: Db) => {
      const tA = (a.created_at as Date).getTime();
      const tB = (b.created_at as Date).getTime();
      if (tB !== tA) return tB - tA;
      return (b.id as string) > (a.id as string) ? 1 : -1;
    });

    const page = sorted.slice(0, fetchCount);
    const hasMore = page.length > limit;
    const items = hasMore ? page.slice(0, limit) : page;

    // Build response items with author + attachments + reference_id.
    const result = [];
    for (const msg of items) {
      const user = await this.db.user.findUnique({ where: { id: msg.author_id } });
      const atts: Db[] = await this.db.message_attachments.findMany({
        where: { message_id: msg.id },
      });
      const attachmentDetails = [];
      for (const att of atts) {
        const file = await this.db.files.findFirst({ where: { id: att.file_id } });
        attachmentDetails.push({
          file_id: att.file_id as string,
          name: (file?.name as string | null) ?? null,
        });
      }

      const ref = await this.db.references.findFirst({ where: { message_id: msg.id } });

      result.push({
        id: msg.id as string,
        author: {
          id: user?.id as string,
          display_name: (user?.display_name ?? user?.name ?? user?.email ?? null) as string | null,
        },
        body_html: msg.body_html as string,
        attachments: attachmentDetails,
        reference_id: (ref?.id as string | null) ?? null,
        edited_at: (msg.edited_at as Date | null) ?? null,
        created_at: msg.created_at as Date,
      });
    }

    let next_cursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      next_cursor = encodeCursor(last.created_at as Date, last.id as string);
    }

    return { items: result, next_cursor };
  }

  // ── PATCH /api/messages/:id ───────────────────────────────────────────────

  async update(
    rawActor: Actor | undefined,
    messageId: string,
    body: unknown,
  ) {
    const actor = this.requireActor(rawActor);

    const message = await this.db.messages.findFirst({
      where: { id: messageId, deleted_at: null },
    });
    if (!message) throw new NotFoundException('message not found');

    await this.access.assertChannelAccess(actor, message.channel_id);

    if (message.author_id !== actor.userId) {
      throw new ForbiddenException('forbidden');
    }

    const parsed = updateMessageSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.errors[0]?.message ?? 'invalid request');
    }

    const sanitized = sanitizeMessageHtml(parsed.data.body_html);
    if (isBlankHtml(sanitized)) {
      throw new BadRequestException('message is empty');
    }

    const now = new Date();
    const updated = await this.prisma.runAsAdmin(async (tx: Db) => {
      return tx.messages.update({
        where: { id: messageId },
        data: { body_html: sanitized, edited_at: now },
      });
    });

    return {
      id: updated.id as string,
      body_html: updated.body_html as string,
      edited_at: updated.edited_at as Date,
    };
  }

  // ── DELETE /api/messages/:id ──────────────────────────────────────────────

  async remove(
    rawActor: Actor | undefined,
    messageId: string,
  ): Promise<void> {
    const actor = this.requireActor(rawActor);

    const message = await this.db.messages.findFirst({
      where: { id: messageId, deleted_at: null },
    });
    if (!message) throw new NotFoundException('message not found');

    await this.access.assertChannelAccess(actor, message.channel_id);

    if (message.author_id !== actor.userId) {
      throw new ForbiddenException('forbidden');
    }

    const now = new Date();
    await this.prisma.runAsAdmin(async (tx: Db) => {
      await tx.messages.update({
        where: { id: messageId },
        data: { deleted_at: now },
      });
    });
  }
}
