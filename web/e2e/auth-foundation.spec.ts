/**
 * Auth foundation (full_auth): the signed-in shell is guarded, and USER,
 * MANAGER and ADMIN each sign in with their own role. Hermetic — every /api/**
 * call is mocked here, nothing reaches the network.
 */
import { test, expect, type Page } from '@playwright/test';

type Role = 'USER' | 'MANAGER' | 'ADMIN';

async function mockApi(page: Page, role: Role): Promise<void> {
  let signedIn = false;
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname
      .replace(/^.*\/api\//, '').replace(/^api\//, '').replace(/^\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const user = { id: `u-${role}`, email: `${role.toLowerCase()}@demo.local`, role };

    if (method === 'POST' && apiPath === 'auth/login') {
      signedIn = true;
      return json({ user: { ...user, display_name: user.email.split('@')[0], organization_id: 'org-1' }, landing: '/projects' });
    }
    if (method === 'GET' && apiPath === 'users/me') {
      return signedIn ? json(user) : json({ message: 'Unauthorized' }, 401);
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

async function storedRole(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (key === 'user' || key.endsWith(':user') || key.endsWith('.user')) {
        try {
          return (JSON.parse(localStorage.getItem(key)!) as { role?: string }).role ?? null;
        } catch {
          return null;
        }
      }
    }
    return null;
  });
}

test.use({ serviceWorkers: 'block' });

test('signed-out visit to a shell route is redirected to /login without rendering the shell', async ({ page }) => {
  await mockApi(page, 'USER');
  for (const r of ['dashboard', 'settings', 'admin/users']) {
    await page.goto(`/#/${r}`);
    await expect(page).toHaveURL(/#\/login/, { timeout: 10_000 });
    await expect(page.locator('app-login')).toHaveCount(1);
    await expect(page.locator('app-layout')).toHaveCount(0);
  }
});

test('USER signs in with the USER role and lands in the shell', async ({ page }) => {
  await mockApi(page, 'USER');
  await signIn(page, 'USER');
  await expect(page).toHaveURL(/#\/projects/, { timeout: 10_000 });
  await expect(page.locator('app-layout')).toHaveCount(1);
  expect(await storedRole(page)).toBe('USER');
});

test('MANAGER signs in with the MANAGER role (not downgraded to USER)', async ({ page }) => {
  await mockApi(page, 'MANAGER');
  await signIn(page, 'MANAGER');
  await expect(page).toHaveURL(/#\/projects/, { timeout: 10_000 });
  await expect(page.locator('app-layout')).toHaveCount(1);
  expect(await storedRole(page)).toBe('MANAGER');
});

test('ADMIN signs in with the ADMIN role and lands on projects', async ({ page }) => {
  await mockApi(page, 'ADMIN');
  await signIn(page, 'ADMIN');
  await expect(page).toHaveURL(/#\/projects/, { timeout: 10_000 });
  await expect(page.locator('app-layout')).toHaveCount(1);
  expect(await storedRole(page)).toBe('ADMIN');
});
