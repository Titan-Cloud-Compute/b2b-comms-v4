import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ChannelsController } from './channels.controller';
import { ChannelAccessPolicy } from './channel-access.policy';
import type { SessionPayload } from '../../auth/session.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function setup(opts: { external?: boolean; channels?: Any[] } = {}) {
  const channels: Any[] = opts.channels ?? [];
  const prisma: Any = {
    organizations: {
      findUnique: jest.fn().mockResolvedValue(opts.external ? { id: 'ext', is_internal: false } : null),
    },
    projects: {
      findUnique: jest.fn().mockResolvedValue({ id: 'p1', organization_id: 'org', created_by: 'mgr' }),
    },
    project_members: { findFirst: jest.fn().mockResolvedValue({ id: 'm' }) },
    channel_read_state: { findMany: jest.fn().mockResolvedValue([]) },
    channels: {
      findFirst: jest.fn(async ({ where }: Any) =>
        channels.find((c) => c.project_id === where.project_id && c.kind === where.kind && c.name === where.name) ?? null),
      findMany: jest.fn(async ({ where }: Any) => channels.filter((c) => c.project_id === where.project_id)),
      findUnique: jest.fn(async ({ where }: Any) => channels.find((c) => c.id === where.id) ?? null),
      create: jest.fn(async ({ data }: Any) => {
        const row = { id: `c${channels.length + 1}`, ...data };
        channels.push(row);
        return row;
      }),
    },
  };
  const realtime: Any = { publish: jest.fn().mockResolvedValue(0) };
  const policy = new ChannelAccessPolicy(prisma);
  const controller = new ChannelsController(prisma, policy, realtime);
  return { prisma, controller, channels, realtime };
}

const req = (s: Partial<SessionPayload> | null): Any =>
  s ? { session: { userId: 'u1', role: 'USER', firmId: null, organizationId: 'org', ...s } } : {};

describe('ChannelsController', () => {
  it('lazily creates the default "general" channel on first open', async () => {
    const { controller, channels } = setup();
    const res = await controller.list('p1', req({ role: 'MANAGER' }));
    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({ kind: 'general', name: 'general', project_id: 'p1' });
    expect(res.general.map((c) => c.name)).toEqual(['general']);
    expect(res.general[0]).toMatchObject({ internal_only: false, unread_count: 0 });
    expect(res.questions).toEqual([]);

    // A second open does not duplicate it.
    await controller.list('p1', req({ role: 'USER' }));
    expect(channels).toHaveLength(1);
  });

  it('lets Managers and Admins create a general channel (internal-only flag stored)', async () => {
    const { controller, channels, realtime } = setup();
    const created = await controller.create('p1', { name: 'design', internal_only: true }, req({ role: 'MANAGER' }));
    expect(created).toMatchObject({ name: 'design', kind: 'general', internal_only: true, status: 'active' });
    expect(channels[0]).toMatchObject({ kind: 'general', internal_only: true });
    expect(realtime.publish).toHaveBeenCalled();
    const admin = await controller.create('p1', { name: 'ops' }, req({ role: 'ADMIN' }));
    expect(admin.internal_only).toBe(false);
  });

  it('returns 403 for Employees and stores no channel', async () => {
    const { controller, channels } = setup();
    await expect(controller.create('p1', { name: 'nope' }, req({ role: 'USER' })))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(channels).toHaveLength(0);
  });

  it('returns 400 for a blank channel name', async () => {
    const { controller } = setup();
    await expect(controller.create('p1', { name: '  ' }, req({ role: 'ADMIN' })))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('hides internal-only channels from External users', async () => {
    const { controller } = setup({
      external: true,
      channels: [
        { id: 'g', project_id: 'p1', kind: 'general', name: 'general', internal_only: false, status: 'active' },
        { id: 'i', project_id: 'p1', kind: 'general', name: 'internal', internal_only: true, status: 'active' },
      ],
    });
    const res = await controller.list('p1', req({ organizationId: 'ext' }));
    expect(res.general.map((c) => c.id)).toEqual(['g']);
  });

  it('rejects unauthenticated callers with 401', async () => {
    const { controller } = setup();
    await expect(controller.list('p1', req(null))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
