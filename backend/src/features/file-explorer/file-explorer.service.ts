import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../../lib/integrations/minio.service';
import {
  DOWNLOAD_URL_TTL_SECONDS,
  isStorageUnavailableError,
  nextVersionNumber,
  validateName,
  validateUploadBatch,
} from './file-explorer.policy';

export interface Actor {
  userId: string;
  role?: string | null;
}

export interface UploadedBlob {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

interface FolderRow {
  id: string;
  project_id: string | null;
  parent_id: string | null;
  name: string | null;
}

interface FileRow {
  id: string;
  project_id: string | null;
  folder_id: string | null;
  name: string | null;
  mime_type: string | null;
  current_version_id: string | null;
}

@Injectable()
export class FileExplorerService {
  private readonly logger = new Logger('FileExplorerService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MinioService,
  ) {}

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

  private async loadFile(fileId: string, actor: Actor | undefined): Promise<FileRow> {
    if (!actor?.userId) throw new UnauthorizedException('Unauthorized');
    const file = await this.prisma.files.findFirst({ where: { id: fileId, deleted_at: null } });
    if (!file || !file.project_id) throw new NotFoundException('File not found.');
    await this.assertProjectMember(file.project_id, actor);
    return file;
  }

  private async loadFolder(folderId: string, actor: Actor | undefined): Promise<FolderRow> {
    if (!actor?.userId) throw new UnauthorizedException('Unauthorized');
    const folder = await this.prisma.folders.findFirst({ where: { id: folderId, deleted_at: null } });
    if (!folder || !folder.project_id) throw new NotFoundException('Folder not found.');
    await this.assertProjectMember(folder.project_id, actor);
    return folder;
  }

  /** A target folder (or null = project root) must be live and in the same project. */
  private async assertFolderInProject(folderId: string | null, projectId: string): Promise<void> {
    if (!folderId) return;
    const folder = await this.prisma.folders.findFirst({ where: { id: folderId, deleted_at: null } });
    if (!folder) throw new BadRequestException('Target folder does not exist.');
    if (folder.project_id !== projectId) {
      throw new ForbiddenException('Target folder belongs to another project.');
    }
  }

  private storageUnavailable(err: unknown): never {
    this.logger.warn(`object storage unavailable: ${(err as Error)?.message ?? err}`);
    throw new ServiceUnavailableException({
      statusCode: 503,
      message: 'File storage is temporarily unavailable. Please try again.',
      service: 'minio',
      retryable: true,
    });
  }

  // ─── listing ────────────────────────────────────────────────────────────

  async list(projectId: string, actor: Actor | undefined, folderId?: string | null, q?: string | null) {
    await this.assertProjectMember(projectId, actor);
    const currentFolderId = folderId || null;

    let current: FolderRow | null = null;
    if (currentFolderId) {
      current = await this.prisma.folders.findFirst({ where: { id: currentFolderId, deleted_at: null } });
      if (!current) throw new NotFoundException('Folder not found.');
      if (current.project_id !== projectId) throw new ForbiddenException('Folder belongs to another project.');
    }

    const breadcrumbs: Array<{ id: string | null; name: string }> = [];
    let cursor: FolderRow | null = current;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      breadcrumbs.unshift({ id: cursor.id, name: cursor.name ?? '' });
      cursor = cursor.parent_id
        ? await this.prisma.folders.findFirst({ where: { id: cursor.parent_id, deleted_at: null } })
        : null;
    }
    breadcrumbs.unshift({ id: null, name: 'Files' });

    const search = (q ?? '').trim();
    const nameFilter = search ? { name: { contains: search, mode: 'insensitive' as const } } : {};
    const scope = search ? {} : { parent_id: currentFolderId };
    const fileScope = search ? {} : { folder_id: currentFolderId };

    const folders = await this.prisma.folders.findMany({
      where: { project_id: projectId, deleted_at: null, ...scope, ...nameFilter },
      orderBy: { name: 'asc' },
    });
    const files = await this.prisma.files.findMany({
      where: { project_id: projectId, deleted_at: null, ...fileScope, ...nameFilter },
      orderBy: { name: 'asc' },
    });

    const versionIds = files.map((f) => f.current_version_id).filter((v): v is string => !!v);
    const versions = versionIds.length
      ? await this.prisma.file_versions.findMany({ where: { id: { in: versionIds } } })
      : [];
    const versionById = new Map(versions.map((v) => [v.id, v]));
    const uploaderIds = Array.from(new Set(versions.map((v) => v.uploaded_by).filter((v): v is string => !!v)));
    const uploaders = uploaderIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: uploaderIds } },
          select: { id: true, email: true, name: true, display_name: true },
        })
      : [];
    const uploaderName = new Map(uploaders.map((u) => [u.id, u.display_name || u.name || u.email]));

    return {
      folder: {
        id: current?.id ?? null,
        name: current?.name ?? 'Files',
        breadcrumbs,
      },
      folders: folders.map((f) => ({ id: f.id, name: f.name ?? '', parent_id: f.parent_id })),
      files: files.map((f) => {
        const v = f.current_version_id ? versionById.get(f.current_version_id) : undefined;
        return {
          id: f.id,
          name: f.name ?? '',
          folder_id: f.folder_id,
          mime_type: f.mime_type ?? 'application/octet-stream',
          size_bytes: v?.size_bytes != null ? Number(v.size_bytes) : 0,
          uploaded_by: v?.uploaded_by ?? null,
          uploaded_by_name: v?.uploaded_by ? uploaderName.get(v.uploaded_by) ?? null : null,
          uploaded_at: v?.uploaded_at ?? null,
          version_number: v?.version_number ?? 1,
        };
      }),
    };
  }

  // ─── upload ─────────────────────────────────────────────────────────────

  async upload(projectId: string, actor: Actor | undefined, folderId: string | null, blobs: UploadedBlob[]) {
    await this.assertProjectMember(projectId, actor);
    const err = validateUploadBatch(
      (blobs ?? []).map((b) => ({ name: b.originalname, size: b.size ?? b.buffer?.length ?? 0, mimeType: b.mimetype })),
    );
    if (err) throw new BadRequestException({ statusCode: 400, message: err, retryable: false });
    await this.assertFolderInProject(folderId, projectId);

    // 1) Put every object first: a storage outage leaves NO rows behind.
    const stored: Array<{ blob: UploadedBlob; key: string }> = [];
    try {
      for (const blob of blobs) {
        const key = `projects/${projectId}/files/${randomUUID()}`;
        await this.storage.putObject(key, blob.buffer, blob.size, blob.mimetype || undefined);
        stored.push({ blob, key });
      }
    } catch (e) {
      for (const s of stored) await this.storage.deleteObject(s.key).catch(() => undefined);
      if (isStorageUnavailableError(e)) this.storageUnavailable(e);
      throw e;
    }

    // 2) Write files + file_versions rows atomically.
    const userId = actor!.userId;
    const results = await this.prisma.$transaction(async (tx) => {
      const out: Array<{ id: string; name: string; version_number: number; size_bytes: number }> = [];
      for (const { blob, key } of stored) {
        const name = blob.originalname.trim();
        let file = await tx.files.findFirst({
          where: { project_id: projectId, folder_id: folderId, name, deleted_at: null },
        });
        if (!file) {
          file = await tx.files.create({
            data: {
              project_id: projectId,
              folder_id: folderId,
              name,
              mime_type: blob.mimetype || 'application/octet-stream',
            },
          });
        }
        const existing = await tx.file_versions.findMany({
          where: { file_id: file.id },
          select: { version_number: true },
        });
        const versionNumber = nextVersionNumber(existing.map((v) => v.version_number));
        const version = await tx.file_versions.create({
          data: {
            file_id: file.id,
            version_number: versionNumber,
            storage_key: key,
            size_bytes: BigInt(blob.size),
            uploaded_by: userId,
            uploaded_at: new Date(),
          },
        });
        await tx.files.update({
          where: { id: file.id },
          data: { current_version_id: version.id, mime_type: blob.mimetype || file.mime_type },
        });
        out.push({ id: file.id, name, version_number: versionNumber, size_bytes: blob.size });
      }
      return out;
    });

    return { files: results, retryable: false };
  }

  // ─── download / versions ────────────────────────────────────────────────

  async download(fileId: string, actor: Actor | undefined) {
    const file = await this.loadFile(fileId, actor);
    const version = file.current_version_id
      ? await this.prisma.file_versions.findUnique({ where: { id: file.current_version_id } })
      : null;
    if (!version?.storage_key) throw new NotFoundException('File has no stored content.');
    let url: string;
    try {
      url = await this.storage.getSignedUrl(version.storage_key, DOWNLOAD_URL_TTL_SECONDS);
    } catch (e) {
      if (isStorageUnavailableError(e)) this.storageUnavailable(e);
      throw e;
    }
    return { url, expires_in_seconds: DOWNLOAD_URL_TTL_SECONDS, retryable: false };
  }

  async versions(fileId: string, actor: Actor | undefined) {
    await this.loadFile(fileId, actor);
    const rows = await this.prisma.file_versions.findMany({
      where: { file_id: fileId },
      orderBy: { version_number: 'desc' },
    });
    return {
      items: rows.map((v) => ({
        id: v.id,
        version_number: v.version_number ?? 1,
        size_bytes: v.size_bytes != null ? Number(v.size_bytes) : 0,
        uploaded_by: v.uploaded_by,
        uploaded_at: v.uploaded_at,
      })),
    };
  }

  // ─── file mutation ──────────────────────────────────────────────────────

  async updateFile(fileId: string, actor: Actor | undefined, body: { name?: unknown; folder_id?: unknown }) {
    const file = await this.loadFile(fileId, actor);
    const data: { name?: string; folder_id?: string | null } = {};
    if (body?.name !== undefined) {
      const err = validateName(body.name, 'file');
      if (err) throw new BadRequestException(err);
      data.name = (body.name as string).trim();
    }
    if (body?.folder_id !== undefined) {
      const target = body.folder_id ? String(body.folder_id) : null;
      await this.assertFolderInProject(target, file.project_id!);
      data.folder_id = target;
    }
    const updated = await this.prisma.files.update({ where: { id: fileId }, data });
    return { id: updated.id, name: updated.name, folder_id: updated.folder_id };
  }

  async deleteFile(fileId: string, actor: Actor | undefined): Promise<void> {
    await this.loadFile(fileId, actor);
    await this.prisma.files.update({ where: { id: fileId }, data: { deleted_at: new Date() } });
  }

  // ─── folders ────────────────────────────────────────────────────────────

  async createFolder(projectId: string, actor: Actor | undefined, body: { name?: unknown; parent_id?: unknown }) {
    await this.assertProjectMember(projectId, actor);
    const err = validateName(body?.name, 'folder');
    if (err) throw new BadRequestException(err);
    const parentId = body?.parent_id ? String(body.parent_id) : null;
    await this.assertFolderInProject(parentId, projectId);
    const folder = await this.prisma.folders.create({
      data: {
        project_id: projectId,
        parent_id: parentId,
        name: (body.name as string).trim(),
        created_by: actor!.userId,
      },
    });
    return { id: folder.id, name: folder.name, parent_id: folder.parent_id };
  }

  async updateFolder(folderId: string, actor: Actor | undefined, body: { name?: unknown; parent_id?: unknown }) {
    const folder = await this.loadFolder(folderId, actor);
    const data: { name?: string; parent_id?: string | null } = {};
    if (body?.name !== undefined) {
      const err = validateName(body.name, 'folder');
      if (err) throw new BadRequestException(err);
      data.name = (body.name as string).trim();
    }
    if (body?.parent_id !== undefined) {
      const target = body.parent_id ? String(body.parent_id) : null;
      await this.assertFolderInProject(target, folder.project_id!);
      // Prevent moving a folder into itself or one of its descendants.
      let cursor = target;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        if (cursor === folderId) throw new BadRequestException('A folder cannot be moved into itself.');
        seen.add(cursor);
        const parent: { parent_id: string | null } | null = await this.prisma.folders.findUnique({
          where: { id: cursor },
          select: { parent_id: true },
        });
        cursor = parent?.parent_id ?? null;
      }
      data.parent_id = target;
    }
    const updated = await this.prisma.folders.update({ where: { id: folderId }, data });
    return { id: updated.id, name: updated.name, parent_id: updated.parent_id };
  }

  async deleteFolder(folderId: string, actor: Actor | undefined): Promise<void> {
    const folder = await this.loadFolder(folderId, actor);
    // Collect the folder and all live descendants, then soft-delete them and their files.
    const ids: string[] = [folder.id];
    for (let i = 0; i < ids.length; i++) {
      const children = await this.prisma.folders.findMany({
        where: { parent_id: ids[i], deleted_at: null },
        select: { id: true },
      });
      for (const c of children) if (!ids.includes(c.id)) ids.push(c.id);
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.files.updateMany({ where: { folder_id: { in: ids }, deleted_at: null }, data: { deleted_at: now } }),
      this.prisma.folders.updateMany({ where: { id: { in: ids } }, data: { deleted_at: now } }),
    ]);
  }
}
