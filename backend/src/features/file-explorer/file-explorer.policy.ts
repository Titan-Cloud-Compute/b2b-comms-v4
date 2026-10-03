/**
 * Pure upload / naming policy for the file explorer. No Nest, no Prisma —
 * everything here is deterministic and unit-tested in file-explorer.policy.spec.ts.
 */
import { ServiceUnconfiguredError } from '../../common/errors/service-unconfigured.error';

/** 100 MB hard cap per uploaded file. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Presigned download URLs expire after this many seconds. */
export const DOWNLOAD_URL_TTL_SECONDS = 300;

/** Executable / script types that may never be uploaded. */
export const BLOCKED_EXTENSIONS: readonly string[] = [
  'exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'pif', 'cpl', 'dll', 'sys',
  'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'ps1', 'psm1', 'sh', 'jar', 'apk', 'app', 'dmg',
];

export const BLOCKED_MIME_TYPES: readonly string[] = [
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-dosexec',
  'application/x-executable',
  'application/x-sh',
  'application/x-bat',
  'application/vnd.microsoft.portable-executable',
  'application/java-archive',
  'application/vnd.android.package-archive',
];

export const MAX_NAME_LENGTH = 255;

export interface UploadCandidate {
  name: string | null | undefined;
  size: number | null | undefined;
  mimeType?: string | null;
}

export function fileExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 && idx < name.length - 1 ? name.slice(idx + 1).toLowerCase() : '';
}

/** Returns a human-readable error for an invalid file/folder name, or null when valid. */
export function validateName(name: unknown, kind: 'file' | 'folder' = 'folder'): string | null {
  if (typeof name !== 'string' || name.trim().length === 0) {
    return `The ${kind} name must not be empty.`;
  }
  const trimmed = name.trim();
  if (trimmed.length > MAX_NAME_LENGTH) {
    return `The ${kind} name must be at most ${MAX_NAME_LENGTH} characters.`;
  }
  if (/[\\/\u0000]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
    return `The ${kind} name contains invalid characters.`;
  }
  return null;
}

export function isBlockedType(name: string, mimeType?: string | null): boolean {
  if (BLOCKED_EXTENSIONS.includes(fileExtension(name))) return true;
  const mime = (mimeType ?? '').toLowerCase().split(';')[0].trim();
  return mime.length > 0 && BLOCKED_MIME_TYPES.includes(mime);
}

/** Returns a human-readable error for an upload that must be rejected with 400, or null. */
export function validateUpload(file: UploadCandidate): string | null {
  const nameErr = validateName(file.name, 'file');
  if (nameErr) return nameErr;
  const name = (file.name as string).trim();
  const size = Number(file.size ?? 0);
  if (!Number.isFinite(size) || size <= 0) {
    return `"${name}" is empty. Zero-byte files cannot be uploaded.`;
  }
  if (size > MAX_UPLOAD_BYTES) {
    return `"${name}" exceeds the 100 MB upload limit.`;
  }
  if (isBlockedType(name, file.mimeType)) {
    return `"${name}" is a blocked file type.`;
  }
  return null;
}

/** Validates a whole batch; returns the first error or null. An empty batch is an error. */
export function validateUploadBatch(files: UploadCandidate[] | null | undefined): string | null {
  if (!files || files.length === 0) return 'No files were provided.';
  for (const f of files) {
    const err = validateUpload(f);
    if (err) return err;
  }
  return null;
}

/** Next version number given the existing versions' numbers. */
export function nextVersionNumber(existing: Array<number | null | undefined>): number {
  let max = 0;
  for (const n of existing) if (typeof n === 'number' && n > max) max = n;
  return max + 1;
}

const STORAGE_ERROR_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH',
  'ENETUNREACH', 'EPIPE', 'SlowDown', 'ServiceUnavailable', 'InternalError', 'RequestTimeout',
]);

/**
 * True when an error from the object-storage client means "storage is unavailable,
 * try again later" (→ 503 retryable) rather than a programming error.
 */
export function isStorageUnavailableError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof ServiceUnconfiguredError) return true;
  const e = err as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
  if (typeof e.code === 'string' && STORAGE_ERROR_CODES.has(e.code)) return true;
  if (e.name === 'ServiceUnconfiguredError') return true;
  if (typeof e.message === 'string' && /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up|service unavailable/i.test(e.message)) {
    return true;
  }
  if (e.cause && e.cause !== err) return isStorageUnavailableError(e.cause);
  return false;
}
