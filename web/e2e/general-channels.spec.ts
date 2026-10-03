/**
 * General Channels — hermetic e2e spec.
 *
 * Every /api/** call is fulfilled by page.route() — nothing reaches the network.
 * Covers: channel list, internal badge, create-button gating by role, bold
 * formatting, XSS sanitization, offline-pending-retry, edit and delete.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';

// ─── shared fixtures ─────────────────────────────────────────────────────────

const ISO = '2026-10-03T10:00:00.000Z';

interface MockState {
  signedIn: boolean;
  channels: { general: ChannelMock[]; questions: never[] };
  messages: MessageMock[];
  postedMessages: MessageMock[];
  deletedIds: Set<string>;
  getCount: number;
}

interface ChannelMock {
  id: string;
  name: string;
  internal_only: boolean;
  unread_count: number;
}

interface MessageMock {
  id: string;
  author: { id: string; display_name: string };
  body_html: string;
  attachments: never[];
  edited_at?: string | null;
  created_at: string;
}

async function setupMocks(
  page: Page,
  role: 'MANAGER' | 'USER',
): Promise<MockState> {
  const userId = `u-${role}`;

  const state: MockState = {
    signedIn: false,
    channels: {
      general: [
        { id: 'c-1', name: 'general', internal_only: false, unread_count: 0 },
      ],
      questions: [],
    },
    messages: [
      {
        id: 'm-script',
        author: { id: 'u-other', display_name: 'Other User' },
        // body_html intentionally contains a script tag — must be stripped on render.
        body_html: '<p>Hello world</p><script>window.__xss=1<\/script>',
        attachments: [],
        created_at: ISO,
      },
      {
        id: 'm-own',
        author: { id: 'u-MANAGER', display_name: 'Manager User' },
        body_html: '<p>My own message</p>',
        attachments: [],
        created_at: ISO,
      },
    ],
    postedMessages: [],
    deletedIds: new Set(),
    getCount: 0,
  };

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const url = new URL(req.url());
    // Normalise: strip leading "/api/" (or "api/") prefix.
    const apiPath = url.pathname.replace(/^.*\/api\//, '').replace(/^\//, '');

    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });

    const body = (): Record<string, unknown> => {
      try {
        return (req.postDataJSON() as Record<string, unknown>) ?? {};
      } catch {
        return {};
      }
    };

    // ── Auth ──────────────────────────────────────────────────────────────
    if (method === 'POST' && apiPath === 'auth/login') {
      state.signedIn = true;
      return json({ id: userId, email: `${role.toLowerCase()}@demo.local`, role });
    }
    if (method === 'GET' && apiPath === 'users/me') {
      return state.signedIn
        ? json({ id: userId, email: `${role.toLowerCase()}@demo.local`, role })
        : json({ message: 'Unauthorized' }, 401);
    }

    // ── Channels ──────────────────────────────────────────────────────────
    if (method === 'GET' && apiPath === 'projects/p-1/channels') {
      return json(state.channels);
    }
    if (method === 'POST' && apiPath === 'projects/p-1/channels') {
      const b = body();
      const newCh: ChannelMock = {
        id: 'c-new',
        name: String(b['name'] ?? 'new-channel'),
        internal_only: Boolean(b['internal_only']),
        unread_count: 0,
      };
      state.channels.general.push(newCh);
      return json({
        id: newCh.id,
        name: newCh.name,
        kind: 'general',
        internal_only: newCh.internal_only,
        status: 'active',
      }, 201);
    }

    // ── Messages ──────────────────────────────────────────────────────────
    if (method === 'GET' && apiPath === 'channels/c-1/messages') {
      state.getCount++;
      const active = state.messages
        .filter(m => !state.deletedIds.has(m.id))
        .concat(state.postedMessages);
      return json({ items: active, next_cursor: null });
    }
    if (method === 'POST' && apiPath === 'channels/c-1/messages') {
      const b = body();
      const newMsg: MessageMock = {
        id: `m-post-${Date.now()}`,
        author: { id: userId, display_name: role === 'MANAGER' ? 'Manager User' : 'User' },
        body_html: String(b['body_html'] ?? ''),
        attachments: [],
        created_at: new Date().toISOString(),
      };
      state.postedMessages.push(newMsg);
      return json(newMsg, 201);
    }

    // ── Edit ──────────────────────────────────────────────────────────────
    if (method === 'PATCH' && apiPath === 'messages/m-own') {
      const b = body();
      const editedAt = new Date().toISOString();
      state.messages = state.messages.map(m =>
        m.id === 'm-own'
          ? { ...m, body_html: String(b['body_html'] ?? m.body_html), edited_at: editedAt }
          : m,
      );
      return json({ id: 'm-own', body_html: String(b['body_html'] ?? ''), edited_at: editedAt });
    }

    // ── Delete ─────────────────────────────────────────────────────────────
    if (method === 'DELETE' && apiPath === 'messages/m-own') {
      state.deletedIds.add('m-own');
      return route.fulfill({ status: 204 });
    }

    // ── Realtime SSE ── abort so EventSource never fires "open" in tests ──
    if (method === 'GET' && apiPath === 'realtime/socket') {
      return route.abort('connectionfailed');
    }

    // ── Catch-all ─────────────────────────────────────────────────────────
    if (method === 'GET') return json(null);
    return json({ ok: true });
  });

  return state;
}

async function signIn(page: Page, role: 'MANAGER' | 'USER'): Promise<void> {
  await page.goto('/#/login');
  await page.locator('#email').fill(`${role.toLowerCase()}@demo.local`);
  await page.locator('#password').fill('password1234');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/#\/dashboard/, { timeout: 10_000 });
}

// ─── tests ────────────────────────────────────────────────────────────────────

test.use({ serviceWorkers: 'block' });

test('member sees "general" under General Channels', async ({ page }) => {
  await setupMocks(page, 'MANAGER');
  await signIn(page, 'MANAGER');

  await page.goto('/#/projects/p-1/channels');

  await expect(page.getByTestId('general-channel-list')).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByTestId('channel-link').filter({ hasText: 'general' }),
  ).toBeVisible();
});

test('manager creates internal-only channel; internal badge is shown', async ({ page }) => {
  await setupMocks(page, 'MANAGER');
  await signIn(page, 'MANAGER');

  await page.goto('/#/projects/p-1/channels');
  await expect(page.getByTestId('general-channel-list')).toBeVisible({ timeout: 10_000 });

  // Open the create form.
  await page.getByTestId('new-channel-btn').click();
  await page.getByTestId('channel-name-input').fill('internal-team');
  await page.getByTestId('internal-only-toggle').check();
  await page.getByTestId('create-channel-submit').click();

  // The new channel should appear in the sidebar with the internal badge.
  await expect(page.getByTestId('internal-badge')).toBeVisible({ timeout: 5_000 });
});

test('employee (USER role) cannot see the create-channel button', async ({ page }) => {
  await setupMocks(page, 'USER');
  await signIn(page, 'USER');

  await page.goto('/#/projects/p-1/channels');
  await expect(page.getByTestId('general-channel-list')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('new-channel-btn')).toHaveCount(0);
});

test('bold message renders with <strong> in message-body', async ({ page }) => {
  await setupMocks(page, 'MANAGER');
  await signIn(page, 'MANAGER');

  await page.goto('/#/projects/p-1/channels');
  // Click the general channel link to load messages.
  await expect(page.getByTestId('channel-link').filter({ hasText: 'general' })).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('channel-link').filter({ hasText: 'general' }).click();

  // Wait for the composer to appear.
  await expect(page.getByTestId('message-composer')).toBeVisible({ timeout: 8_000 });

  // Type text, select all, apply bold via Ctrl+B, then send.
  await page.getByTestId('message-composer').click();
  await page.keyboard.type('Bold text');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Enter');

  // After sending, a GET reloads messages; the posted body_html should include <strong>.
  await expect(
    page.locator('[data-testid="message-body"] strong').first(),
  ).toBeVisible({ timeout: 8_000 });
});

test('script tag in mocked message body is stripped from the DOM', async ({ page }) => {
  await setupMocks(page, 'MANAGER');
  await signIn(page, 'MANAGER');

  await page.goto('/#/projects/p-1/channels');
  await expect(page.getByTestId('channel-link').filter({ hasText: 'general' })).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('channel-link').filter({ hasText: 'general' }).click();

  await expect(page.getByTestId('message-list')).toBeVisible({ timeout: 8_000 });

  // The script tag from 'm-script' must never appear as a DOM element.
  await expect(page.locator('[data-testid="message-body"] script')).toHaveCount(0);
  // The text content is still rendered.
  await expect(page.getByText('Hello world')).toBeVisible();
});

test('offline message shows pending label; label disappears after retry', async ({ page, context }: { page: Page; context: BrowserContext }) => {
  const state = await setupMocks(page, 'MANAGER');
  await signIn(page, 'MANAGER');

  await page.goto('/#/projects/p-1/channels');
  await expect(page.getByTestId('channel-link').filter({ hasText: 'general' })).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('channel-link').filter({ hasText: 'general' }).click();
  await expect(page.getByTestId('message-composer')).toBeVisible({ timeout: 8_000 });

  const initialGetCount = state.getCount;

  // Go offline — navigator.onLine becomes false.
  await context.setOffline(true);

  // Send a message while offline.
  await page.getByTestId('message-composer').click();
  await page.keyboard.type('Offline message');
  await page.keyboard.press('Enter');

  // The message must appear as pending.
  await expect(page.getByTestId('pending-label')).toBeVisible({ timeout: 5_000 });

  // Go back online — fires the window 'online' event which triggers retryAll().
  await context.setOffline(false);

  // Pending label must disappear once the retry POST succeeds and history reloads.
  await expect(page.getByTestId('pending-label')).toHaveCount(0, { timeout: 8_000 });

  // Verify that at least one additional GET was made (history re-fetched).
  expect(state.getCount).toBeGreaterThan(initialGetCount);
});

test('author can edit own message (shows edited label) and delete it', async ({ page }) => {
  await setupMocks(page, 'MANAGER');
  await signIn(page, 'MANAGER');

  await page.goto('/#/projects/p-1/channels');
  await expect(page.getByTestId('channel-link').filter({ hasText: 'general' })).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('channel-link').filter({ hasText: 'general' }).click();

  // Wait for own message and its Edit button (visible only for the message author).
  await expect(page.getByTestId('edit-btn').first()).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId('delete-btn').first()).toBeVisible();

  // ── Edit ──
  await page.getByTestId('edit-btn').first().click();
  const editField = page.getByTestId('edit-field').first();
  await expect(editField).toBeVisible();
  await editField.fill('Updated content');
  await page.getByTestId('save-edit-btn').first().click();

  // The "(edited)" label must appear after PATCH succeeds.
  await expect(page.getByTestId('edited-label').first()).toBeVisible({ timeout: 5_000 });

  // ── Delete ──
  await page.getByTestId('delete-btn').first().click();

  // After DELETE the message (and its edited label) must be gone.
  await expect(page.getByTestId('edited-label')).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByText('Updated content')).toHaveCount(0);
});
