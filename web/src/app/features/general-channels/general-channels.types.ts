/** Type contract for the General Channels feature. */

export interface ChannelSummary {
  id: string;
  name: string;
  internal_only: boolean;
  unread_count: number;
}

export interface ChannelsListResponse {
  general: ChannelSummary[];
  questions: Array<{ id: string; name: string; status: string; unread_count: number }>;
}

export interface MessageAttachment {
  file_id: string;
  name: string;
}

export interface MessageAuthor {
  id: string;
  display_name: string;
}

export interface MessageItem {
  id: string;
  author: MessageAuthor;
  body_html: string;
  attachments: MessageAttachment[];
  reference_id?: string | null;
  edited_at?: string | null;
  created_at: string;
}

export interface MessagesResponse {
  items: MessageItem[];
  next_cursor: string | null;
}

export interface CreatedChannel {
  id: string;
  name: string;
  kind: string;
  internal_only: boolean;
  status: string;
}

export interface CreatedMessage {
  id: string;
  channel_id: string;
  author_id: string;
  body_html: string;
  created_at: string;
}

export interface PatchedMessage {
  id: string;
  body_html: string;
  edited_at: string;
}

export interface OutboxItem {
  temp_id: string;
  channel_id: string;
  body_html: string;
  state: 'pending';
}
