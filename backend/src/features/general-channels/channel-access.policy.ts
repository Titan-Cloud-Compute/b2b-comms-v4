/**
 * Pure access-policy functions for General Channels.
 * No I/O — easy to unit-test without a DB.
 */

export interface ChannelRecord {
  internal_only?: boolean | null;
}

/** Only ADMIN and MANAGER may create channels. */
export function canCreateChannel(role: string): boolean {
  return role === 'ADMIN' || role === 'MANAGER';
}

/**
 * Can the caller see the project at all?
 * ADMIN/MANAGER always can; a plain USER must be a project member.
 */
export function canViewProject(role: string, isMember: boolean): boolean {
  if (role === 'ADMIN' || role === 'MANAGER') return true;
  return isMember;
}

/**
 * Can the caller see this specific channel?
 * Requires canViewProject to be true, and internal_only channels are
 * hidden from external (non-internal-org) users.
 */
export function canViewChannel(
  channel: ChannelRecord,
  isExternal: boolean,
  canViewProjectResult: boolean,
): boolean {
  if (!canViewProjectResult) return false;
  if (channel.internal_only && isExternal) return false;
  return true;
}
