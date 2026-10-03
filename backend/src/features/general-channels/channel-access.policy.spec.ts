import { canCreateChannel, canViewChannel, canViewProject } from './channel-access.policy';

describe('canCreateChannel', () => {
  it('allows ADMIN', () => expect(canCreateChannel('ADMIN')).toBe(true));
  it('allows MANAGER', () => expect(canCreateChannel('MANAGER')).toBe(true));
  it('denies USER (Employee)', () => expect(canCreateChannel('USER')).toBe(false));
  it('denies unknown role', () => expect(canCreateChannel('GUEST')).toBe(false));
});

describe('canViewProject', () => {
  it('allows ADMIN regardless of membership', () => {
    expect(canViewProject('ADMIN', false)).toBe(true);
    expect(canViewProject('ADMIN', true)).toBe(true);
  });

  it('allows MANAGER regardless of membership', () => {
    expect(canViewProject('MANAGER', false)).toBe(true);
    expect(canViewProject('MANAGER', true)).toBe(true);
  });

  it('allows USER who is a project member', () => {
    expect(canViewProject('USER', true)).toBe(true);
  });

  it('denies USER who is not a project member', () => {
    expect(canViewProject('USER', false)).toBe(false);
  });
});

describe('canViewChannel', () => {
  it('allows a non-internal channel to any user', () => {
    expect(canViewChannel({ internal_only: false }, false, true)).toBe(true);
    expect(canViewChannel({ internal_only: false }, true, true)).toBe(true);
  });

  it('allows an internal-only channel to a non-external user', () => {
    expect(canViewChannel({ internal_only: true }, false, true)).toBe(true);
  });

  it('denies an internal-only channel to an external user', () => {
    expect(canViewChannel({ internal_only: true }, true, true)).toBe(false);
  });

  it('denies when canViewProjectResult is false regardless of channel', () => {
    expect(canViewChannel({ internal_only: false }, false, false)).toBe(false);
    expect(canViewChannel({ internal_only: true }, false, false)).toBe(false);
  });

  it('treats null internal_only as public (shown to external users)', () => {
    // null is falsy — the `internal_only && isExternal` branch is skipped
    expect(canViewChannel({ internal_only: null }, true, true)).toBe(true);
  });
});
