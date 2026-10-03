/**
 * Auth foundation (full_auth): login refuses inactive (deactivated) users with
 * 401, every role (USER, MANAGER, ADMIN) signs in with its own role, and the
 * session token carries the user's organizationId.
 */
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import type { SessionPayload } from './session.types';

const PASSWORD = 'password1234';

async function makeService(user: Record<string, unknown> | null) {
  const findUnique = jest.fn().mockResolvedValue(user);
  const tx = { user: { findUnique } };
  const prisma = {
    runAsAdmin: (fn: (t: typeof tx) => unknown) => fn(tx),
  } as unknown as ConstructorParameters<typeof AuthService>[0];
  const signAsync = jest.fn(async (payload: SessionPayload) => JSON.stringify(payload));
  const jwt = { signAsync } as unknown as ConstructorParameters<typeof AuthService>[1];
  const service = new AuthService(prisma, jwt, {} as never, {} as never);
  return { service, signAsync };
}

async function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u-1',
    email: 'user@demo.local',
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    role: 'USER',
    organization_id: 'org-1',
    active: true,
    ...overrides,
  };
}

describe('AuthService.login — auth foundation', () => {
  it('refuses an inactive user with 401 even when the password is correct', async () => {
    const { service, signAsync } = await makeService(await userRow({ active: false }));
    await expect(
      service.login({ email: 'user@demo.local', password: PASSWORD }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(signAsync).not.toHaveBeenCalled();
  });

  it('treats a null active flag (legacy row) as active', async () => {
    const { service } = await makeService(await userRow({ active: null }));
    await expect(
      service.login({ email: 'user@demo.local', password: PASSWORD }),
    ).resolves.toHaveProperty('token');
  });

  it('refuses a wrong password with 401', async () => {
    const { service } = await makeService(await userRow());
    await expect(
      service.login({ email: 'user@demo.local', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each(['USER', 'MANAGER', 'ADMIN'])(
    '%s signs in with its own role and organizationId in the session',
    async (role) => {
      const { service, signAsync } = await makeService(
        await userRow({ role, email: `${role.toLowerCase()}@demo.local` }),
      );
      const result = await service.login({
        email: `${role.toLowerCase()}@demo.local`,
        password: PASSWORD,
      });
      expect(result.user.role).toBe(role);
      const payload = signAsync.mock.calls[0][0];
      expect(payload).toMatchObject({ userId: 'u-1', role, organizationId: 'org-1' });
    },
  );
});
