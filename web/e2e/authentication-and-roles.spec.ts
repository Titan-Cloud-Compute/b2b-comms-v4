/**
 * Authentication and Roles hermetic spec.
 * All /api/** calls are mocked — nothing reaches the network.
 */
import { test, expect, type Page } from '@playwright/test';

type Role = 'USER' | 'MANAGER' | 'ADMIN';

function makeUser(role: Role) {
  return {
    id: `u-${role}`,
    email: `${role.toLowerCase()}@demo.local`,
    display_name: role.toLowerCase(),
    role,
    organization_id: 'org-1',
  };
}

function loginResponse(role: Role) {
  return { user: makeUser(role), landing: '/projects' };
}

async function mockLoginSuccess(page: Page, role: Role): Promise<void> {
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname
      .replace(/^.*\/api\//, '').replace(/^api\//, '').replace(/^\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'POST' && apiPath === 'auth/login') {
      return json(loginResponse(role));
    }
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
}

async function signIn(page: Page, role: Role): Promise<void> {
  await page.goto('/#/login');
  await page.locator('#email').fill(`${role.toLowerCase()}@demo.local`);
  await page.locator('#password').fill('password1234');
  await page.locator('button[type="submit"]').click();
}

test.use({ serviceWorkers: 'block' });

// ── Login: all roles land on /projects ───────────────────────────────────────

for (const role of ['USER', 'MANAGER', 'ADMIN'] as Role[]) {
  test(`${role} signs in and lands on /#/projects`, async ({ page }) => {
    await mockLoginSuccess(page, role);
    await signIn(page, role);
    await expect(page).toHaveURL(/#\/projects/, { timeout: 10_000 });
  });
}

// ── Login: 401 shows "Invalid credentials" ───────────────────────────────────

test('401 shows "Invalid credentials" and never "Invalid email or password"', async ({ page }) => {
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname
      .replace(/^.*\/api\//, '').replace(/^api\//, '').replace(/^\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'POST' && apiPath === 'auth/login') {
      return json({ error: 'Invalid credentials' }, 401);
    }
    return json({ ok: true });
  });

  await page.goto('/#/login');
  await page.locator('#email').fill('wrong@demo.local');
  await page.locator('#password').fill('wrongpassword');
  await page.locator('button[type="submit"]').click();

  await expect(page.getByText('Invalid credentials')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Invalid email or password')).toHaveCount(0);
});

// ── Accept invite: happy path ─────────────────────────────────────────────────

test('accept-invite posts {token, password, display_name} and navigates to /projects/<id>', async ({ page }) => {
  const projectId = 'proj-abc123';
  let postedBody: unknown = null;

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname
      .replace(/^.*\/api\//, '').replace(/^api\//, '').replace(/^\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'POST' && apiPath === 'invitations/accept') {
      postedBody = await req.postDataJSON();
      return json({
        user: { id: 'u-new', email: 'invited@demo.local', role: 'USER', organization_id: 'org-1' },
        project_id: projectId,
      }, 201);
    }
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });

  await page.goto('/#/accept-invite/abc');
  await page.locator('#accept-display-name').fill('Test User');
  await page.locator('#accept-password').fill('securepass1');
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(new RegExp(`#/projects/${projectId}`), { timeout: 10_000 });

  // Verify the posted payload
  expect(postedBody).toMatchObject({ token: 'abc', password: 'securepass1', display_name: 'Test User' });
});

// ── Accept invite: 400 error path ─────────────────────────────────────────────

test('accept-invite shows server error text on 400', async ({ page }) => {
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname
      .replace(/^.*\/api\//, '').replace(/^api\//, '').replace(/^\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'POST' && apiPath === 'invitations/accept') {
      return json({ error: 'Token has expired or already been used' }, 400);
    }
    return json({ ok: true });
  });

  await page.goto('/#/accept-invite/expired-token');
  await page.locator('#accept-display-name').fill('Test User');
  await page.locator('#accept-password').fill('securepass1');
  await page.locator('button[type="submit"]').click();

  await expect(page.locator('[role="alert"]')).toContainText('Token has expired or already been used', { timeout: 10_000 });
});
