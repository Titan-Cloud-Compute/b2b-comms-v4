/**
 * general-channels-mocks.ts
 *
 * Registers in-memory MockApiClient handlers for the General Channels feature.
 * Called by app.config.ts when the app runs in USE_MOCKS mode (local preview /
 * design-review environment).  The hermetic Playwright tests use page.route()
 * instead — this file is not imported by the tests.
 */
import { ApiClient, MockApiClient } from '../../shared/api/api-client';

const now = () => new Date().toISOString();

export function registerGeneralChannelsMocks(api: ApiClient, projectId = 'p-1'): void {
  if (!(api instanceof MockApiClient)) return;
  const mock = api;

  const channels = [
    { id: 'c-general', name: 'general', kind: 'general', internal_only: false, status: 'active', unread_count: 2 },
    { id: 'c-internal', name: 'internal-team', kind: 'general', internal_only: true, status: 'active', unread_count: 0 },
  ];

  const messagesStore: Record<string, any[]> = {
    'c-general': [
      {
        id: 'm-1',
        author: { id: 'user-2', display_name: 'Alice Manager' },
        body_html: '<p>Welcome to the <strong>general</strong> channel!</p>',
        attachments: [],
        created_at: now(),
      },
    ],
  };

  mock.registerMock('GET', `/api/projects/${projectId}/channels`, async () => ({
    general: channels,
    questions: [],
  }));

  mock.registerMock('POST', `/api/projects/${projectId}/channels`, async (body) => {
    const b = (body ?? {}) as { name?: string; internal_only?: boolean };
    const ch = {
      id: `c-${Date.now()}`,
      name: b.name ?? 'new-channel',
      kind: 'general',
      internal_only: !!b.internal_only,
      status: 'active',
    };
    channels.push({ ...ch, unread_count: 0 });
    messagesStore[ch.id] = [];
    return ch;
  });

  for (const ch of channels) {
    const cid = ch.id;
    mock.registerMock('GET', `/api/channels/${cid}/messages`, async () => ({
      items: messagesStore[cid] ?? [],
      next_cursor: null,
    }));

    mock.registerMock('POST', `/api/channels/${cid}/messages`, async (body) => {
      const b = (body ?? {}) as { body_html?: string };
      const msg = {
        id: `m-${Date.now()}`,
        author: { id: 'current-user', display_name: 'You' },
        body_html: b.body_html ?? '',
        attachments: [],
        created_at: now(),
      };
      if (!messagesStore[cid]) messagesStore[cid] = [];
      messagesStore[cid].push(msg);
      return msg;
    });
  }

  mock.registerMock('PATCH', '/api/messages/:id', async (body) => {
    const b = (body ?? {}) as { body_html?: string };
    return { id: 'patched', body_html: b.body_html ?? '', edited_at: now() };
  });

  mock.registerMock('DELETE', '/api/messages/:id', async () => undefined);
}
