/**
 * File explorer — hermetic e2e (static SPA, hash routing, every /api/** call mocked).
 * Covers list/grid, breadcrumbs, search, folder create/rename/delete, upload with
 * progress, versions, download and the 503 → Retry path.
 */
import { test, expect, type Page } from '@playwright/test';

interface State {
  user: { id: string; email: string; role: string } | null;
  folders: Array<{ id: string; name: string; parent_id: string | null }>;
  files: Array<Record<string, unknown> & { id: string; name: string; folder_id: string | null }>;
  storageDown: boolean;
  calls: string[];
}

async function mockApi(page: Page): Promise<State> {
  const now = new Date('2026-09-01T10:00:00Z').toISOString();
  const s: State = {
    user: null,
    folders: [{ id: 'fo1', name: 'Drawings', parent_id: null }],
    files: [{
      id: 'fi1', name: 'spec.pdf', folder_id: null, mime_type: 'application/pdf', size_bytes: 2048,
      uploaded_by: 'u1', uploaded_by_name: 'Demo User', uploaded_at: now, version_number: 2,
    }],
    storageDown: false,
    calls: [],
  };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const url = new URL(req.url());
    const apiPath = url.pathname.replace(/^.*\/api\//, '');
    s.calls.push(`${method} ${apiPath}`);
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'POST' && apiPath === 'auth/login') {
      s.user = { id: 'u1', email: 'user@example.com', role: 'USER' };
      return json(s.user);
    }
    if (method === 'GET' && apiPath === 'users/me') {
      return s.user ? json(s.user) : json({ message: 'Unauthorized' }, 401);
    }
    if (method === 'GET' && apiPath === 'projects/p1/files') {
      const folderId = url.searchParams.get('folder_id');
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const folder = s.folders.find((f) => f.id === folderId) ?? null;
      const match = (n: string) => n.toLowerCase().includes(q);
      return json({
        folder: {
          id: folder?.id ?? null,
          name: folder?.name ?? 'Files',
          breadcrumbs: [{ id: null, name: 'Files' }, ...(folder ? [{ id: folder.id, name: folder.name }] : [])],
        },
        folders: s.folders.filter((f) => (q ? match(f.name) : f.parent_id === (folderId ?? null))),
        files: s.files.filter((f) => (q ? match(f.name) : f.folder_id === (folderId ?? null))),
      });
    }
    if (method === 'POST' && apiPath === 'projects/p1/files') {
      if (s.storageDown) {
        return json({ statusCode: 503, message: 'File storage is temporarily unavailable.', retryable: true }, 503);
      }
      const f = {
        id: `fi${s.files.length + 1}`, name: 'notes.txt', folder_id: null, mime_type: 'text/plain',
        size_bytes: 5, uploaded_by: 'u1', uploaded_by_name: 'Demo User', uploaded_at: now, version_number: 1,
      };
      s.files.push(f);
      return json({ files: [{ id: f.id, name: f.name, version_number: 1, size_bytes: 5 }], retryable: false }, 201);
    }
    if (method === 'POST' && apiPath === 'projects/p1/folders') {
      const body = req.postDataJSON() as { name?: string; parent_id?: string | null };
      if (!body?.name?.trim()) return json({ statusCode: 400, message: 'The folder name must not be empty.' }, 400);
      const f = { id: `fo${s.folders.length + 1}`, name: body.name.trim(), parent_id: body.parent_id ?? null };
      s.folders.push(f);
      return json(f, 201);
    }
    const folderMatch = apiPath.match(/^folders\/([^/]+)$/);
    if (folderMatch) {
      const f = s.folders.find((x) => x.id === folderMatch[1]);
      if (!f) return json({ message: 'Not found' }, 404);
      if (method === 'PATCH') {
        const body = req.postDataJSON() as { name?: string };
        if (body.name) f.name = body.name;
        return json({ id: f.id, name: f.name, parent_id: f.parent_id });
      }
      if (method === 'DELETE') {
        s.folders = s.folders.filter((x) => x.id !== f.id);
        return route.fulfill({ status: 204, body: '' });
      }
    }
    if (method === 'GET' && apiPath === 'files/fi1/versions') {
      return json({
        items: [
          { id: 'v2', version_number: 2, size_bytes: 2048, uploaded_by: 'u1', uploaded_at: now },
          { id: 'v1', version_number: 1, size_bytes: 1024, uploaded_by: 'u1', uploaded_at: now },
        ],
      });
    }
    if (method === 'GET' && apiPath === 'files/fi1/download') {
      return json({ url: 'about:blank', expires_in_seconds: 300, retryable: false });
    }
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
  return s;
}

async function login(page: Page): Promise<void> {
  await page.goto('/#/login');
  await page.locator('#email').fill('user@example.com');
  await page.locator('#password').fill('password1234');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/#\/dashboard/, { timeout: 10_000 });
}

test.use({ serviceWorkers: 'block' });

test('file explorer: browse, views, breadcrumbs, search, manage, upload, versions, download, retry', async ({ page }) => {
  const s = await mockApi(page);
  await login(page);
  await page.goto('/#/projects/p1/files');

  const root = page.getByTestId('file-explorer');
  await expect(root).toBeVisible();
  await expect(root).toContainText('spec.pdf');
  await expect(root).toContainText('Drawings');
  await expect(page.getByTestId('breadcrumbs')).toContainText('Files');
  await expect(page.locator('body')).not.toContainText('Page not found');

  // list / grid toggle
  await expect(page.getByTestId('file-items')).toHaveAttribute('data-view', 'list');
  await page.getByTestId('view-grid').click();
  await expect(page.getByTestId('file-items')).toHaveAttribute('data-view', 'grid');
  await page.getByTestId('view-list').click();
  await expect(page.getByTestId('file-items')).toHaveAttribute('data-view', 'list');

  // open folder → breadcrumbs → back to root
  await page.getByRole('link', { name: /Drawings/ }).click();
  await expect(page).toHaveURL(/#\/projects\/p1\/files\/fo1/);
  await expect(page.getByTestId('breadcrumbs')).toContainText('Drawings');
  await expect(root).not.toContainText('spec.pdf');
  await page.getByTestId('breadcrumbs').getByRole('link', { name: 'Files' }).click();
  await expect(page).toHaveURL(/#\/projects\/p1\/files$/);
  await expect(root).toContainText('spec.pdf');

  // search
  await page.getByTestId('file-search').fill('spec');
  await expect(page.getByTestId('folder-row')).toHaveCount(0);
  await expect(page.getByTestId('file-row')).toHaveCount(1);
  await page.getByTestId('file-search').fill('');
  await expect(page.getByTestId('folder-row')).toHaveCount(1);

  // create, rename, delete folder
  await page.getByTestId('new-folder-name').fill('Contracts');
  await page.getByTestId('create-folder').click();
  await expect(page.getByTestId('folder-row')).toHaveCount(2);
  const contracts = page.getByTestId('folder-row').filter({ hasText: 'Contracts' });
  await contracts.getByTestId('rename-button').click();
  await page.getByTestId('rename-input').fill('Agreements');
  await page.getByTestId('rename-save').click();
  await expect(root).toContainText('Agreements');
  await page.getByTestId('folder-row').filter({ hasText: 'Agreements' }).getByTestId('delete-button').click();
  await expect(page.getByTestId('folder-row')).toHaveCount(1);

  // versions + download
  const specRow = page.getByTestId('file-row').filter({ hasText: 'spec.pdf' });
  await specRow.getByTestId('versions-button').click();
  await expect(page.getByTestId('versions-panel')).toBeVisible();
  await expect(page.getByTestId('version-row')).toHaveCount(2);
  await specRow.getByTestId('download-button').click();
  await expect.poll(() => s.calls.includes('GET files/fi1/download')).toBe(true);

  // storage outage → 503 → Retry succeeds
  s.storageDown = true;
  await page.getByTestId('upload-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByTestId('file-explorer-error')).toContainText('temporarily unavailable');
  await expect(page.getByTestId('retry-button')).toBeVisible();
  await expect(root).not.toContainText('notes.txt');
  s.storageDown = false;
  await page.getByTestId('retry-button').click();
  await expect(page.getByTestId('file-explorer-error')).toHaveCount(0);
  await expect(root).toContainText('notes.txt');
});
