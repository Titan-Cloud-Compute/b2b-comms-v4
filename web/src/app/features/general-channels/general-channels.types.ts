/** Contract types for General Channels feature. */

export interface Channel {
  id: string;
  name: string;
  internal_only: boolean;
  unread_count: number;
}

export interface QuestionChannel {
  id: string;
  name: string;
  status: string;
  unread_count: number;
}

export interface ChannelsResponse {
  general: Channel[];
  questions: QuestionChannel[];
}

export interface MessageAttachment {
  file_id: string;
  name: string;
}

export interface MessageAuthor {
  id: string;
  display_name: string;
}

export interface Message {
  id: string;
  author: MessageAuthor;
  body_html: string;
  attachments: MessageAttachment[];
  reference_id?: string | null;
  edited_at?: string | null;
  created_at: string;
}

export interface MessagesResponse {
  items: Message[];
  next_cursor?: string | null;
}

export interface CreateChannelInput {
  name: string;
  internal_only: boolean;
}

export interface CreateChannelResponse {
  id: string;
  name: string;
  kind: string;
  internal_only: boolean;
  status: string;
}

export interface PostMessageInput {
  body_html: string;
  attachments?: Array<{ file_id: string; name: string }>;
}

export interface PostMessageResponse {
  id: string;
  channel_id: string;
  author_id: string;
  body_html: string;
  created_at: string;
}

export interface PatchMessageResponse {
  id: string;
  body_html: string;
  edited_at: string;
}

export interface RealtimeEvent {
  type: 'message.created' | 'message.updated' | 'message.deleted';
  channel_id: string;
  payload: unknown;
}

/** An optimistic outbox item shown with a pending label until confirmed. */
export interface OutboxItem {
  temp_id: string;
  channel_id: string;
  body_html: string;
  state: 'pending' | 'retrying';
}
