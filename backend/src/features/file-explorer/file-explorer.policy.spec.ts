import { ServiceUnconfiguredError } from '../../common/errors/service-unconfigured.error';
import {
  MAX_UPLOAD_BYTES,
  isBlockedType,
  isStorageUnavailableError,
  nextVersionNumber,
  validateName,
  validateUpload,
  validateUploadBatch,
} from './file-explorer.policy';

describe('file-explorer policy', () => {
  describe('validateUpload', () => {
    it('accepts a normal file', () => {
      expect(validateUpload({ name: 'spec.pdf', size: 1024, mimeType: 'application/pdf' })).toBeNull();
    });
    it('accepts a file exactly at the 100 MB cap', () => {
      expect(validateUpload({ name: 'big.bin', size: MAX_UPLOAD_BYTES })).toBeNull();
    });
    it('rejects files over 100 MB', () => {
      expect(validateUpload({ name: 'huge.zip', size: MAX_UPLOAD_BYTES + 1 })).toMatch(/100 MB/);
    });
    it('rejects zero-byte files', () => {
      expect(validateUpload({ name: 'empty.txt', size: 0 })).toMatch(/empty/i);
    });
    it('rejects blocked types by extension and mime', () => {
      expect(validateUpload({ name: 'setup.EXE', size: 10 })).toMatch(/blocked/);
      expect(validateUpload({ name: 'tool', size: 10, mimeType: 'application/x-msdownload' })).toMatch(/blocked/);
    });
    it('rejects an empty file name', () => {
      expect(validateUpload({ name: '  ', size: 10 })).toMatch(/must not be empty/);
    });
  });

  describe('validateUploadBatch', () => {
    it('rejects an empty batch', () => {
      expect(validateUploadBatch([])).toMatch(/No files/);
      expect(validateUploadBatch(undefined)).toMatch(/No files/);
    });
    it('rejects the whole batch when any file is bad', () => {
      expect(validateUploadBatch([{ name: 'a.pdf', size: 1 }, { name: 'b.pdf', size: 0 }])).toMatch(/empty/i);
    });
    it('accepts a valid batch', () => {
      expect(validateUploadBatch([{ name: 'a.pdf', size: 1 }, { name: 'b.png', size: 2 }])).toBeNull();
    });
  });

  describe('validateName', () => {
    it('rejects empty and whitespace names', () => {
      expect(validateName('')).toMatch(/must not be empty/);
      expect(validateName('   ')).toMatch(/must not be empty/);
      expect(validateName(undefined)).toMatch(/must not be empty/);
    });
    it('rejects names with slashes', () => {
      expect(validateName('a/b')).toMatch(/invalid/);
    });
    it('accepts a normal name', () => {
      expect(validateName('Drawings')).toBeNull();
    });
  });

  it('isBlockedType ignores safe types', () => {
    expect(isBlockedType('report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(false);
  });

  it('nextVersionNumber increments the max', () => {
    expect(nextVersionNumber([])).toBe(1);
    expect(nextVersionNumber([1, 3, 2])).toBe(4);
    expect(nextVersionNumber([null, undefined])).toBe(1);
  });

  describe('isStorageUnavailableError', () => {
    it('classifies unconfigured storage and network failures as unavailable', () => {
      expect(isStorageUnavailableError(new ServiceUnconfiguredError('minio'))).toBe(true);
      expect(isStorageUnavailableError(Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }))).toBe(true);
      expect(isStorageUnavailableError(new Error('socket hang up'))).toBe(true);
    });
    it('does not classify ordinary errors as unavailable', () => {
      expect(isStorageUnavailableError(new Error('boom'))).toBe(false);
      expect(isStorageUnavailableError(null)).toBe(false);
    });
  });
});
