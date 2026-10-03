/** In-memory mock fixtures for General Channels endpoints. */

import type {
  ChannelsResponse,
  Channel,
  Message,
  MessagesResponse,
} from './general-channels.types';

export const MOCK_PROJECT_ID = 'p-1';

export const MOCK_CHANNELS: ChannelsResponse = {
  general: [
    { id: 'c-1', name: 'general', internal_only: false, unread_count: 0 },
    { id: 'c-2', name: 'internal', internal_only: true, unread_count: 0 },
  ],
  questions: [],
};

export const MOCK_MESSAGES: MessagesResponse = {
  items: [
    {
      id: 'msg-1',
      author: { id: 'u-other', display_name: 'Other User' },
      body_html: '<script>alert(1)</script>hello world',
      attachments: [],
      edited_at: null,
      created_at: new Date(Date.now() - 60_000).toISOString(),
    },
    {
      id: 'msg-2',
      author: { id: 'u-MANAGER', display_name: 'Manager User' },
      body_html: '<p>A message from manager</p>',
      attachments: [],
      edited_at: null,
      created_at: new Date().toISOString(),
    },
  ],
  next_cursor: null,
};
