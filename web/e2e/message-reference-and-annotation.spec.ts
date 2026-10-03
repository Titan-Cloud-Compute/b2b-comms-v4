/**
 * Message Reference and Annotation — hermetic e2e (static SPA, hash routing, every /api/** call mocked).
 * Covers the routed right-side reference panel (read-only for viewers) and the
 * View Reference control mounted on chat messages.
 */
import { test, expect, type Page } from '@playwright/test';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

async function mockApi(page: Page): Promise<void> {
  let user: { id: string; email: string; role: string } | null = null;
  const now = new Date('2026-09-01T10:00:00Z').toISOString();
  const ref = {
    id: 'r-1', message_id: 'm1', file_version_id: 'fv-1', page_number: 1,
    annotations: {
      text_boxes: [{ x: 0.1, y: 0.1, width: 0.3, text: 'Check this dimension' }],
      drawings: [{ points: [[0.2, 0.3], [0.4, 0.35]], color: '#d32f2f', width: 3 }],
    },
    author_id: 'u2', updated_at: now, file_available: true, can_edit: false,
    file_name: 'spec.pdf', mime_type: 'application/pdf',
  };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname.replace(/^.*\/api\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'POST' && apiPath === 'auth/login') {
      user = { id: 'u1', email: 'user@example.com', role: 'USER' };
      return json(user);
    }
    if (method === 'GET' && apiPath === 'users/me') {
      return user ? json(user) : json({ message: 'Unauthorized' }, 401);
    }
    if (method === 'GET' && apiPath === 'references/r-1') return json(ref);
    if ((method === 'PUT' || method === 'DELETE') && apiPath === 'references/r-1') {
      return json({ message: 'Forbidden' }, 403);
    }
    if (method === 'GET' && apiPath === 'references') {
      return json({ items: [{ id: 'r-1', message_id: 'm1', author_id: 'u2' }] });
    }
    if (method === 'GET' && /^file-versions\/[^/]+\/pages\/\d+$/.test(apiPath)) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 });
    }
    if (method === 'GET' && apiPath === 'questions/q-1') {
      return json({
        id: 'q-1', project_id: 'p-1', name: 'Which beam spec?', kind: 'question', status: 'open',
        resolved_sides: '', my_side: 'internal',
        messages: [
          { id: 'm1', author_id: 'u2', body_html: '<p>See the marked-up drawing</p>', created_at: now },
          { id: 'm2', author_id: 'u1', body_html: '<p>My own message</p>', created_at: now },
        ],
      });
    }
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
}

async function login(page: Page): Promise<void> {
  await page.goto('/#/login');
  await page.locator('#email').fill('user@example.com');
  await page.locator('#password').fill('password1234');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/#\/dashboard/, { timeout: 10_000 });
}

test.use({ serviceWorkers: 'block' });

test('routed reference panel renders read-only for a non-author', async ({ page }) => {
  await mockApi(page);
  await login(page);
  await page.goto('/#/projects/p-1/references/r-1');
  await expect(page.getByTestId('reference-panel')).toBeVisible();
  await expect(page.locator('app-landing')).toHaveCount(0);
  await expect(page.getByTestId('reference-read-only')).toBeVisible();
  await expect(page.getByTestId('reference-edit-controls')).toHaveCount(0);
});

test('chat messages expose View Reference and Add reference controls', async ({ page }) => {
  await mockApi(page);
  await login(page);
  await page.goto('/#/projects/p-1/questions/q-1');
  await expect(page.getByTestId('aq-question-page')).toBeVisible();
  await expect(page.getByTestId('view-reference')).toHaveCount(1);
  await expect(page.getByTestId('add-reference')).toHaveCount(1);
  await page.getByTestId('view-reference').click();
  await expect(page.getByTestId('reference-panel')).toBeVisible();
  await expect(page.getByTestId('reference-read-only')).toBeVisible();
});
