import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface Actor {
  userId: string;
  role?: string | null;
  organizationId?: string | null;
}

export type Side = 'internal' | 'external';

export interface QuestionSummary {
  id: string;
  name: string;
  status: string;
  resolved_sides: string;
  unread_count: number;
}

export interface ResolveResult {
  id: string;
  status: string;
  resolved_sides: string;
}

interface ChannelRow {
  id: string;
  project_id: string | null;
  kind: string | null;
  name: string | null;
  status: string | null;
}

export const QUESTION_KIND = 'question';
export const STATUS_OPEN = 'open';
export const STATUS_RESOLVED = 'resolved';
const SIDES: Side[] = ['internal', 'external'];

/** Serialises the set of resolved sides as stable, comma-joined text ("" | "internal" | "external" | "internal,external"). */
export function joinSides(sides: Iterable<string | null | undefined>): string {
  const set = new Set<string>();
  for (const s of sides) if (s) set.add(s);
  return SIDES.filter((s) => set.has(s)).join(',');
}

function cleanText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

@Injectable()
export class ActiveQuestionChatsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── authorization ──────────────────────────────────────────────────────

  async assertProjectMember(projectId: string, actor: Actor | undefined): Promise<void> {
    if (!actor?.userId) throw new UnauthorizedException('Unauthorized');
    const project = await this.prisma.projects.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found.');
    if (project.created_by === actor.userId) return;
    const membership = await this.prisma.project_members.findFirst({
      where: { project_id: projectId, user_id: actor.userId },
    });
    if (!membership) throw new ForbiddenException('You are not a member of this project.');
  }

  /** Internal vs external side, derived from the actor's organization.is_internal. */
  async sideOf(actor: Actor): Promise<Side> {
    let orgId = actor.organizationId ?? null;
    if (!orgId) {
      const user = await this.prisma.user.findUnique({ where: { id: actor.userId } });
      orgId = user?.organization_id ?? null;
    }
    if (!orgId) return 'internal';
    const org = await this.prisma.organizations.findUnique({ where: { id: orgId } });
    return org?.is_internal === false ? 'external' : 'internal';
  }

  async loadQuestion(id: string, actor: Actor | undefined): Promise<ChannelRow> {
    if (!actor?.userId) throw new UnauthorizedException('Unauthorized');
    const ch = await this.prisma.channels.findUnique({ where: { id } });
    if (!ch || ch.kind !== QUESTION_KIND || !ch.project_id) throw new NotFoundException('Question not found.');
    await this.assertProjectMember(ch.project_id, actor);
    return ch;
  }

  private async resolvedSides(channelId: string): Promise<string> {
    const rows = await this.prisma.question_resolutions.findMany({ where: { channel_id: channelId } });
    return joinSides(rows.map((r) => r.side));
  }

  // ─── endpoints ──────────────────────────────────────────────────────────

  async list(projectId: string, actor: Actor | undefined): Promise<{ items: QuestionSummary[] }> {
    await this.assertProjectMember(projectId, actor);
    const channels = await this.prisma.channels.findMany({
      where: { project_id: projectId, kind: QUESTION_KIND },
      orderBy: { createdAt: 'desc' },
    });
    const ids = channels.map((c) => c.id);
    const resolutions = ids.length
      ? await this.prisma.question_resolutions.findMany({ where: { channel_id: { in: ids } } })
      : [];
    const items = channels.map((c) => ({
      id: c.id,
      name: c.name ?? '',
      status: c.status ?? STATUS_OPEN,
      resolved_sides: joinSides(resolutions.filter((r) => r.channel_id === c.id).map((r) => r.side)),
      unread_count: 0,
    }));
    return { items };
  }

  async create(
    projectId: string,
    actor: Actor | undefined,
    body: { title?: unknown; name?: unknown; message?: unknown; body_html?: unknown },
  ) {
    await this.assertProjectMember(projectId, actor);
    const title = cleanText(body?.title ?? body?.name);
    const message = cleanText(body?.message ?? body?.body_html);
    const errors: string[] = [];
    if (!title) errors.push('Title is required.');
    if (!message) errors.push('First message is required.');
    if (errors.length) throw new BadRequestException({ message: errors, error: 'Bad Request', statusCode: 400 });
    if (title.length > 200) throw new BadRequestException('Title must be at most 200 characters.');

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const ch = await tx.channels.create({
        data: {
          project_id: projectId,
          kind: QUESTION_KIND,
          name: title,
          internal_only: false,
          status: STATUS_OPEN,
          created_by: actor!.userId,
          created_at: now,
        },
      });
      const msg = await tx.messages.create({
        data: { channel_id: ch.id, author_id: actor!.userId, body_html: message, created_at: now },
      });
      return {
        id: ch.id,
        name: ch.name ?? title,
        kind: QUESTION_KIND,
        status: STATUS_OPEN,
        first_message_id: msg.id,
      };
    });
  }

  async get(id: string, actor: Actor | undefined) {
    const ch = await this.loadQuestion(id, actor);
    const [resolved_sides, my_side, messages] = await Promise.all([
      this.resolvedSides(ch.id),
      this.sideOf(actor!),
      this.listMessagesRaw(ch.id),
    ]);
    return {
      id: ch.id,
      project_id: ch.project_id,
      name: ch.name ?? '',
      kind: QUESTION_KIND,
      status: ch.status ?? STATUS_OPEN,
      resolved_sides,
      my_side,
      messages,
    };
  }

  private async listMessagesRaw(channelId: string) {
    const rows = await this.prisma.messages.findMany({
      where: { channel_id: channelId, deleted_at: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((m) => ({
      id: m.id,
      author_id: m.author_id,
      body_html: m.body_html ?? '',
      created_at: (m.created_at ?? m.createdAt)?.toISOString?.() ?? null,
    }));
  }

  async listMessages(id: string, actor: Actor | undefined) {
    const ch = await this.loadQuestion(id, actor);
    return { items: await this.listMessagesRaw(ch.id) };
  }

  /** Posting into a question: 403 once resolved; any new message clears pending resolution marks. */
  async postMessage(id: string, actor: Actor | undefined, body: { body_html?: unknown; message?: unknown }) {
    const ch = await this.loadQuestion(id, actor);
    if (ch.status === STATUS_RESOLVED) throw new ForbiddenException('This question is resolved; no further messages can be posted.');
    const html = cleanText(body?.body_html ?? body?.message);
    if (!html) throw new BadRequestException('Message is required.');
    const msg = await this.prisma.messages.create({
      data: { channel_id: ch.id, author_id: actor!.userId, body_html: html, created_at: new Date() },
    });
    await this.clearResolutions(ch.id);
    return {
      id: msg.id,
      author_id: msg.author_id,
      body_html: msg.body_html ?? '',
      created_at: (msg.created_at ?? new Date()).toISOString(),
    };
  }

  async clearResolutions(channelId: string): Promise<void> {
    await this.prisma.question_resolutions.deleteMany({ where: { channel_id: channelId } });
  }

  async resolve(id: string, actor: Actor | undefined): Promise<ResolveResult> {
    const ch = await this.loadQuestion(id, actor);
    if (ch.status === STATUS_RESOLVED) {
      return { id: ch.id, status: STATUS_RESOLVED, resolved_sides: await this.resolvedSides(ch.id) };
    }
    const side = await this.sideOf(actor!);
    const existing = await this.prisma.question_resolutions.findMany({ where: { channel_id: ch.id } });
    if (!existing.some((r) => r.side === side)) {
      await this.prisma.question_resolutions.create({
        data: { channel_id: ch.id, side, resolved_by: actor!.userId, resolved_at: new Date() },
      });
    }
    const sides = joinSides([...existing.map((r) => r.side), side]);
    const bothResolved = SIDES.every((s) => sides.split(',').includes(s));
    if (bothResolved) {
      await this.prisma.channels.update({ where: { id: ch.id }, data: { status: STATUS_RESOLVED } });
    }
    return { id: ch.id, status: bothResolved ? STATUS_RESOLVED : STATUS_OPEN, resolved_sides: sides };
  }

  async unresolve(id: string, actor: Actor | undefined): Promise<ResolveResult> {
    const ch = await this.loadQuestion(id, actor);
    if (ch.status === STATUS_RESOLVED) {
      throw new ForbiddenException('This question is already resolved by both parties.');
    }
    await this.clearResolutions(ch.id);
    return { id: ch.id, status: STATUS_OPEN, resolved_sides: '' };
  }
}
