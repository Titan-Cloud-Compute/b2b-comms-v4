import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../../lib/integrations/minio.service';
import {
  UNSUPPORTED_FILE_MESSAGE,
  canAccessProject,
  canEditReference,
  isFileAvailable,
  referenceKind,
  validateAnnotations,
  validatePageNumber,
} from './reference.policy';
import { PageOutOfRangeError, RenderedPage, UnsupportedPageSourceError, renderPage } from './page-render';

export interface Actor {
  userId: string;
  role?: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

@Injectable()
export class ReferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MinioService,
  ) {}

  private get db(): any {
    return this.prisma as any;
  }

  // ─── authorization ──────────────────────────────────────────────────────

  private requireActor(actor: Actor | undefined): Actor {
    if (!actor?.userId) throw new UnauthorizedException('Unauthorized');
    return actor;
  }

  private async assertProjectMember(projectId: string | null | undefined, actor: Actor): Promise<void> {
    if (!projectId) throw new ForbiddenException('You are not a member of this project.');
    const project = await this.db.projects.findUnique({ where: { id: projectId } });
    if (!project) throw new ForbiddenException('You are not a member of this project.');
    const membership = await this.db.project_members.findFirst({
      where: { project_id: projectId, user_id: actor.userId },
    });
    if (!canAccessProject({ actorId: actor.userId, projectCreatedBy: project.created_by, isMember: !!membership })) {
      throw new ForbiddenException('You are not a member of this project.');
    }
  }

  private async projectOfMessage(message: Row): Promise<string | null> {
    if (!message.channel_id) return null;
    const channel = await this.db.channels.findUnique({ where: { id: message.channel_id } });
    return channel?.project_id ?? null;
  }

  private async loadMessage(id: string): Promise<Row> {
    const message = await this.db.messages.findUnique({ where: { id } });
    if (!message || message.deleted_at) throw new NotFoundException('Message not found.');
    return message;
  }

  /** Loads a reference and checks the actor belongs to the project of its message. */
  private async loadReference(id: string, actor: Actor): Promise<{ ref: Row; message: Row | null }> {
    const ref = await this.db.references.findUnique({ where: { id } });
    if (!ref) throw new NotFoundException('Reference not found.');
    const message = ref.message_id ? await this.db.messages.findUnique({ where: { id: ref.message_id } }) : null;
    const projectId = message ? await this.projectOfMessage(message) : null;
    await this.assertProjectMember(projectId, actor);
    return { ref, message };
  }

  private async loadVersionAndFile(versionId: string | null | undefined): Promise<{ version: Row | null; file: Row | null }> {
    if (!versionId) return { version: null, file: null };
    const version = await this.db.file_versions.findUnique({ where: { id: versionId } });
    const file = version?.file_id ? await this.db.files.findUnique({ where: { id: version.file_id } }) : null;
    return { version, file };
  }

  private shape(ref: Row) {
    return {
      id: ref.id,
      message_id: ref.message_id,
      file_version_id: ref.file_version_id,
      page_number: ref.page_number,
      annotations: ref.annotations,
      author_id: ref.author_id,
      updated_at: ref.updated_at ?? null,
    };
  }

  // ─── endpoints ──────────────────────────────────────────────────────────

  async create(messageId: string, rawActor: Actor | undefined, body: Row | undefined) {
    const actor = this.requireActor(rawActor);
    const b = body ?? {};
    const message = await this.loadMessage(messageId);
    const projectId = await this.projectOfMessage(message);
    await this.assertProjectMember(projectId, actor);
    if (message.author_id && message.author_id !== actor.userId) {
      throw new ForbiddenException('Only the message author can attach a reference.');
    }

    // Resolve the pinned file version: explicit file_version_id, else the file's current version.
    let versionId: string | null = typeof b.file_version_id === 'string' ? b.file_version_id : null;
    if (!versionId && typeof b.file_id === 'string') {
      const f = await this.db.files.findUnique({ where: { id: b.file_id } });
      versionId = f?.current_version_id ?? null;
    }
    if (!versionId) throw new BadRequestException('file_version_id is required.');
    const { version, file } = await this.loadVersionAndFile(versionId);
    if (!version || !file || file.deleted_at) throw new BadRequestException('File version not found.');
    if (file.project_id !== projectId) throw new ForbiddenException('That file belongs to another project.');
    const kind = referenceKind(file.mime_type, file.name);
    if (!kind) throw new BadRequestException(UNSUPPORTED_FILE_MESSAGE);

    const page = validatePageNumber(b.page_number ?? 1, kind);
    if (!page.ok) throw new BadRequestException(page.error);
    const ann = validateAnnotations(b.annotations);
    if (!ann.ok) throw new BadRequestException(ann.error);

    const existing = await this.db.references.findFirst({ where: { message_id: messageId } });
    if (existing) throw new ConflictException('This message already has a reference.');

    const ref = await this.db.references.create({
      data: {
        message_id: messageId,
        file_version_id: version.id,
        page_number: page.value,
        annotations: ann.value,
        author_id: actor.userId,
        updated_at: new Date(),
      },
    });
    return this.shape(ref);
  }

  async get(id: string, rawActor: Actor | undefined) {
    const actor = this.requireActor(rawActor);
    const { ref } = await this.loadReference(id, actor);
    const { version, file } = await this.loadVersionAndFile(ref.file_version_id);
    return {
      ...this.shape(ref),
      file_available: isFileAvailable({ version, file }),
      can_edit: canEditReference(actor.userId, ref),
      file_name: file?.name ?? null,
      mime_type: file?.mime_type ?? null,
    };
  }

  /** Which of these messages carry a reference the actor can see (drives the "View Reference" button). */
  async listForMessages(messageIdsRaw: string | undefined, rawActor: Actor | undefined) {
    const actor = this.requireActor(rawActor);
    const ids = [...new Set((messageIdsRaw ?? '').split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 200);
    const items: Array<{ id: string; message_id: string; author_id: string | null }> = [];
    const allowed = new Map<string, boolean>();
    for (const messageId of ids) {
      const ref = await this.db.references.findFirst({ where: { message_id: messageId } });
      if (!ref) continue;
      const message = await this.db.messages.findUnique({ where: { id: messageId } });
      const projectId = message ? await this.projectOfMessage(message) : null;
      if (!projectId) continue;
      if (!allowed.has(projectId)) {
        allowed.set(projectId, await this.assertProjectMember(projectId, actor).then(() => true, () => false));
      }
      if (allowed.get(projectId)) items.push({ id: ref.id, message_id: messageId, author_id: ref.author_id ?? null });
    }
    return { items };
  }

  async update(id: string, rawActor: Actor | undefined, body: Row | undefined) {
    const actor = this.requireActor(rawActor);
    const { ref } = await this.loadReference(id, actor);
    if (!canEditReference(actor.userId, ref)) throw new ForbiddenException('Only the author can edit this reference.');
    const b = body ?? {};
    const ann = validateAnnotations(b.annotations);
    if (!ann.ok) throw new BadRequestException(ann.error);
    let pageNumber: number = ref.page_number;
    if (b.page_number !== undefined) {
      const { file } = await this.loadVersionAndFile(ref.file_version_id);
      const kind = referenceKind(file?.mime_type, file?.name) ?? 'pdf';
      const page = validatePageNumber(b.page_number, kind);
      if (!page.ok) throw new BadRequestException(page.error);
      pageNumber = page.value;
    }
    const updated = await this.db.references.update({
      where: { id },
      data: { annotations: ann.value, page_number: pageNumber, updated_at: new Date() },
    });
    return { id: updated.id, page_number: updated.page_number, annotations: updated.annotations, updated_at: updated.updated_at };
  }

  async remove(id: string, rawActor: Actor | undefined): Promise<void> {
    const actor = this.requireActor(rawActor);
    const { ref } = await this.loadReference(id, actor);
    if (!canEditReference(actor.userId, ref)) throw new ForbiddenException('Only the author can delete this reference.');
    await this.db.references.delete({ where: { id } });
  }

  async pageImage(versionId: string, pageRaw: string, rawActor: Actor | undefined): Promise<RenderedPage> {
    const actor = this.requireActor(rawActor);
    const { version, file } = await this.loadVersionAndFile(versionId);
    if (!version || !file) throw new NotFoundException('File version not found.');
    await this.assertProjectMember(file.project_id, actor);
    if (!isFileAvailable({ version, file })) throw new NotFoundException('This file is no longer available');
    if (!referenceKind(file.mime_type, file.name)) throw new BadRequestException(UNSUPPORTED_FILE_MESSAGE);
    const page = Number(pageRaw);
    if (!Number.isInteger(page) || page < 1) throw new BadRequestException('page must be a positive integer.');
    const source = await this.storage.getObjectBuffer(version.storage_key);
    try {
      return renderPage(source, file.mime_type, page, file.name);
    } catch (e) {
      if (e instanceof PageOutOfRangeError) throw new NotFoundException(e.message);
      if (e instanceof UnsupportedPageSourceError) throw new BadRequestException(e.message);
      throw e;
    }
  }
}
