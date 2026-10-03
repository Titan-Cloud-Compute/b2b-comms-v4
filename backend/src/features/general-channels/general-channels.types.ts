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

// ── Messages ──────────────────────────────────────────────────────────────────

export interface CreateMessageRequest {
  body_html?: unknown;
  attachments?: unknown;
}

export interface UpdateMessageRequest {
  body_html?: unknown;
}

export interface MessageAuthor {
  id: string;
  display_name: string;
}

export interface MessageAttachmentItem {
  file_id: string;
  name: string;
}

export interface MessageItem {
  id: string;
  author: MessageAuthor;
  body_html: string;
  attachments: MessageAttachmentItem[];
  reference_id: string | null;
  edited_at: Date | null;
  created_at: Date;
}

export interface MessageListResponse {
  items: MessageItem[];
  next_cursor: string | null;
}

export interface MessageCreatedResponse {
  id: string;
  channel_id: string;
  author_id: string;
  body_html: string;
  created_at: Date;
}

export interface MessageUpdatedResponse {
  id: string;
  body_html: string;
  edited_at: Date;
}

export interface MessageListQuery {
  cursor?: unknown;
  limit?: unknown;
}
