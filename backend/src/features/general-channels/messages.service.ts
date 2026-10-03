import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import type { SessionPayload } from '../../auth/session.types';
import { ChannelAccessService } from './channel-access.service';
import { sanitizeMessageHtml, isBlankHtml } from './message-sanitizer';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const CreateMessageSchema = z.object({
  body_html: z.string().max(20000).default(''),
  attachments: z.array(z.string()).max(10).optional(),
});

const UpdateMessageSchema = z.object({
  body_html: z.string().max(20000),
});

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    const [isoStr, id] = decoded.split('|');
    return { createdAt: new Date(isoStr), id };
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

  async create(
    session: SessionPayload | undefined,
    channelId: string,
    rawBody: unknown,
  ) {
    if (!session?.userId) throw new UnauthorizedException('not authenticated');

    const parsed = CreateMessageSchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'invalid body');
    }
    const { body_html: rawHtml, attachments = [] } = parsed.data;

    await this.access.assertChannelAccess(session, channelId);

    const sanitized = sanitizeMessageHtml(rawHtml);
    if (isBlankHtml(sanitized) && attachments.length === 0) {
      throw new BadRequestException('message is empty');
    }

    // Verify all attachment file IDs exist and belong to the channel's project.
    const channel: Db = await this.db.channels.findUnique({ where: { id: channelId } });
    if (attachments.length > 0) {
      const files: Db[] = await this.db.files.findMany({
        where: { id: { in: attachments } },
      });
      const validIds = new Set(
        files
          .filter((f: Db) => !f.deleted_at && f.project_id === channel.project_id)
          .map((f: Db) => f.id),
      );
      const invalid = attachments.filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        throw new BadRequestException(`invalid attachment file ids: ${invalid.join(', ')}`);
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
      for (const fileId of attachments) {
        await tx.message_attachments.create({
          data: { message_id: msg.id, file_id: fileId },
        });
      }
      return msg;
    });

    return {
      id: result.id as string,
      channel_id: result.channel_id as string,
      author_id: result.author_id as string,
      body_html: result.body_html as string,
      created_at: result.created_at as Date,
    };
  }

  async list(
    session: SessionPayload | undefined,
    channelId: string,
    query: { cursor?: string; limit?: unknown },
  ) {
    if (!session?.userId) throw new UnauthorizedException('not authenticated');

    await this.access.assertChannelAccess(session, channelId);

    const rawLimit = Number(query.limit ?? 50);
    const limit = Math.min(isNaN(rawLimit) ? 50 : rawLimit, 100);

    // Build where clause
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {
      channel_id: channelId,
      deleted_at: null,
    };

    let cursorData: { createdAt: Date; id: string } | null = null;
    if (query.cursor) {
      cursorData = decodeCursor(query.cursor as string);
    }

    // Fetch all matching messages ordered created_at desc, id desc
    let messages: Db[] = await this.db.messages.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });

    // Apply cursor filter for keyset pagination
    if (cursorData) {
      const { createdAt: cursorTime, id: cursorId } = cursorData;
      messages = messages.filter((m: Db) => {
        const mTime = new Date(m.created_at).getTime();
        const cTime = cursorTime.getTime();
        if (mTime < cTime) return true;
        if (mTime === cTime && m.id < cursorId) return true;
        return false;
      });
    }

    // Fetch limit+1 to determine if there's a next page
    const pageRows = messages.slice(0, limit + 1);
    const hasMore = pageRows.length > limit;
    const rows = hasMore ? pageRows.slice(0, limit) : pageRows;

    // Build items with joined data
    const items = await Promise.all(
      rows.map(async (msg: Db) => {
        // Author
        const author: Db = await this.db.users.findUnique({ where: { id: msg.author_id } });
        // Attachments
        const attachmentRows: Db[] = await this.db.message_attachments.findMany({
          where: { message_id: msg.id },
        });
        const attachments = await Promise.all(
          attachmentRows.map(async (att: Db) => {
            const file: Db = await this.db.files.findUnique({ where: { id: att.file_id } });
            return { file_id: att.file_id as string, name: (file?.name ?? '') as string };
          }),
        );
        // Reference
        const ref: Db = await this.db.references.findFirst({ where: { message_id: msg.id } });

        return {
          id: msg.id as string,
          author: {
            id: msg.author_id as string,
            display_name: (author?.display_name ?? author?.name ?? author?.email ?? '') as string,
          },
          body_html: msg.body_html as string,
          attachments,
          reference_id: (ref?.id ?? null) as string | null,
          edited_at: (msg.edited_at ?? null) as Date | null,
          created_at: msg.created_at as Date,
        };
      }),
    );

    const next_cursor =
      hasMore && rows.length > 0
        ? encodeCursor(
            new Date(rows[rows.length - 1].created_at as Date),
            rows[rows.length - 1].id as string,
          )
        : null;

    return { items, next_cursor };
  }

  async update(
    session: SessionPayload | undefined,
    messageId: string,
    rawBody: unknown,
  ) {
    if (!session?.userId) throw new UnauthorizedException('not authenticated');

    const parsed = UpdateMessageSchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'invalid body');
    }
    const { body_html: rawHtml } = parsed.data;

    const msg: Db = await this.db.messages.findUnique({ where: { id: messageId } });
    if (!msg || msg.deleted_at) throw new NotFoundException('message not found');

    await this.access.assertChannelAccess(session, msg.channel_id as string);

    if (msg.author_id !== session.userId) {
      throw new ForbiddenException('only the author can edit this message');
    }

    const sanitized = sanitizeMessageHtml(rawHtml);
    if (isBlankHtml(sanitized)) {
      throw new BadRequestException('message is empty');
    }

    const updated: Db = await this.db.messages.update({
      where: { id: messageId },
      data: { body_html: sanitized, edited_at: new Date() },
    });

    return {
      id: updated.id as string,
      body_html: updated.body_html as string,
      edited_at: updated.edited_at as Date,
    };
  }

  async remove(session: SessionPayload | undefined, messageId: string) {
    if (!session?.userId) throw new UnauthorizedException('not authenticated');

    const msg: Db = await this.db.messages.findUnique({ where: { id: messageId } });
    if (!msg || msg.deleted_at) throw new NotFoundException('message not found');

    await this.access.assertChannelAccess(session, msg.channel_id as string);

    if (msg.author_id !== session.userId) {
      throw new ForbiddenException('only the author can delete this message');
    }

    await this.db.messages.update({
      where: { id: messageId },
      data: { deleted_at: new Date() },
    });
  }
}
