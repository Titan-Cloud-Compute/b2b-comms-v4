/**
 * General Channels — hermetic UI spec.
 * Every /api/** call is intercepted via page.route; no real network hits.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PROJECT_ID = 'p-1';
const CHANNEL_GENERAL = { id: 'c-1', name: 'general', internal_only: false, unread_count: 0 };
const CHANNEL_INTERNAL = { id: 'c-2', name: 'internal-team', internal_only: true, unread_count: 0 };

function makeUser(role: string) {
  return { id: `u-${role}`, email: `${role.toLowerCase()}@demo.local`, role, name: `${role} User` };
}

function makeMessages(authorId: string) {
  return {
    items: [
      {
        id: 'msg-script',
        author: { id: 'u-OTHER', display_name: 'Other' },
        body_html: '<script>alert(1)</script><p>hello</p>',
        attachments: [],
        edited_at: null,
        created_at: new Date(Date.now() - 120_000).toISOString(),
      },
      {
        id: 'msg-own',
        author: { id: authorId, display_name: 'Me' },
        body_html: '<p>My message</p>',
        attachments: [],
        edited_at: null,
        created_at: new Date(Date.now() - 60_000).toISOString(),
      },
    ],
    next_cursor: null,
  };
}

// ─── Mock setup ───────────────────────────────────────────────────────────────

interface MockState {
  channels: typeof CHANNEL_GENERAL[];
  messages: ReturnType<typeof makeMessages>;
  postAborted: boolean;
  getMessagesCount: number;
}

async function setupMocks(page: Page, role: string): Promise<MockState> {
  const user = makeUser(role);
  const state: MockState = {
    channels: [CHANNEL_GENERAL],
    messages: makeMessages(user.id),
    postAborted: false,
    getMessagesCount: 0,
  };

  let signedIn = false;

  await page.route('**/api/**', async (route: Route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const pathname = new URL(req.url()).pathname;
    const apiPath = pathname.replace(/^.*\/api\//, '').replace(/^\//, '');

    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });

    // Auth
    if (method === 'POST' && apiPath === 'auth/login') {
      signedIn = true;
      return json(user);
    }
    if (method === 'GET' && apiPath === 'users/me') {
      return signedIn ? json(user) : json({ message: 'Unauthorized' }, 401);
    }

    // Realtime SSE — return empty event stream immediately
    if (method === 'GET' && apiPath === 'realtime/socket') {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: '',
      });
    }

    // Channels list
    if (method === 'GET' && apiPath === `projects/${PROJECT_ID}/channels`) {
      return json({ general: state.channels, questions: [] });
    }

    // Create channel
    if (method === 'POST' && apiPath === `projects/${PROJECT_ID}/channels`) {
      const body = req.postDataJSON() as { name: string; internal_only: boolean };
      const newCh = {
        id: `c-new-${Date.now()}`,
        name: body.name,
        kind: 'general',
        internal_only: body.internal_only,
        status: 'active',
        unread_count: 0,
      };
      state.channels.push(newCh as typeof CHANNEL_GENERAL);
      return json(newCh, 201);
    }

    // Messages list
    if (method === 'GET' && apiPath === `channels/c-1/messages`) {
      state.getMessagesCount++;
      return json(state.messages);
    }

    // Post message
    if (method === 'POST' && apiPath === `channels/c-1/messages`) {
      if (state.postAborted) {
        return route.abort('failed');
      }
      const body = req.postDataJSON() as { body_html: string };
      const newMsg = {
        id: `msg-new-${Date.now()}`,
        author: { id: user.id, display_name: user.name },
        body_html: body.body_html,
        attachments: [],
        edited_at: null,
        created_at: new Date().toISOString(),
      };
      state.messages.items = [...state.messages.items, newMsg];
      return json({ id: newMsg.id, channel_id: 'c-1', author_id: user.id, body_html: body.body_html, created_at: newMsg.created_at }, 201);
    }

    // Patch message
    if (method === 'PATCH' && apiPath.startsWith('messages/')) {
      const msgId = apiPath.split('/')[1];
      const body = req.postDataJSON() as { body_html: string };
      const editedAt = new Date().toISOString();
      state.messages.items = state.messages.items.map(m =>
        m.id === msgId ? { ...m, body_html: body.body_html, edited_at: editedAt } : m,
      );
      return json({ id: msgId, body_html: body.body_html, edited_at: editedAt });
    }

    // Delete message
    if (method === 'DELETE' && apiPath.startsWith('messages/')) {
      const msgId = apiPath.split('/')[1];
      state.messages.items = state.messages.items.filter(m => m.id !== msgId);
      return route.fulfill({ status: 204, body: '' });
    }

    // Notification preferences (AuthService background call)
    if (method === 'GET' && apiPath.includes('notification-preferences')) {
      return json({ diagnosticReadyEmail: false });
    }

    // Fallback
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });

  return state;
}

async function signIn(page: Page, role: string): Promise<void> {
  await page.goto('/#/login');
  await page.locator('#email').fill(`${role.toLowerCase()}@demo.local`);
  await page.locator('#password').fill('password1234');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/#\/login/, { timeout: 10_000 });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.use({ serviceWorkers: 'block' });

test('shows "general" under General Channels when a member opens the channels page', async ({ page }) => {
  await setupMocks(page, 'MANAGER');
  await signIn(page, 'MANAGER');

  await page.goto(`/#/projects/${PROJECT_ID}/channels`);

  const list = page.locator('[data-testid="general-channel-list"]');
  await expect(list).toBeVisible({ timeout: 10_000 });

  const links = list.locator('[data-testid="channel-link"]');
  await expect(links.first()).toContainText('general');
});

test('Manager can create an internal-only channel which appears with an internal badge', async ({ page }) => {
  await setupMocks(page, 'MANAGER');
  await signIn(page, 'MANAGER');
  await page.goto(`/#/projects/${PROJECT_ID}/channels`);

  // Wait for channel list to load
  await expect(page.locator('[data-testid="general-channel-list"]')).toBeVisible({ timeout: 10_000 });

  // Open create form
  const newBtn = page.locator('[data-testid="new-channel-btn"]');
  await expect(newBtn).toBeVisible();
  await newBtn.click();

  // Fill form
  await page.locator('[data-testid="channel-name-input"]').fill('secret-ops');
  await page.locator('[data-testid="internal-only-toggle"]').check();
  await page.locator('[data-testid="create-channel-submit"]').click();

  // New channel should appear in the list with an internal badge
  const channelLinks = page.locator('[data-testid="channel-link"]');
  await expect(channelLinks.filter({ hasText: 'secret-ops' })).toBeVisible({ timeout: 5_000 });
  await expect(
    channelLinks.filter({ hasText: 'secret-ops' }).locator('[data-testid="internal-badge"]'),
  ).toBeVisible();
});

test('Employee (USER role) sees no create button', async ({ page }) => {
  await setupMocks(page, 'USER');
  await signIn(page, 'USER');
  await page.goto(`/#/projects/${PROJECT_ID}/channels`);

  await expect(page.locator('[data-testid="general-channel-list"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="new-channel-btn"]')).toHaveCount(0);
});

test('posts a bold message that renders inside <strong> in the message list', async ({ page }) => {
  await setupMocks(page, 'MANAGER');
  await signIn(page, 'MANAGER');
  await page.goto(`/#/projects/${PROJECT_ID}/channels`);

  await expect(page.locator('[data-testid="message-composer"]')).toBeVisible({ timeout: 10_000 });

  // Type into contenteditable
  const composer = page.locator('[data-testid="message-composer"]');
  await composer.click();
  await page.keyboard.type('hello world');

  // Select all and bold
  await page.keyboard.press('Control+a');
  await page.locator('[data-testid="bold-btn"]').click();

  // Send
  await page.locator('[data-testid="send-btn"]').click();

  // Wait for the message to appear in the list with <strong>
  const lastBody = page.locator('[data-testid="message-body"]').last();
  await expect(lastBody.locator('strong')).toBeVisible({ timeout: 5_000 });
  await expect(lastBody.locator('strong')).toContainText('hello world');
});

test('mocked message with script tag body renders with no script element', async ({ page }) => {
  await setupMocks(page, 'MANAGER');
  await signIn(page, 'MANAGER');
  await page.goto(`/#/projects/${PROJECT_ID}/channels`);

  await expect(page.locator('[data-testid="message-list"]')).toBeVisible({ timeout: 10_000 });

  // The message-body for msg-script should NOT contain a script element
  const bodies = page.locator('[data-testid="message-body"]');
  // Wait for messages to render
  await expect(bodies.first()).toBeVisible({ timeout: 5_000 });

  // Check no script element anywhere in the list
  await expect(page.locator('[data-testid="message-list"] script')).toHaveCount(0);

  // The text "hello" should still be visible (the text content is preserved, script removed)
  await expect(bodies.first()).toContainText('hello');
});

test('offline message shows pending label; disappears when retried on reconnect', async ({ page }) => {
  const state = await setupMocks(page, 'MANAGER');
  await signIn(page, 'MANAGER');
  await page.goto(`/#/projects/${PROJECT_ID}/channels`);

  await expect(page.locator('[data-testid="message-composer"]')).toBeVisible({ timeout: 10_000 });

  // Record initial GET count
  const initialGetCount = state.getMessagesCount;

  // Make the next POST abort (simulate network failure)
  state.postAborted = true;

  const composer = page.locator('[data-testid="message-composer"]');
  await composer.click();
  await page.keyboard.type('offline message');
  await page.locator('[data-testid="send-btn"]').click();

  // Pending label should appear
  await expect(page.locator('[data-testid="pending-label"]')).toBeVisible({ timeout: 5_000 });

  // Allow POST to succeed now
  state.postAborted = false;

  // Trigger the 'online' event to kick off retry
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  // Pending label should disappear after successful retry
  await expect(page.locator('[data-testid="pending-label"]')).toHaveCount(0, { timeout: 8_000 });

  // History should have been re-fetched (GET count increased)
  expect(state.getMessagesCount).toBeGreaterThan(initialGetCount);
});

test('author sees Edit/Delete on their own message; edit shows "edited" label; delete removes it', async ({ page }) => {
  await setupMocks(page, 'MANAGER');
  await signIn(page, 'MANAGER');
  await page.goto(`/#/projects/${PROJECT_ID}/channels`);

  await expect(page.locator('[data-testid="message-list"]')).toBeVisible({ timeout: 10_000 });

  // The own message (msg-own by u-MANAGER) should have Edit and Delete buttons
  const ownMessage = page.locator('[data-message-id="msg-own"]');
  await expect(ownMessage).toBeVisible({ timeout: 5_000 });
  await expect(ownMessage.locator('[data-testid="edit-btn"]')).toBeVisible();
  await expect(ownMessage.locator('[data-testid="delete-btn"]')).toBeVisible();

  // The other message should NOT have Edit/Delete buttons
  const otherMessage = page.locator('[data-message-id="msg-script"]');
  await expect(otherMessage.locator('[data-testid="edit-btn"]')).toHaveCount(0);

  // Edit: click Edit, change body, save
  await ownMessage.locator('[data-testid="edit-btn"]').click();
  const editEditor = ownMessage.locator('[data-testid="edit-editor"]');
  await expect(editEditor).toBeVisible();
  await editEditor.clear();
  await editEditor.fill('edited content');
  await ownMessage.locator('[data-testid="save-edit-btn"]').click();

  // "edited" label should appear
  await expect(ownMessage.locator('[data-testid="edited-label"]')).toBeVisible({ timeout: 5_000 });

  // Delete: click Delete on the own message
  await ownMessage.locator('[data-testid="delete-btn"]').click();

  // Message should disappear
  await expect(page.locator('[data-message-id="msg-own"]')).toHaveCount(0, { timeout: 5_000 });
});
