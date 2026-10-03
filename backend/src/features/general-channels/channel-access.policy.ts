/**
 * Pure access-policy functions for the General Channels feature.
 * No I/O — safe to call in tests and server code alike.
 */

export interface ChannelForPolicy {
  internal_only?: boolean | null;
}

/** True when the caller's role permits channel creation. */
export function canCreateChannel(role: string): boolean {
  return role === 'ADMIN' || role === 'MANAGER';
}

/**
 * True when the caller may open the project at all.
 * Admins and managers always can; others must be a project member.
 */
export function canViewProject(role: string, isMember: boolean): boolean {
  return role === 'ADMIN' || role === 'MANAGER' || isMember;
}

/**
 * True when the caller may see this specific channel.
 * Requires canViewProject to have already passed (canViewProjectResult === true),
 * and additionally gates internal-only channels from external users.
 */
export function canViewChannel(
  channel: ChannelForPolicy,
  isExternal: boolean,
  canViewProjectResult: boolean,
): boolean {
  if (!canViewProjectResult) return false;
  if (channel.internal_only && isExternal) return false;
  return true;
}
