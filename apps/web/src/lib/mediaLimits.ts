/**
 * The upload limits, mirrored client-side (issue #91, epic #67).
 *
 * THE SERVER REMAINS AUTHORITATIVE. These constants mirror the defaults of
 * `ALLOWED_MIME_TYPES` and `MAX_FILE_SIZE` in `apps/api/src/config/
 * configuration.ts`, and the messages are byte-identical to the ones
 * `apps/api/src/storage/objects/mime-allowlist.ts` produces — so a user who
 * trips the check on a phone and one who trips it with curl read the same
 * sentence.
 *
 * Mirroring rather than fetching: PRD §123 is mobile-first, and a person at a
 * squat rack should learn that a `.txt` is not a video before four hundred
 * megabytes leave their phone. An operator who narrows the server's allowlist
 * makes this list stale in the SAFE direction — the client accepts something
 * the server then refuses, with the server's own message.
 */

export const ACCEPTED_MIME_PREFIXES = ['image/', 'video/'] as const;

/** The `accept` attribute for every file input in the media flow. */
export const ACCEPT_ATTRIBUTE = 'image/*,video/*';

/** 500 MiB. Mirrors MAX_FILE_SIZE. */
export const MAX_FILE_BYTES = 524288000;

/**
 * 100 MiB — the Fastify multipart ceiling on the simple path. Above it the
 * upload has to go through the resumable route, which is a different code path
 * rather than a bigger request.
 */
export const SIMPLE_UPLOAD_MAX_BYTES = 104857600;

/** Matches the server's `formatAllowedMimeTypes(['image/*','video/*'])`. */
const ALLOWED_DESCRIPTION = 'image/*, video/*';

export type MediaFileValidation =
  | { ok: true }
  | { ok: false; reason: string };

/** `524288000` → `"500 MiB"`. Same rendering as the server's `humanBytes`. */
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

/**
 * Is this file one the server would accept?
 *
 * A browser sometimes reports an EMPTY `file.type` — most often for HEIC on
 * older Safari, which is exactly the format this product cares most about. An
 * empty type is passed through to the server rather than refused here: the
 * server sees the real multipart content type, and refusing locally would
 * reject iPhone photos on the strength of a browser quirk.
 */
export function validateMediaFile(file: File): MediaFileValidation {
  const mimeType = file.type.split(';')[0]!.trim().toLowerCase();

  if (
    mimeType &&
    !ACCEPTED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))
  ) {
    return {
      ok: false,
      reason: `File type "${mimeType}" is not allowed. Allowed: ${ALLOWED_DESCRIPTION}`,
    };
  }

  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      reason: `File is ${file.size} bytes; the limit is ${MAX_FILE_BYTES} bytes (${humanBytes(MAX_FILE_BYTES)})`,
    };
  }

  return { ok: true };
}

/** Does this file need the resumable path? */
export function needsResumableUpload(file: File): boolean {
  return file.size > SIMPLE_UPLOAD_MAX_BYTES;
}
