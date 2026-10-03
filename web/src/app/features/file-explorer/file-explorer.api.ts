/**
 * File explorer API types + client helpers. Mirrors the backend contract in
 * backend/src/features/file-explorer (GET/POST /api/projects/:id/files, …).
 */
import { ApiClient, MockApiClient, ApiError } from '../../shared/api/api-client';

export interface Breadcrumb { id: string | null; name: string; }
export interface FolderItem { id: string; name: string; parent_id?: string | null; }
export interface FileItem {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  uploaded_by_name?: string | null;
  uploaded_at: string | null;
  version_number: number;
  folder_id?: string | null;
}
export interface FolderListing {
  folder: { id: string | null; name: string; breadcrumbs: Breadcrumb[] };
  folders: FolderItem[];
  files: FileItem[];
}
export interface UploadResult {
  files: Array<{ id: string; name: string; version_number: number; size_bytes: number }>;
  retryable: boolean;
}
export interface FileVersion {
  id: string;
  version_number: number;
  size_bytes: number;
  uploaded_by: string | null;
  uploaded_at: string | null;
}
export interface DownloadLink { url: string; expires_in_seconds: number; retryable: boolean; }

/**
 * Upload with progress. XMLHttpRequest is used (not fetch) because fetch has no
 * upload-progress events. Errors are mapped to ApiError so the caller can read
 * `status` and `body.retryable` exactly like ApiClient errors.
 */
export function uploadWithProgress(
  projectId: string,
  folderId: string | null,
  files: File[],
  onProgress: (pct: number) => void,
): Promise<UploadResult> {
  return new Promise<UploadResult>((resolve, reject) => {
    const form = new FormData();
    for (const f of files) form.append('files', f, f.name);
    if (folderId) form.append('folder_id', folderId);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `api/projects/${encodeURIComponent(projectId)}/files`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: any = null;
      try { body = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { body = null; }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve(body as UploadResult);
      } else {
        const msg = (body && (body.message || body.error)) || `HTTP ${xhr.status}`;
        reject(new ApiError(xhr.status, Array.isArray(msg) ? msg.join(', ') : String(msg), body));
      }
    };
    xhr.onerror = () =>
      reject(new ApiError(503, 'File storage is unreachable. Please try again.', { retryable: true }));
    xhr.send(form);
  });
}

/** Registers in-memory handlers when the app runs against MockApiClient. */
export function registerFileExplorerMocks(api: ApiClient, projectId: string): void {
  if (!(api instanceof MockApiClient)) return;
  const now = new Date().toISOString();
  const listing: FolderListing = {
    folder: { id: null, name: 'Files', breadcrumbs: [{ id: null, name: 'Files' }] },
    folders: [{ id: 'folder-1', name: 'Drawings', parent_id: null }],
    files: [{
      id: 'file-1', name: 'spec.pdf', mime_type: 'application/pdf', size_bytes: 248_000,
      uploaded_by: 'user-1', uploaded_by_name: 'Demo User', uploaded_at: now, version_number: 2,
    }],
  };
  api.registerMock('GET', `/api/projects/${projectId}/files`, async () => listing);
  api.registerMock('POST', `/api/projects/${projectId}/files`, async () => ({ files: [], retryable: false }));
  api.registerMock('POST', `/api/projects/${projectId}/folders`, async (body) => {
    const folder = { id: `folder-${Date.now()}`, name: String((body as any)?.name ?? ''), parent_id: null };
    listing.folders.push(folder);
    return folder;
  });
  api.registerMock('GET', '/api/files/file-1/versions', async () => ({
    items: [
      { id: 'v2', version_number: 2, size_bytes: 248_000, uploaded_by: 'user-1', uploaded_at: now },
      { id: 'v1', version_number: 1, size_bytes: 201_000, uploaded_by: 'user-1', uploaded_at: now },
    ],
  }));
  api.registerMock('GET', '/api/files/file-1/download', async () => ({
    url: 'about:blank', expires_in_seconds: 300, retryable: false,
  }));
}
