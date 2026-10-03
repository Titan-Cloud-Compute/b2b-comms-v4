/**
 * Message Reference and Annotation — API types, client helpers and MockApiClient fixtures.
 * Mirrors backend/src/features/message-reference-and-annotation.
 */
import { ApiClient, BadRequestError, ForbiddenError, MockApiClient, NotFoundError } from '../../shared/api/api-client';

export const UNSUPPORTED_FILE_MESSAGE = 'Only PDF and image files can be referenced';
export const FILE_UNAVAILABLE_MESSAGE = 'This file is no longer available';
export const MAX_ANNOTATION_BYTES = 1024 * 1024;

/** Coordinates are normalised to the page (0..1). */
export interface TextBox { x: number; y: number; width?: number; height?: number; text: string; color?: string; }
export interface Drawing { points: Array<[number, number]>; color?: string; width?: number; }
export interface Annotations { text_boxes: TextBox[]; drawings: Drawing[]; }

export interface Reference {
  id: string;
  message_id: string;
  file_version_id: string;
  page_number: number;
  annotations: Annotations;
  author_id: string;
  updated_at?: string | null;
}
export interface ReferenceView extends Reference {
  file_available: boolean;
  can_edit: boolean;
  file_name?: string | null;
  mime_type?: string | null;
}
export interface ReferenceUpdate { id: string; page_number: number; annotations: Annotations; updated_at: string; }
export interface MessageReferenceSummary { id: string; message_id: string; author_id: string | null; }

export interface PickerFile { id: string; name: string; mime_type: string; }

export type ReferenceKind = 'pdf' | 'image';

export function referenceKind(mime: string | null | undefined, name?: string | null): ReferenceKind | null {
  const m = (mime ?? '').toLowerCase().split(';')[0].trim();
  const n = (name ?? '').toLowerCase();
  if (m === 'application/pdf') return 'pdf';
  if (['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp'].includes(m)) return 'image';
  if (!m || m === 'application/octet-stream') {
    if (n.endsWith('.pdf')) return 'pdf';
    if (/\.(png|jpe?g|gif|webp|bmp)$/.test(n)) return 'image';
  }
  return null;
}

export function isEmptyAnnotations(a: Annotations): boolean {
  return a.text_boxes.length === 0 && a.drawings.length === 0;
}

export function pageImageUrl(fileVersionId: string, page: number): string {
  return `/api/file-versions/${encodeURIComponent(fileVersionId)}/pages/${page}`;
}

export const referencesApi = {
  create: (api: ApiClient, messageId: string, body: { file_id?: string; file_version_id?: string; page_number: number; annotations: Annotations }) =>
    api.post<Reference>(`/api/messages/${encodeURIComponent(messageId)}/reference`, body),
  get: (api: ApiClient, id: string) => api.get<ReferenceView>(`/api/references/${encodeURIComponent(id)}`),
  update: (api: ApiClient, id: string, body: { page_number?: number; annotations: Annotations }) =>
    api.request<ReferenceUpdate>(`/api/references/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  remove: (api: ApiClient, id: string) => api.delete<void>(`/api/references/${encodeURIComponent(id)}`),
  forMessages: (api: ApiClient, messageIds: string[]) =>
    api.get<{ items: MessageReferenceSummary[] }>('/api/references', { message_ids: messageIds.join(',') }),
  projectFiles: async (api: ApiClient, projectId: string): Promise<PickerFile[]> => {
    const res = await api.get<{ files?: PickerFile[] }>(`/api/projects/${encodeURIComponent(projectId)}/files`);
    return Array.isArray(res?.files) ? res.files : [];
  },
  /** Newest version id of a file (file-explorer endpoint) so the editor can preview the page. */
  latestVersionId: async (api: ApiClient, fileId: string): Promise<string | null> => {
    const res = await api.get<unknown>(`/api/files/${encodeURIComponent(fileId)}/versions`);
    const r = res as { versions?: unknown; items?: unknown } | unknown[];
    const list = (Array.isArray(r) ? r : Array.isArray((r as any)?.versions) ? (r as any).versions : (r as any)?.items) as
      Array<{ id: string; version_number?: number }> | undefined;
    if (!Array.isArray(list) || !list.length) return null;
    return [...list].sort((a, b) => (b.version_number ?? 0) - (a.version_number ?? 0))[0].id;
  },
};

// ─── MockApiClient fixtures ──────────────────────────────────────────────────

const registered = new Set<string>();
const mockRefs = new Map<string, ReferenceView>();

function validate(a: unknown): Annotations {
  const ann = a as Annotations;
  if (!ann || typeof ann !== 'object' || !Array.isArray(ann.text_boxes ?? []) || !Array.isArray(ann.drawings ?? [])) {
    throw new BadRequestError('annotations must be an object with text_boxes and drawings.');
  }
  if (JSON.stringify(ann).length > MAX_ANNOTATION_BYTES) throw new BadRequestError('annotations exceed the 1 MB limit.');
  const norm = { text_boxes: ann.text_boxes ?? [], drawings: ann.drawings ?? [] };
  if (isEmptyAnnotations(norm)) throw new BadRequestError('Add at least one text box or drawing before saving.');
  return norm;
}

function registerRef(mock: MockApiClient, ref: ReferenceView): void {
  mockRefs.set(ref.id, ref);
  if (registered.has(`ref:${ref.id}`)) return;
  registered.add(`ref:${ref.id}`);
  mock.registerMock('GET', `/api/references/${ref.id}`, async () => {
    const r = mockRefs.get(ref.id);
    if (!r) throw new NotFoundError('Reference not found.');
    return { ...r };
  });
  mock.registerMock('PUT', `/api/references/${ref.id}`, async (body) => {
    const r = mockRefs.get(ref.id);
    if (!r) throw new NotFoundError('Reference not found.');
    if (!r.can_edit) throw new ForbiddenError('Only the author can edit this reference.');
    const b = (body ?? {}) as { annotations?: unknown; page_number?: number };
    r.annotations = validate(b.annotations);
    if (typeof b.page_number === 'number') r.page_number = b.page_number;
    r.updated_at = new Date().toISOString();
    return { id: r.id, page_number: r.page_number, annotations: r.annotations, updated_at: r.updated_at };
  });
  mock.registerMock('DELETE', `/api/references/${ref.id}`, async () => {
    const r = mockRefs.get(ref.id);
    if (!r?.can_edit) throw new ForbiddenError('Only the author can delete this reference.');
    mockRefs.delete(ref.id);
    return undefined;
  });
}

/** Registers in-memory handlers when the app runs against MockApiClient (USE_MOCKS). */
export function registerReferenceMocks(api: ApiClient, projectId: string, referenceId?: string, messageIds: string[] = []): void {
  if (!(api instanceof MockApiClient)) return;
  const mock: MockApiClient = api;
  const demoId = referenceId || 'demo-reference';
  if (!mockRefs.has(demoId)) {
    registerRef(mock, {
      id: demoId, message_id: 'demo-message', file_version_id: 'demo-version', page_number: 1,
      annotations: {
        text_boxes: [{ x: 0.1, y: 0.1, width: 0.3, text: 'Check this dimension' }],
        drawings: [{ points: [[0.2, 0.3], [0.4, 0.35], [0.6, 0.3]], color: '#d32f2f', width: 3 }],
      },
      author_id: 'someone-else', updated_at: new Date().toISOString(),
      file_available: true, can_edit: false, file_name: 'spec.pdf', mime_type: 'application/pdf',
    });
  }
  mock.registerMock('GET', '/api/references', async () => ({
    items: [...mockRefs.values()]
      .filter((r) => messageIds.length === 0 || messageIds.includes(r.message_id))
      .map((r) => ({ id: r.id, message_id: r.message_id, author_id: r.author_id })),
  }));
  for (const messageId of messageIds) {
    const key = `msg:${messageId}`;
    if (registered.has(key)) continue;
    registered.add(key);
    mock.registerMock('POST', `/api/messages/${messageId}/reference`, async (body) => {
      const b = (body ?? {}) as { file_id?: string; file_version_id?: string; page_number?: number; annotations?: unknown };
      const annotations = validate(b.annotations);
      const id = `ref-${Date.now()}`;
      const ref: ReferenceView = {
        id, message_id: messageId, file_version_id: b.file_version_id ?? `${b.file_id ?? 'file'}-v1`,
        page_number: b.page_number ?? 1, annotations, author_id: 'user-1', updated_at: new Date().toISOString(),
        file_available: true, can_edit: true,
      };
      registerRef(mock, ref);
      return ref;
    });
  }
  const filesKey = `files:${projectId}`;
  if (!registered.has(filesKey)) {
    registered.add(filesKey);
    // Only register when no other feature already provides the listing.
    mock.request(`/api/projects/${projectId}/files`).catch(() => {
      mock.registerMock('GET', `/api/projects/${projectId}/files`, async () => ({
        folder: { id: null, name: 'Files', breadcrumbs: [] },
        folders: [],
        files: [
          { id: 'file-1', name: 'spec.pdf', mime_type: 'application/pdf' },
          { id: 'file-2', name: 'site-photo.jpg', mime_type: 'image/jpeg' },
          { id: 'file-3', name: 'notes.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        ],
      }));
    });
  }
}
