/**
 * Active Question Chats API types + MockApiClient fixtures. Mirrors the backend
 * contract in backend/src/features/active-question-chats.
 */
import { ApiClient, ForbiddenError, MockApiClient } from '../../shared/api/api-client';

export type QuestionStatus = 'open' | 'resolved';
export type Side = 'internal' | 'external';

export interface QuestionSummary {
  id: string;
  name: string;
  status: QuestionStatus;
  resolved_sides: string;
  unread_count: number;
}
export interface CreatedQuestion {
  id: string;
  name: string;
  kind: string;
  status: QuestionStatus;
  first_message_id: string;
}
export interface QuestionMessage {
  id: string;
  author_id: string | null;
  body_html: string;
  created_at: string | null;
}
export interface QuestionDetail {
  id: string;
  project_id: string | null;
  name: string;
  kind: string;
  status: QuestionStatus;
  resolved_sides: string;
  my_side: Side;
  messages: QuestionMessage[];
}
export interface ResolveResult { id: string; status: QuestionStatus; resolved_sides: string; }

export function parseSides(text: string | null | undefined): Side[] {
  return (text ?? '').split(',').map((s) => s.trim()).filter((s): s is Side => s === 'internal' || s === 'external');
}

export const questionsApi = {
  list: (api: ApiClient, projectId: string) =>
    api.get<{ items: QuestionSummary[] }>(`/api/projects/${encodeURIComponent(projectId)}/questions`),
  create: (api: ApiClient, projectId: string, title: string, message: string) =>
    api.post<CreatedQuestion>(`/api/projects/${encodeURIComponent(projectId)}/questions`, { title, message }),
  get: (api: ApiClient, id: string) => api.get<QuestionDetail>(`/api/questions/${encodeURIComponent(id)}`),
  postMessage: (api: ApiClient, id: string, body_html: string) =>
    api.post<QuestionMessage>(`/api/questions/${encodeURIComponent(id)}/messages`, { body_html }),
  resolve: (api: ApiClient, id: string) => api.post<ResolveResult>(`/api/questions/${encodeURIComponent(id)}/resolve`),
  unresolve: (api: ApiClient, id: string) => api.delete<ResolveResult>(`/api/questions/${encodeURIComponent(id)}/resolve`),
};

const registered = new Set<string>();

/** Registers in-memory handlers when the app runs against MockApiClient. */
export function registerActiveQuestionMocks(api: ApiClient, projectId: string, questionId?: string): void {
  if (!(api instanceof MockApiClient)) return;
  const mock: MockApiClient = api;
  const now = new Date().toISOString();
  const store = new Map<string, QuestionDetail>();
  const seed = (id: string, name: string) => {
    store.set(id, {
      id, project_id: projectId, name, kind: 'question', status: 'open', resolved_sides: '', my_side: 'internal',
      messages: [{ id: `${id}-m1`, author_id: 'user-1', body_html: '<p>Could you confirm the spec?</p>', created_at: now }],
    });
  };
  seed('q-1', 'Which beam spec applies?');
  if (questionId && !store.has(questionId)) seed(questionId, 'Active question');

  const registerQuestion = (q: QuestionDetail) => {
    const key = `${projectId}:${q.id}`;
    if (registered.has(key)) return;
    registered.add(key);
    mock.registerMock('GET', `/api/questions/${q.id}`, async () => ({ ...q, messages: [...q.messages] }));
    mock.registerMock('POST', `/api/questions/${q.id}/messages`, async (body) => {
      if (q.status === 'resolved') throw new ForbiddenError('This question is resolved; no further messages can be posted.');
      const msg = { id: `${q.id}-m${q.messages.length + 1}`, author_id: 'user-1', body_html: String((body as any)?.body_html ?? ''), created_at: new Date().toISOString() };
      q.messages.push(msg);
      q.resolved_sides = '';
      return msg;
    });
    mock.registerMock('POST', `/api/questions/${q.id}/resolve`, async () => {
      const sides = new Set(parseSides(q.resolved_sides));
      sides.add(q.my_side);
      q.resolved_sides = (['internal', 'external'] as Side[]).filter((s) => sides.has(s)).join(',');
      if (sides.size === 2) q.status = 'resolved';
      return { id: q.id, status: q.status, resolved_sides: q.resolved_sides };
    });
    mock.registerMock('DELETE', `/api/questions/${q.id}/resolve`, async () => {
      if (q.status !== 'resolved') q.resolved_sides = '';
      return { id: q.id, status: q.status, resolved_sides: q.resolved_sides };
    });
  };
  store.forEach(registerQuestion);

  const listKey = `${projectId}:list`;
  if (registered.has(listKey)) return;
  registered.add(listKey);
  mock.registerMock('GET', `/api/projects/${projectId}/questions`, async () => ({
    items: [...store.values()].map((q) => ({
      id: q.id, name: q.name, status: q.status, resolved_sides: q.resolved_sides, unread_count: 0,
    })),
  }));
  mock.registerMock('POST', `/api/projects/${projectId}/questions`, async (body) => {
    const b = (body ?? {}) as { title?: string; message?: string };
    const id = `q-${Date.now()}`;
    const q: QuestionDetail = {
      id, project_id: projectId, name: String(b.title ?? ''), kind: 'question', status: 'open', resolved_sides: '',
      my_side: 'internal',
      messages: [{ id: `${id}-m1`, author_id: 'user-1', body_html: String(b.message ?? ''), created_at: new Date().toISOString() }],
    };
    store.set(id, q);
    registerQuestion(q);
    return { id, name: q.name, kind: 'question', status: 'open', first_message_id: q.messages[0].id };
  });
}
