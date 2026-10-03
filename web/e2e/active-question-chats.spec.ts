/**
 * Active Question Chats — hermetic e2e (static SPA, hash routing, every /api/** call mocked).
 * Covers create, messages, resolve / withdraw, the "awaiting the other party" state,
 * two-sided resolution and the 403 on posts into a resolved question.
 */
import { test, expect, type Page } from '@playwright/test';

interface Q {
  id: string;
  name: string;
  status: 'open' | 'resolved';
  sides: Set<'internal' | 'external'>;
  messages: Array<{ id: string; author_id: string; body_html: string; created_at: string }>;
}
interface State {
  user: { id: string; email: string; role: string } | null;
  side: 'internal' | 'external';
  questions: Q[];
}

const joinSides = (s: Set<string>) => ['internal', 'external'].filter((x) => s.has(x)).join(',');

async function mockApi(page: Page): Promise<State> {
  const now = new Date('2026-09-01T10:00:00Z').toISOString();
  const s: State = {
    user: null,
    side: 'internal',
    questions: [{
      id: 'q-1', name: 'Which beam spec?', status: 'open', sides: new Set(),
      messages: [{ id: 'm1', author_id: 'u1', body_html: '<p>Please confirm the beam spec</p>', created_at: now }],
    }],
  };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const url = new URL(req.url());
    const apiPath = url.pathname.replace(/^.*\/api\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const body = () => { try { return req.postDataJSON() ?? {}; } catch { return {}; } };

    if (method === 'POST' && apiPath === 'auth/login') {
      s.user = { id: 'u1', email: 'user@example.com', role: 'USER' };
      return json(s.user);
    }
    if (method === 'GET' && apiPath === 'users/me') {
      return s.user ? json(s.user) : json({ message: 'Unauthorized' }, 401);
    }
    if (apiPath === 'projects/p-1/questions') {
      if (method === 'GET') {
        return json({
          items: s.questions.map((q) => ({
            id: q.id, name: q.name, status: q.status, resolved_sides: joinSides(q.sides), unread_count: 0,
          })),
        });
      }
      if (method === 'POST') {
        const b = body();
        if (!String(b.title ?? '').trim() || !String(b.message ?? '').trim()) {
          return json({ message: ['Title is required.'] }, 400);
        }
        const q: Q = {
          id: `q-${s.questions.length + 1}`, name: String(b.title), status: 'open', sides: new Set(),
          messages: [{ id: `m-${Date.now()}`, author_id: 'u1', body_html: String(b.message), created_at: now }],
        };
        s.questions.push(q);
        return json({ id: q.id, name: q.name, kind: 'question', status: 'open', first_message_id: q.messages[0].id }, 201);
      }
    }
    const m = /^questions\/([^/]+)(\/messages|\/resolve)?$/.exec(apiPath);
    const q = m ? s.questions.find((x) => x.id === m[1]) : undefined;
    if (m && !q) return json({ message: 'Question not found.' }, 404);
    if (m && q) {
      const sub = m[2] ?? '';
      if (sub === '' && method === 'GET') {
        return json({
          id: q.id, project_id: 'p-1', name: q.name, kind: 'question', status: q.status,
          resolved_sides: joinSides(q.sides), my_side: s.side, messages: q.messages,
        });
      }
      if (sub === '/messages' && method === 'POST') {
        if (q.status === 'resolved') return json({ message: 'This question is resolved.' }, 403);
        const msg = { id: `m-${Date.now()}`, author_id: 'u1', body_html: String(body().body_html ?? ''), created_at: now };
        q.messages.push(msg);
        q.sides.clear();
        return json(msg, 201);
      }
      if (sub === '/resolve' && method === 'POST') {
        q.sides.add(s.side);
        if (q.sides.size === 2) q.status = 'resolved';
        return json({ id: q.id, status: q.status, resolved_sides: joinSides(q.sides) });
      }
      if (sub === '/resolve' && method === 'DELETE') {
        q.sides.clear();
        return json({ id: q.id, status: q.status, resolved_sides: '' });
      }
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

test('active question: create, message, resolve/withdraw, awaiting, both sides resolve, 403 after', async ({ page }) => {
  const s = await mockApi(page);
  await login(page);

  // Existing question page renders with a known status badge and resolve control.
  await page.goto('/#/projects/p-1/questions/q-1');
  await expect(page.getByTestId('aq-question-page')).toBeVisible();
  await expect(page.getByTestId('aq-status')).toHaveText(/open/i);
  await expect(page.getByTestId('aq-resolve-toggle')).toBeVisible();
  await expect(page.getByText('Please confirm the beam spec')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('No mock registered');

  // Create a new question from the list page.
  await page.goto('/#/projects/p-1/questions');
  await expect(page.getByTestId('aq-item')).toHaveCount(1);
  await page.getByTestId('aq-title').fill('Door finish');
  await page.getByTestId('aq-first-message').fill('Matte or gloss?');
  await page.getByTestId('aq-create').click();
  await expect(page).toHaveURL(/#\/projects\/p-1\/questions\/q-2/);
  await expect(page.getByTestId('aq-title-text')).toHaveText('Door finish');
  await expect(page.getByText('Matte or gloss?')).toBeVisible();

  // Post a message.
  await page.getByTestId('aq-composer').fill('Gloss please');
  await page.getByTestId('aq-send').click();
  await expect(page.getByTestId('aq-message')).toHaveCount(2);

  // Internal side marks resolved → still open, awaiting the other party.
  await page.getByTestId('aq-resolve-toggle').click();
  await expect(page.getByTestId('aq-status')).toHaveText(/open/i);
  await expect(page.getByTestId('aq-awaiting')).toHaveText("awaiting the other party's resolution");

  // Withdraw → mark cleared, still open.
  await page.getByTestId('aq-resolve-toggle').click();
  await expect(page.getByTestId('aq-awaiting')).toHaveCount(0);
  await expect(page.getByTestId('aq-status')).toHaveText(/open/i);

  // Mark again, then the external party confirms.
  await page.getByTestId('aq-resolve-toggle').click();
  await expect(page.getByTestId('aq-awaiting')).toBeVisible();
  s.side = 'external';
  await page.reload();
  await expect(page.getByTestId('aq-awaiting')).toHaveCount(0);
  await page.getByTestId('aq-resolve-toggle').click();
  await expect(page.getByTestId('aq-status')).toHaveText(/resolved/i);
  await expect(page.getByTestId('aq-closed')).toBeVisible();

  // Further posts are rejected with 403.
  const status = await page.evaluate(async () => {
    const r = await fetch('/api/questions/q-2/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body_html: 'late' }),
    });
    return r.status;
  });
  expect(status).toBe(403);
});
