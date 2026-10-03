import { canCreateChannel, canViewProject, canViewChannel } from './channel-access.policy';

describe('channel-access.policy — canCreateChannel', () => {
  it('allows ADMIN', () => expect(canCreateChannel('ADMIN')).toBe(true));
  it('allows MANAGER', () => expect(canCreateChannel('MANAGER')).toBe(true));
  it('denies USER (employee)', () => expect(canCreateChannel('USER')).toBe(false));
  it('denies unknown role', () => expect(canCreateChannel('GUEST')).toBe(false));
});

describe('channel-access.policy — canViewProject', () => {
  it('ADMIN can view without membership', () => expect(canViewProject('ADMIN', false)).toBe(true));
  it('ADMIN can view with membership', () => expect(canViewProject('ADMIN', true)).toBe(true));
  it('MANAGER can view without membership', () => expect(canViewProject('MANAGER', false)).toBe(true));
  it('USER can view when a member', () => expect(canViewProject('USER', true)).toBe(true));
  it('USER cannot view when not a member', () => expect(canViewProject('USER', false)).toBe(false));
});

describe('channel-access.policy — canViewChannel', () => {
  it('returns false when canViewProject is false', () =>
    expect(canViewChannel({ internal_only: false }, false, false)).toBe(false));

  it('internal_only channel is hidden from external user', () =>
    expect(canViewChannel({ internal_only: true }, true, true)).toBe(false));

  it('internal_only channel is visible to internal user', () =>
    expect(canViewChannel({ internal_only: true }, false, true)).toBe(true));

  it('non-internal_only channel is visible to external user with project access', () =>
    expect(canViewChannel({ internal_only: false }, true, true)).toBe(true));

  it('null internal_only is treated as falsy (not hidden)', () =>
    expect(canViewChannel({ internal_only: null }, true, true)).toBe(true));

  it('undefined internal_only is treated as falsy (not hidden)', () =>
    expect(canViewChannel({}, true, true)).toBe(true));
});
