/**
 * MIME allowlist matching for uploads (issue #71, epic #67).
 *
 * `storage.allowedMimeTypes` has existed in configuration since the storage
 * module was written and was read by nobody; this module is the thing that
 * reads it. It is pure and dependency-free so the same rule can be asserted in
 * a millisecond-scale spec and quoted verbatim in the client-side mirror
 * (`apps/web/src/lib/mediaLimits.ts`) — the server stays authoritative, but a
 * user at a squat rack should learn a `.txt` is not a video before the bytes
 * leave the phone.
 *
 * The grammar is deliberately small: an exact type, or one trailing `/*`
 * wildcard. Anything richer (parameters, `*​/*`, suffix matching on `+json`)
 * would be a pattern language nobody asked for, in a security check.
 */

/**
 * Normalize a MIME type for comparison: lowercase, parameters stripped.
 *
 * Browsers send `text/plain; charset=utf-8` and iOS sends `image/jpeg` with a
 * trailing space often enough that comparing raw strings rejects real photos.
 */
function normalize(mimeType: string): string {
  return mimeType.split(';')[0]!.trim().toLowerCase();
}

/**
 * Is `mimeType` matched by any of `patterns`?
 *
 * An empty pattern list denies everything. That is the safe reading of "the
 * administrator configured no allowed types", and it is the opposite of what a
 * naive `.some()` over an empty array would do if the check were inverted.
 */
export function isMimeTypeAllowed(
  mimeType: string,
  patterns: readonly string[],
): boolean {
  const value = normalize(mimeType);
  if (!value) return false;

  return patterns.some((rawPattern) => {
    const pattern = normalize(rawPattern);
    if (!pattern) return false;

    if (pattern.endsWith('/*')) {
      return value.startsWith(pattern.slice(0, -1));
    }

    return value === pattern;
  });
}

/**
 * Render the allowlist for a user-facing error message: `"image/*, video/*"`.
 *
 * The exact string appears in the 400 body and is mirrored byte-for-byte by
 * the web client, so a user who trips the check on the phone and a user who
 * trips it with curl read the same sentence.
 */
export function formatAllowedMimeTypes(patterns: readonly string[]): string {
  return patterns
    .map((pattern) => normalize(pattern))
    .filter(Boolean)
    .join(', ');
}

/** The 400 body for a disallowed type. One place, so client and server agree. */
export function disallowedMimeTypeMessage(
  mimeType: string,
  patterns: readonly string[],
): string {
  return `File type "${normalize(mimeType)}" is not allowed. Allowed: ${formatAllowedMimeTypes(patterns)}`;
}

/** The 400 body for an oversize upload. */
export function fileTooLargeMessage(size: number | bigint, limit: number): string {
  return `File is ${size} bytes; the limit is ${limit} bytes (${humanBytes(limit)})`;
}

/** `524288000` → `"500 MiB"`. Binary units, because the limits are powers of two. */
export function humanBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${rounded} ${units[unit]}`;
}
