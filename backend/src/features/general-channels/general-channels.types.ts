/**
 * Shared types for the General Channels feature.
 * Declared here because @contracts/* (src/shared/contracts) is intentionally empty.
 */

export interface Actor {
  userId: string;
  role: string;
  organizationId?: string | null;
}

export interface ChannelListItem {
  id: string;
  name: string;
  internal_only: boolean;
  unread_count: number;
}

export interface QuestionListItem {
  id: string;
  name: string;
  status: string;
  unread_count: number;
}

export interface ChannelListResponse {
  general: ChannelListItem[];
  questions: QuestionListItem[];
}

export interface CreateChannelRequest {
  name?: unknown;
  internal_only?: unknown;
}

export interface ChannelResponse {
  id: string;
  name: string;
  kind: string;
  internal_only: boolean;
  status: string;
}
