import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChannelAccessPolicy } from './channel-access.policy';
import type { SessionPayload } from '../../auth/session.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makePrisma(overrides: Record<string, any> = {}): any {
  return {
    organizations: { findUnique: jest.fn().mockResolvedValue(null) },
    projects: {
      findUnique: jest.fn().mockResolvedValue({ id: 'p1', organization_id: 'org-int', created_by: 'mgr' }),
    },
    project_members: { findFirst: jest.fn().mockResolvedValue(null) },
    channels: { findUnique: jest.fn().mockResolvedValue(null) },
    ...overrides,
  };
}

const session = (s: Partial<SessionPayload>): SessionPayload =>
  ({ userId: 'u1', role: 'USER', firmId: null, ...s }) as SessionPayload;

describe('ChannelAccessPolicy', () => {
  it('only Managers and Admins may create channels', () => {
    const policy = new ChannelAccessPolicy(makePrisma());
    expect(policy.canCreateChannel(session({ role: 'MANAGER' }))).toBe(true);
    expect(policy.canCreateChannel(session({ role: 'ADMIN' }))).toBe(true);
    expect(policy.canCreateChannel(session({ role: 'USER' }))).toBe(false);
  });

  it('treats users of non-internal organizations as external', async () => {
    const prisma = makePrisma({
      organizations: { findUnique: jest.fn().mockResolvedValue({ id: 'org-ext', is_internal: false }) },
    });
    const policy = new ChannelAccessPolicy(prisma);
    expect(await policy.isExternal(session({ organizationId: 'org-ext' }))).toBe(true);
    expect(await policy.isExternal(session({ organizationId: null }))).toBe(false);
  });

  it('hides internal-only channels from external users with 403', async () => {
    const prisma = makePrisma({
      organizations: { findUnique: jest.fn().mockResolvedValue({ id: 'org-ext', is_internal: false }) },
      channels: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c1', project_id: 'p1', internal_only: true }),
      },
      project_members: { findFirst: jest.fn().mockResolvedValue({ id: 'm1' }) },
    });
    const policy = new ChannelAccessPolicy(prisma);
    await expect(
      policy.assertChannelAccess(session({ userId: 'ext', organizationId: 'org-ext' }), 'c1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets project members open a normal channel', async () => {
    const prisma = makePrisma({
      channels: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c1', project_id: 'p1', internal_only: false }),
      },
      project_members: { findFirst: jest.fn().mockResolvedValue({ id: 'm1' }) },
    });
    const policy = new ChannelAccessPolicy(prisma);
    const ch = await policy.assertChannelAccess(session({}), 'c1');
    expect(ch.id).toBe('c1');
  });

  it('rejects non-members with 403 and missing channels with 404', async () => {
    const prisma = makePrisma({
      channels: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 'c1', project_id: 'p1', internal_only: false })
          .mockResolvedValueOnce(null),
      },
    });
    const policy = new ChannelAccessPolicy(prisma);
    await expect(policy.assertChannelAccess(session({ userId: 'stranger' }), 'c1'))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(policy.assertChannelAccess(session({}), 'missing'))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
