/** Shared types for the General Channels feature. */

export interface ChannelListItem {
  id: string;
  name: string;
  internal_only: boolean;
  unread_count: number;
}

export interface ChannelQuestionItem {
  id: string;
  name: string;
  status: string;
  unread_count: number;
}

export interface ChannelListResponse {
  general: ChannelListItem[];
  questions: ChannelQuestionItem[];
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
