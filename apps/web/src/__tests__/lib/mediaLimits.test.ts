import { describe, it, expect } from 'vitest';

import {
  MAX_FILE_BYTES,
  SIMPLE_UPLOAD_MAX_BYTES,
  humanBytes,
  needsResumableUpload,
  validateMediaFile,
} from '../../lib/mediaLimits';

/** A `File` of a given type and size without allocating the bytes. */
function fakeFile(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('validateMediaFile', () => {
  it('accepts the formats phones actually produce', () => {
    expect(validateMediaFile(fakeFile('a.heic', 'image/heic', 1000)).ok).toBe(true);
    expect(
      validateMediaFile(fakeFile('a.mov', 'video/quicktime', 1000)).ok,
    ).toBe(true);
    expect(validateMediaFile(fakeFile('a.jpg', 'image/jpeg', 1000)).ok).toBe(true);
  });

  it('rejects a document with the server’s exact message', () => {
    // Byte-identical to `disallowedMimeTypeMessage` in the API. A user who
    // trips this on a phone and one who trips it with curl read the same
    // sentence.
    const result = validateMediaFile(fakeFile('note.txt', 'text/plain', 10));

    expect(result).toEqual({
      ok: false,
      reason:
        'File type "text/plain" is not allowed. Allowed: image/*, video/*',
    });
  });

  it('rejects a PDF, which the server dropped from the allowlist', () => {
    expect(validateMediaFile(fakeFile('a.pdf', 'application/pdf', 10)).ok).toBe(
      false,
    );
  });

  it('strips parameters before comparing', () => {
    expect(
      validateMediaFile(fakeFile('a.jpg', 'image/jpeg; charset=utf-8', 10)).ok,
    ).toBe(true);
  });

  it('passes an EMPTY type through rather than refusing it', () => {
    // Older Safari reports no type for HEIC — the format this product cares
    // most about. The server sees the real multipart content type; refusing
    // locally would reject iPhone photos on the strength of a browser quirk.
    expect(validateMediaFile(fakeFile('IMG_0001.HEIC', '', 1000)).ok).toBe(true);
  });

  it('rejects a file over the size limit, naming both numbers', () => {
    const result = validateMediaFile(
      fakeFile('big.mp4', 'video/mp4', MAX_FILE_BYTES + 1),
    );

    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toBe(
      `File is ${MAX_FILE_BYTES + 1} bytes; the limit is ${MAX_FILE_BYTES} bytes (500 MiB)`,
    );
  });

  it('accepts a file exactly at the limit', () => {
    expect(
      validateMediaFile(fakeFile('big.mp4', 'video/mp4', MAX_FILE_BYTES)).ok,
    ).toBe(true);
  });
});

describe('needsResumableUpload', () => {
  it('routes anything over the multipart ceiling to the resumable path', () => {
    expect(
      needsResumableUpload(
        fakeFile('a.mp4', 'video/mp4', SIMPLE_UPLOAD_MAX_BYTES + 1),
      ),
    ).toBe(true);
    expect(
      needsResumableUpload(
        fakeFile('a.mp4', 'video/mp4', SIMPLE_UPLOAD_MAX_BYTES),
      ),
    ).toBe(false);
  });
});

describe('humanBytes', () => {
  it('renders binary units, matching the server', () => {
    expect(humanBytes(524288000)).toBe('500 MiB');
    expect(humanBytes(1048576)).toBe('1 MiB');
    expect(humanBytes(1536)).toBe('1.5 KiB');
  });
});
