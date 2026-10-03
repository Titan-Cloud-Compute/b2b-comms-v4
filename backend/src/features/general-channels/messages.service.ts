/**
 * MessagesService: post, list, edit, and delete messages in a channel.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { SessionPayload } from '../../auth/session.types';
import { ChannelAccessService } from './channel-access.service';
import { sanitizeMessageHtml, isBlankHtml } from './message-sanitizer';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const MAX_BODY_LENGTH = 20000;
const MAX_ATTACHMENTS = 10;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** Encode a keyset cursor: base64(created_at_iso|id) */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64');
}

/** Decode a keyset cursor → { createdAt, id } */
function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf8');
    const sep = raw.lastIndexOf('|');
    if (sep === -1) return null;
    const ts = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    const d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    return { createdAt: d, id };
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

  /**
   * Post a new message (with optional attachments) to a channel.
   * Returns the created message row shape.
   */
  async create(
    session: SessionPayload | undefined,
    channelId: string,
    body: { body_html?: unknown; attachments?: unknown },
  ) {
    if (!session?.userId) throw new UnauthorizedException('not authenticated');

    // Zod-style validation inline
    const rawHtml = typeof body.body_html === 'string' ? body.body_html : '';
    if (rawHtml.length > MAX_BODY_LENGTH) {
      throw new BadRequestException('body_html too long');
    }

    let attachmentIds: string[] = [];
    if (body.attachments !== undefined) {
      if (!Array.isArray(body.attachments)) {
        throw new BadRequestException('attachments must be an array');
      }
      if (body.attachments.length > MAX_ATTACHMENTS) {
        throw new BadRequestException('too many attachments');
      }
      attachmentIds = body.attachments as string[];
      for (const id of attachmentIds) {
        if (typeof id !== 'string') throw new BadRequestException('invalid attachment id');
      }
    }

    const { channel } = await this.access.assertChannelAccess(session, channelId);

    const sanitized = sanitizeMessageHtml(rawHtml);

    if (isBlankHtml(sanitized) && attachmentIds.length === 0) {
      throw new BadRequestException('message is empty');
    }

    // Validate file ids belong to same project and are not deleted
    if (attachmentIds.length > 0) {
      for (const fileId of attachmentIds) {
        const file: Db = await this.db.files.findFirst({
          where: { id: fileId, project_id: channel.project_id, deleted_at: null },
        });
        if (!file) {
          throw new BadRequestException(`file ${fileId} not found or not accessible`);
        }
      }
    }

    const now = new Date();
    const result = await this.prisma.runAsAdmin(async (tx: Db) => {
      const msg: Db = await tx.messages.create({
        data: {
          channel_id: channelId,
          author_id: session.userId,
          body_html: sanitized,
          created_at: now,
        },
      });

      for (const fileId of attachmentIds) {
        await tx.message_attachments.create({
          data: {
            message_id: msg.id,
            file_id: fileId,
          },
        });
      }

      return msg;
    });

    return {
      id: result.id as string,
      channel_id: channelId,
      author_id: session.userId,
      body_html: result.body_html as string,
      created_at: result.created_at as Date,
    };
  }

  /**
   * List messages in a channel, cursor-paged, newest first.
   */
  async list(
    session: SessionPayload | undefined,
    channelId: string,
    query: { cursor?: unknown; limit?: unknown },
  ) {
    if (!session?.userId) throw new UnauthorizedException('not authenticated');

    await this.access.assertChannelAccess(session, channelId);

    const limitRaw = typeof query.limit === 'string' ? parseInt(query.limit, 10) : DEFAULT_LIMIT;
    const limit = Math.min(isNaN(limitRaw) ? DEFAULT_LIMIT : Math.max(1, limitRaw), MAX_LIMIT);

    // Decode cursor
    let cursorBound: { createdAt: Date; id: string } | null = null;
    if (typeof query.cursor === 'string' && query.cursor.length > 0) {
      cursorBound = decodeCursor(query.cursor);
    }

    // Fetch messages: non-deleted, ordered newest-first
    // Using fake-prisma compatible approach: fetch all that match channel + deleted_at null
    const allMessages: Db[] = await this.db.messages.findMany({
      where: { channel_id: channelId, deleted_at: null },
      orderBy: { created_at: 'desc' },
    });

    // Apply cursor filter (keyset: created_at < cursor OR (created_at === cursor AND id < cursor.id))
    let filtered = allMessages;
    if (cursorBound) {
      const { createdAt: cbDate, id: cbId } = cursorBound;
      filtered = allMessages.filter((m: Db) => {
        const mDate = m.created_at instanceof Date ? m.created_at : new Date(m.created_at as string);
        if (mDate < cbDate) return true;
        if (mDate.getTime() === cbDate.getTime() && (m.id as string) < cbId) return true;
        return false;
      });
    }

    // Fetch limit+1 to determine next_cursor
    const page = filtered.slice(0, limit + 1);
    const hasMore = page.length > limit;
    const items = hasMore ? page.slice(0, limit) : page;

    let next_cursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      const lastDate = last.created_at instanceof Date ? last.created_at : new Date(last.created_at as string);
      next_cursor = encodeCursor(lastDate, last.id as string);
    }

    // Enrich each message with author, attachments, reference_id
    const enriched = await Promise.all(
      items.map(async (msg: Db) => {
        const author: Db = await this.db.users.findFirst({ where: { id: msg.author_id } });
        const attachmentRows: Db[] = await this.db.message_attachments.findMany({
          where: { message_id: msg.id },
        });
        const attachments = await Promise.all(
          attachmentRows.map(async (a: Db) => {
            const file: Db = await this.db.files.findFirst({ where: { id: a.file_id } });
            return { file_id: a.file_id as string, name: (file?.name ?? '') as string };
          }),
        );
        const ref: Db = await this.db.references.findFirst({ where: { message_id: msg.id } });
        const msgDate = msg.created_at instanceof Date ? msg.created_at : new Date(msg.created_at as string);
        return {
          id: msg.id as string,
          author: {
            id: (author?.id ?? msg.author_id) as string,
            display_name: (author?.display_name ?? author?.name ?? author?.email ?? '') as string,
          },
          body_html: msg.body_html as string,
          attachments,
          reference_id: (ref?.id ?? null) as string | null,
          edited_at: (msg.edited_at ?? null) as Date | null,
          created_at: msgDate,
        };
      }),
    );

    return { items: enriched, next_cursor };
  }

  /**
   * Edit a message. Only the original author may edit. Returns updated shape.
   */
  async update(
    session: SessionPayload | undefined,
    messageId: string,
    body: { body_html?: unknown },
  ) {
    if (!session?.userId) throw new UnauthorizedException('not authenticated');

    const msg: Db = await this.db.messages.findFirst({ where: { id: messageId, deleted_at: null } });
    if (!msg) throw new NotFoundException('message not found');

    await this.access.assertChannelAccess(session, msg.channel_id as string);

    if ((msg.author_id as string) !== session.userId) {
      throw new ForbiddenException('only the author can edit this message');
    }

    const rawHtml = typeof body.body_html === 'string' ? body.body_html : '';
    if (rawHtml.length > MAX_BODY_LENGTH) throw new BadRequestException('body_html too long');

    const sanitized = sanitizeMessageHtml(rawHtml);
    if (isBlankHtml(sanitized)) throw new BadRequestException('message is empty');

    const now = new Date();
    const updated: Db = await this.db.messages.update({
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
  async remove(session: SessionPayload | undefined, messageId: string) {
    if (!session?.userId) throw new UnauthorizedException('not authenticated');

    const msg: Db = await this.db.messages.findFirst({ where: { id: messageId, deleted_at: null } });
    if (!msg) throw new NotFoundException('message not found');

    await this.access.assertChannelAccess(session, msg.channel_id as string);

    if ((msg.author_id as string) !== session.userId) {
      throw new ForbiddenException('only the author can delete this message');
    }

    const now = new Date();
    await this.db.messages.update({
      where: { id: messageId },
      data: { deleted_at: now },
    });
  }
}
