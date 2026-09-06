import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  MediaAttachment,
  MediaPurpose,
  MediaTargetType,
} from '../types';
import {
  ApiError,
  completeResumableUpload,
  createMediaAttachment,
  getMediaAttachment,
  getResumableUploadUrls,
  initResumableUpload,
  putToSignedUrl,
  uploadStorageObject,
} from '../services/api';
import { needsResumableUpload, validateMediaFile } from '../lib/mediaLimits';
import { useIsMounted } from './useIsMounted';

/** How many parts are PUT at once on the resumable path. */
const PART_CONCURRENCY = 3;
/** How many presigned URLs to fetch per round trip (the API caps it at 50). */
const URL_BATCH_SIZE = 50;

/** Polling: every 2 s, backing off to 5 s after 30 s, giving up at 5 minutes. */
const POLL_FAST_MS = 2000;
const POLL_SLOW_MS = 5000;
const POLL_BACKOFF_AFTER_MS = 30_000;
const POLL_TIMEOUT_MS = 300_000;

export type UploadPhase =
  | 'validating'
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'failed';

export interface UploadItem {
  /** Client-minted. The server id does not exist until the upload finishes. */
  localId: string;
  file: File;
  /** An object URL, revoked when the item goes away or the hook unmounts. */
  previewUrl: string;
  phase: UploadPhase;
  progress: number;
  storageObjectId?: string;
  attachment?: MediaAttachment;
  error?: string;
}

interface UseMediaUploadOptions {
  purpose: MediaPurpose;
  targetType?: MediaTargetType;
  targetId?: string;
  onAttached?: (attachments: MediaAttachment[]) => void;
}

interface UseMediaUploadResult {
  items: UploadItem[];
  addFiles: (files: File[]) => void;
  remove: (localId: string) => void;
  retry: (localId: string) => void;
}

/**
 * Upload files, attach them, and follow them until the pipeline is done
 * (issue #91, epic #67).
 *
 * Four phases, and each is a thing the user can see:
 *
 *   validating -> uploading -> processing -> ready | failed
 *
 * `validating` is synchronous and local: a `.txt` is refused with no network
 * request at all, because PRD §123 has someone at a squat rack and a
 * round trip to learn that is a round trip wasted.
 *
 * `processing` exists because the server's work is not over when the bytes
 * land: a video has to be sampled into frames before the coach can look at it
 * (#79), and a photo has to be normalized (#87). The hook polls rather than
 * subscribing — an SSE channel for a state that changes twice would be a
 * connection per upload for no benefit.
 */
export function useMediaUpload({
  purpose,
  targetType,
  targetId,
  onAttached,
}: UseMediaUploadOptions): UseMediaUploadResult {
  const [items, setItems] = useState<UploadItem[]>([]);
  const isMounted = useIsMounted();

  // Every object URL this hook has minted, so unmount can revoke them all.
  // Without this a session of ten videos leaks ten blob references for the
  // lifetime of the tab.
  const objectUrls = useRef<string[]>([]);
  const controllers = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    const urls = objectUrls.current;
    const inFlight = controllers.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      inFlight.forEach((controller) => controller.abort());
    };
  }, []);

  const patch = useCallback(
    (localId: string, changes: Partial<UploadItem>) => {
      if (!isMounted()) return;
      setItems((current) =>
        current.map((item) =>
          item.localId === localId ? { ...item, ...changes } : item,
        ),
      );
    },
    [isMounted],
  );

  const run = useCallback(
    async (item: UploadItem) => {
      const controller = new AbortController();
      controllers.current.set(item.localId, controller);

      try {
        patch(item.localId, { phase: 'uploading', progress: 0, error: undefined });

        const object = needsResumableUpload(item.file)
          ? await uploadResumable(item, controller.signal, (progress) =>
              patch(item.localId, { progress }),
            )
          : await uploadStorageObject(item.file, {
              signal: controller.signal,
              onProgress: (loaded, total) =>
                patch(item.localId, {
                  progress: total > 0 ? Math.round((loaded / total) * 100) : 0,
                }),
            });

        patch(item.localId, {
          storageObjectId: object.id,
          progress: 100,
          phase: 'processing',
        });

        const attachment = await createMediaAttachment({
          storageObjectId: object.id,
          purpose,
          targetType,
          targetId,
        });

        const settled = await pollUntilSettled(attachment, isMounted);

        patch(item.localId, {
          attachment: settled,
          phase: settled.processingStatus === 'ready' ? 'ready' : 'failed',
          error:
            settled.processingStatus === 'failed'
              ? (settled.processingError ??
                'That file could not be processed.')
              : undefined,
        });

        if (settled.processingStatus === 'ready') {
          onAttached?.([settled]);
        }
      } catch (error) {
        patch(item.localId, {
          phase: 'failed',
          error: describeUploadError(error),
        });
      } finally {
        controllers.current.delete(item.localId);
      }
    },
    [isMounted, onAttached, patch, purpose, targetId, targetType],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      const next: UploadItem[] = files.map((file) => {
        const validation = validateMediaFile(file);
        const previewUrl = URL.createObjectURL(file);
        objectUrls.current.push(previewUrl);

        return {
          localId:
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random()}`,
          file,
          previewUrl,
          phase: validation.ok ? ('validating' as const) : ('failed' as const),
          progress: 0,
          error: validation.ok ? undefined : validation.reason,
        };
      });

      setItems((current) => [...current, ...next]);
      // Only the valid ones travel. A refused file never touches the network.
      next.filter((item) => item.phase === 'validating').forEach(run);
    },
    [run],
  );

  const remove = useCallback((localId: string) => {
    controllers.current.get(localId)?.abort();
    controllers.current.delete(localId);

    setItems((current) => {
      const item = current.find((candidate) => candidate.localId === localId);
      if (item) {
        URL.revokeObjectURL(item.previewUrl);
        objectUrls.current = objectUrls.current.filter(
          (url) => url !== item.previewUrl,
        );
      }
      return current.filter((candidate) => candidate.localId !== localId);
    });
  }, []);

  const retry = useCallback(
    (localId: string) => {
      setItems((current) => {
        const item = current.find((candidate) => candidate.localId === localId);
        // Re-validate: the failure may have been the file itself, and a retry
        // that skips validation would send it.
        if (item && validateMediaFile(item.file).ok) {
          void run(item);
        }
        return current;
      });
    },
    [run],
  );

  return { items, addFiles, remove, retry };
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

/**
 * The multipart path, for anything over the simple upload's 100 MiB ceiling.
 *
 * Parts are PUT straight to the object store with the presigned URL as the
 * only credential — the bytes never pass through the API — and the URLs are
 * fetched in batches because the init response carries only the first ten
 * (#91's API delta).
 */
async function uploadResumable(
  item: UploadItem,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
) {
  const init = await initResumableUpload({
    name: item.file.name,
    size: item.file.size,
    mimeType: item.file.type || 'application/octet-stream',
  });

  const urls = new Map<number, string>(
    init.presignedUrls.map((entry) => [entry.partNumber, entry.url]),
  );

  const ensureUrl = async (partNumber: number): Promise<string> => {
    const known = urls.get(partNumber);
    if (known) return known;

    const to = Math.min(partNumber + URL_BATCH_SIZE - 1, init.totalParts);
    const batch = await getResumableUploadUrls(init.objectId, partNumber, to);
    batch.presignedUrls.forEach((entry) =>
      urls.set(entry.partNumber, entry.url),
    );

    const fetched = urls.get(partNumber);
    if (!fetched) {
      throw new Error(`No upload URL for part ${partNumber}`);
    }
    return fetched;
  };

  const uploadedBytes = new Map<number, number>();
  const reportProgress = () => {
    const done = [...uploadedBytes.values()].reduce((sum, n) => sum + n, 0);
    onProgress(Math.min(100, Math.round((done / item.file.size) * 100)));
  };

  const parts: Array<{ partNumber: number; eTag: string }> = [];
  const queue = Array.from({ length: init.totalParts }, (_, i) => i + 1);

  // A small worker pool rather than `Promise.all` over every part: a hundred
  // simultaneous PUTs of a 500 MiB video is a way to make a phone's radio give
  // up, and browsers cap connections per host anyway.
  const workers = Array.from(
    { length: Math.min(PART_CONCURRENCY, queue.length) },
    async () => {
      for (;;) {
        const partNumber = queue.shift();
        if (partNumber === undefined) return;

        const start = (partNumber - 1) * init.partSize;
        const chunk = item.file.slice(start, start + init.partSize);
        const url = await ensureUrl(partNumber);

        const eTag = await putToSignedUrl(url, chunk, {
          signal,
          onProgress: (loaded) => {
            uploadedBytes.set(partNumber, loaded);
            reportProgress();
          },
        });

        uploadedBytes.set(partNumber, chunk.size);
        reportProgress();
        parts.push({ partNumber, eTag });
      }
    },
  );

  await Promise.all(workers);

  parts.sort((a, b) => a.partNumber - b.partNumber);
  return completeResumableUpload(init.objectId, parts);
}

/**
 * Poll the attachment until it stops saying `processing`.
 *
 * Bounded at five minutes. Left unbounded, a video the pipeline lost would
 * spin forever and the picker would say "Processing…" for the life of the tab.
 */
async function pollUntilSettled(
  attachment: MediaAttachment,
  isMounted: () => boolean,
): Promise<MediaAttachment> {
  if (attachment.processingStatus !== 'processing') return attachment;

  const startedAt = Date.now();
  let current = attachment;

  while (current.processingStatus === 'processing') {
    const elapsed = Date.now() - startedAt;
    if (elapsed > POLL_TIMEOUT_MS) {
      return {
        ...current,
        processingStatus: 'failed',
        processingError: 'This is taking longer than expected.',
      };
    }

    const wait = elapsed > POLL_BACKOFF_AFTER_MS ? POLL_SLOW_MS : POLL_FAST_MS;
    await new Promise((resolve) => setTimeout(resolve, wait));

    if (!isMounted()) return current;

    current = await getMediaAttachment(current.id);
  }

  return current;
}

/**
 * Turn an upload failure into something a person can act on.
 *
 * 400 and 413 carry the SERVER'S OWN message verbatim: it names the type and
 * the allowed list, or the used and quota bytes, and no client-side paraphrase
 * of those is more useful than the original.
 */
function describeUploadError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 413) {
      return error.message || 'You have used all of your storage.';
    }
    if (error.status === 400) {
      return error.message;
    }
    if (error.status === 0) {
      return 'Upload failed — retry';
    }
    return error.message || 'Upload failed — retry';
  }

  return error instanceof Error ? error.message : 'Upload failed — retry';
}
