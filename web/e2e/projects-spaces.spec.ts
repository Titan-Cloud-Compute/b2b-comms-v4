/**
 * Projects and External Organization Spaces — hermetic UI check.
 * Every /api/** call is mocked here (static SPA, hash routing).
 */
import { test, expect, type Page } from '@playwright/test';

const ORG = { id: 'org-1', name: 'Acme Supplies', type: 'vendor' };
const PROJECT = { id: 'proj-1', name: 'Acme Supplies', status: 'active', organization: ORG };

async function mockApi(page: Page, role: string): Promise<{ archived: boolean; invited: string[] }> {
  const state = { archived: false, invited: [] as string[], user: null as null | Record<string, string> };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname.replace(/^.*\/api\//, '').replace(/^\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'POST' && apiPath === 'auth/login') {
      state.user = { id: 'u-1', email: 'manager@example.com', role };
      return json(state.user);
    }
    if (method === 'GET' && apiPath === 'users/me') {
      return state.user ? json(state.user) : json({ message: 'Unauthorized' }, 401);
    }
    if (method === 'GET' && apiPath === 'projects') {
      return json({ items: state.archived ? [] : [PROJECT], page: 1, total: state.archived ? 0 : 1 });
    }
    if (method === 'GET' && apiPath === `projects/${PROJECT.id}`) {
      return json({ ...PROJECT, status: state.archived ? 'archived' : 'active', members: [] });
    }
    if (method === 'POST' && apiPath === `projects/${PROJECT.id}/archive`) {
      state.archived = true;
      return json({ id: PROJECT.id, status: 'archived' });
    }
    if (method === 'POST' && apiPath === `projects/${PROJECT.id}/invitations`) {
      const email = (req.postDataJSON() as { email: string }).email;
      state.invited.push(email);
      return json({ id: 'inv-1', project_id: PROJECT.id, email, status: 'pending', delivery: 'sent',
        expires_at: new Date(Date.now() + 864e5).toISOString() }, 201);
    }
    if (method === 'POST' && apiPath === 'projects') {
      return json({ id: PROJECT.id, name: 'New Co', organization_id: 'org-2', status: 'active', default_channel_id: 'ch-1' }, 201);
    }
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
  return state;
}

async function login(page: Page): Promise<void> {
  await page.goto('/#/login');
  await page.locator('#email').fill('manager@example.com');
  await page.locator('#password').fill('password1234');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/#\/login/, { timeout: 10_000 });
}

test('project list shows company names as links and opens the project space', async ({ page }) => {
  await mockApi(page, 'ADMIN');
  await login(page);
  await page.goto('/#/projects');
  const link = page.locator('[data-testid="project-list"] [data-testid="project-link"]');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveText('Acme Supplies');
  await link.click();
  await expect(page).toHaveURL(/#\/projects\/proj-1$/);
  await expect(page.locator('[data-testid="project-heading"]')).toHaveText('Acme Supplies');
  const files = await page.locator('[data-testid="file-explorer"]').boundingBox();
  const chat = await page.locator('[data-testid="chat-area"]').boundingBox();
  expect(files && chat && files.y < chat.y).toBeTruthy();
});

test('/projects/new shows the create form for managers', async ({ page }) => {
  await mockApi(page, 'MANAGER');
  await login(page);
  await page.goto('/#/projects/new');
  await expect(page.locator('[data-testid="create-project-form"]')).toBeVisible();
  await page.locator('[data-testid="create-project"]').click();
  await expect(page.locator('[data-testid="create-project-error"]')).toBeVisible();
  await page.locator('[data-testid="org-name"]').fill('New Co');
  await page.locator('[data-testid="org-type"]').selectOption('client');
  await page.locator('[data-testid="create-project"]').click();
  await expect(page).toHaveURL(/#\/projects\/proj-1$/);
});

test('detail page invites an external contact and archives the project', async ({ page }) => {
  const state = await mockApi(page, 'ADMIN');
  await login(page);
  await page.goto('/#/projects/proj-1');
  await page.locator('[data-testid="open-invite"]').click();
  await page.locator('[data-testid="invite-email"]').fill('contact@acme.com');
  await page.locator('[data-testid="send-invite"]').click();
  await expect(page.locator('[data-testid="invite-sent"]')).toBeVisible();
  expect(state.invited).toEqual(['contact@acme.com']);
  await page.locator('[data-testid="archive-project"]').click();
  await expect(page.locator('[data-testid="project-status"]')).toHaveText('archived');
  expect(state.archived).toBe(true);
});
