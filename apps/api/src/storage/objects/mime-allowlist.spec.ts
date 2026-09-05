import {
  disallowedMimeTypeMessage,
  fileTooLargeMessage,
  formatAllowedMimeTypes,
  humanBytes,
  isMimeTypeAllowed,
} from './mime-allowlist';

describe('mime-allowlist', () => {
  const DEFAULTS = ['image/*', 'video/*'];

  describe('isMimeTypeAllowed', () => {
    it('matches an exact type', () => {
      expect(isMimeTypeAllowed('image/jpeg', ['image/jpeg'])).toBe(true);
      expect(isMimeTypeAllowed('image/png', ['image/jpeg'])).toBe(false);
    });

    it('matches a trailing wildcard', () => {
      expect(isMimeTypeAllowed('image/jpeg', DEFAULTS)).toBe(true);
      expect(isMimeTypeAllowed('video/quicktime', DEFAULTS)).toBe(true);
      expect(isMimeTypeAllowed('image/heic', DEFAULTS)).toBe(true);
    });

    it('strips parameters before comparing', () => {
      // Browsers really do send this, and a raw string compare rejects a
      // perfectly good photo.
      expect(isMimeTypeAllowed('image/jpeg; charset=utf-8', DEFAULTS)).toBe(true);
      expect(isMimeTypeAllowed('text/plain; charset=utf-8', DEFAULTS)).toBe(false);
    });

    it('is case-insensitive on both sides', () => {
      expect(isMimeTypeAllowed('IMAGE/JPEG', DEFAULTS)).toBe(true);
      expect(isMimeTypeAllowed('image/jpeg', ['IMAGE/*'])).toBe(true);
    });

    it('denies everything when the pattern list is empty', () => {
      // The safe reading of "no allowed types are configured". An inverted
      // check would make an empty list mean "allow anything".
      expect(isMimeTypeAllowed('image/jpeg', [])).toBe(false);
      expect(isMimeTypeAllowed('image/jpeg', ['', '  '])).toBe(false);
    });

    it('rejects application/pdf under the new default', () => {
      expect(isMimeTypeAllowed('application/pdf', DEFAULTS)).toBe(false);
    });

    it('rejects an empty or malformed type', () => {
      expect(isMimeTypeAllowed('', DEFAULTS)).toBe(false);
      expect(isMimeTypeAllowed('   ', DEFAULTS)).toBe(false);
    });

    it('does not let a wildcard prefix match a longer type name', () => {
      // "image/*" must not match "imagex/jpeg".
      expect(isMimeTypeAllowed('imagex/jpeg', DEFAULTS)).toBe(false);
    });
  });

  describe('messages', () => {
    it('formats the allowlist for a human', () => {
      expect(formatAllowedMimeTypes(DEFAULTS)).toBe('image/*, video/*');
    });

    it('names the type and the allowed list', () => {
      // Byte-identical to apps/web/src/lib/mediaLimits.ts, on purpose: a user
      // who trips this on a phone and one who trips it with curl read the
      // same sentence.
      expect(disallowedMimeTypeMessage('text/plain', DEFAULTS)).toBe(
        'File type "text/plain" is not allowed. Allowed: image/*, video/*',
      );
    });

    it('names the size and the limit', () => {
      expect(fileTooLargeMessage(600000000, 524288000)).toBe(
        'File is 600000000 bytes; the limit is 524288000 bytes (500 MiB)',
      );
    });

    it('renders binary units', () => {
      expect(humanBytes(524288000)).toBe('500 MiB');
      expect(humanBytes(1048576)).toBe('1 MiB');
      expect(humanBytes(1536)).toBe('1.5 KiB');
      expect(humanBytes(512)).toBe('512 B');
    });
  });
});
