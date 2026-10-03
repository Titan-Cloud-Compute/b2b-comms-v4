import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ServiceUnconfiguredError } from '../../common/errors/service-unconfigured.error';
import { FileExplorerService } from './file-explorer.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
function makePrisma(opts: { member?: boolean; existingFile?: any; existingVersions?: number[] } = {}) {
  const tx = {
    files: {
      findFirst: jest.fn().mockResolvedValue(opts.existingFile ?? null),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'f-new', ...data })),
      update: jest.fn().mockResolvedValue({}),
    },
    file_versions: {
      findMany: jest.fn().mockResolvedValue((opts.existingVersions ?? []).map((n) => ({ version_number: n }))),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'v-new', ...data })),
    },
  };
  const prisma: any = {
    projects: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', created_by: 'owner' }) },
    project_members: { findFirst: jest.fn().mockResolvedValue(opts.member === false ? null : { id: 'm1' }) },
    folders: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    files: {},
    file_versions: {},
    $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
  };
  return { prisma, tx };
}

const blob = (name: string, size = 10) => ({ originalname: name, mimetype: 'application/pdf', size, buffer: Buffer.alloc(size) });

describe('FileExplorerService', () => {
  const actor = { userId: 'u1' };

  it('rejects unauthenticated callers with 401', async () => {
    const { prisma } = makePrisma();
    const svc = new FileExplorerService(prisma, {} as any);
    await expect(svc.assertProjectMember('p1', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects non-members with 403', async () => {
    const { prisma } = makePrisma({ member: false });
    const svc = new FileExplorerService(prisma, {} as any);
    await expect(svc.assertProjectMember('p1', actor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an empty upload with 400 and stores nothing', async () => {
    const { prisma } = makePrisma();
    const storage = { putObject: jest.fn() };
    const svc = new FileExplorerService(prisma, storage as any);
    await expect(svc.upload('p1', actor, null, [blob('a.pdf', 0)])).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('increments the version number on a same-name upload', async () => {
    const { prisma, tx } = makePrisma({ existingFile: { id: 'f1', mime_type: 'application/pdf' }, existingVersions: [1, 2] });
    const storage = { putObject: jest.fn().mockResolvedValue({}) };
    const svc = new FileExplorerService(prisma, storage as any);
    const res = await svc.upload('p1', actor, null, [blob('spec.pdf')]);
    expect(res.files[0]).toMatchObject({ id: 'f1', version_number: 3 });
    expect(tx.files.create).not.toHaveBeenCalled();
    expect(tx.files.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'f1' },
      data: expect.objectContaining({ current_version_id: 'v-new' }),
    }));
  });

  it('maps a storage outage to 503 retryable and writes no rows', async () => {
    const { prisma } = makePrisma();
    const storage = {
      putObject: jest.fn().mockRejectedValue(new ServiceUnconfiguredError('minio')),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new FileExplorerService(prisma, storage as any);
    const err = await svc.upload('p1', actor, null, [blob('a.pdf')]).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as ServiceUnavailableException).getResponse()).toMatchObject({ retryable: true });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an empty folder name with 400', async () => {
    const { prisma } = makePrisma();
    const svc = new FileExplorerService(prisma, {} as any);
    await expect(svc.createFolder('p1', actor, { name: '  ' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.folders.create).not.toHaveBeenCalled();
  });
});
