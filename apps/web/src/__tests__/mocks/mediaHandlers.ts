import { http, HttpResponse } from 'msw';

import type { MediaAttachment, StorageObject } from '../../types';

// =============================================================================
// A stateful in-memory storage + media API (issue #91, epic #67)
// =============================================================================
//
// STATEFUL, and it enforces what the real API enforces. Two rules matter here
// because a mock that skipped them would let component tests pass against
// behaviour the server refuses:
//
//   * A SIMPLE UPLOAD LANDS AS `processing`, NOT `ready`. Normalization (#87)
//     and frame sampling (#79) run after the bytes arrive, and the picker's
//     entire "Processing…" phase exists because of that gap. A mock that
//     answered `ready` immediately would delete the phase from every test.
//   * `GET /media/attachments/:id` FLIPS TO `ready` ON THE SECOND POLL, so the
//     polling loop is genuinely exercised rather than short-circuited.
//
// `resetMediaMocks()` runs from the global `afterEach`.
// =============================================================================

const API_BASE = '*/api';

/** What `POST /:id/ask` answers. Overridable per test. */
interface AskOutcome {
  status?: number;
  body?: unknown;
}

interface MediaState {
  objects: Map<string, StorageObject>;
  attachments: Map<string, MediaAttachment>;
  /** How many times each attachment has been polled. */
  polls: Map<string, number>;
  quotaRemaining: string | null;
  /** Set by a test to make the next upload fail with this status. */
  nextUploadFailure: { status: number; message: string } | null;
  /** Set by a test to control the next ask. */
  askOutcome: AskOutcome | null;
  /** Every question `POST /:id/ask` was sent, so a test can assert the wire. */
  askQuestions: Array<string | undefined>;
}

const state: MediaState = {
  objects: new Map(),
  attachments: new Map(),
  polls: new Map(),
  quotaRemaining: '2146435072',
  nextUploadFailure: null,
  askOutcome: null,
  askQuestions: [],
};

export const DEFAULT_ADVICE = {
  summary: 'Your setup looks steady through the whole rep.',
  observations: ['Your feet stay under the bar.'],
  advice: ['Brace hard before you unrack.'],
  safetyFlag: { level: 'none' as const, reason: '' },
};

let sequence = 0;

export function resetMediaMocks(): void {
  state.objects.clear();
  state.attachments.clear();
  state.polls.clear();
  state.quotaRemaining = '2146435072';
  state.nextUploadFailure = null;
  state.askOutcome = null;
  state.askQuestions = [];
  sequence = 0;
}

/** Make the next ask answer this instead of the default advice. */
export function setAskOutcome(outcome: AskOutcome | null): void {
  state.askOutcome = outcome;
}

export function askQuestions(): ReadonlyArray<string | undefined> {
  return state.askQuestions;
}

/** Put a ready attachment in the store, for a test that starts past upload. */
export function seedAttachment(
  overrides: Partial<MediaAttachment> = {},
): MediaAttachment {
  sequence += 1;
  const attachment: MediaAttachment = {
    id: `attachment-${sequence}`,
    storageObjectId: `object-${sequence}`,
    kind: 'PHOTO',
    purpose: 'MEAL',
    targetType: null,
    targetId: null,
    processingStatus: 'ready',
    processingError: null,
    media: {
      mimeType: 'image/jpeg',
      size: '1024',
      width: 1024,
      height: 683,
      durationMs: null,
      frameCount: null,
    },
    aiSummary: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
  state.attachments.set(attachment.id, attachment);
  return attachment;
}

/** Make the next upload fail — a 413 for quota, a 400 for a refused type. */
export function failNextUpload(status: number, message: string): void {
  state.nextUploadFailure = { status, message };
}

export function setQuotaRemaining(remaining: string | null): void {
  state.quotaRemaining = remaining;
}

export function mediaAttachmentsInStore(): MediaAttachment[] {
  return [...state.attachments.values()];
}

function makeObject(name: string, mimeType: string, size: number): StorageObject {
  sequence += 1;
  const object: StorageObject = {
    id: `object-${sequence}`,
    name,
    size: String(size),
    mimeType,
    // See the header: the pipeline has not run yet.
    status: 'processing',
    metadata: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.objects.set(object.id, object);
  return object;
}

export const mediaHandlers = [
  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------
  http.post(`${API_BASE}/storage/objects`, async ({ request }) => {
    if (state.nextUploadFailure) {
      const failure = state.nextUploadFailure;
      state.nextUploadFailure = null;
      return HttpResponse.json(
        { statusCode: failure.status, message: failure.message },
        { status: failure.status },
      );
    }

    const form = await request.formData();
    const file = form.get('file') as File | null;

    return HttpResponse.json(
      {
        data: makeObject(
          file?.name ?? 'upload.bin',
          file?.type || 'application/octet-stream',
          file?.size ?? 0,
        ),
      },
      { status: 201 },
    );
  }),

  http.post(`${API_BASE}/storage/objects/upload/init`, async ({ request }) => {
    const body = (await request.json()) as {
      name: string;
      size: number;
      mimeType: string;
    };
    const object = makeObject(body.name, body.mimeType, body.size);
    const partSize = 10 * 1024 * 1024;
    const totalParts = Math.ceil(body.size / partSize);

    return HttpResponse.json(
      {
        data: {
          objectId: object.id,
          uploadId: `upload-${object.id}`,
          partSize,
          totalParts,
          // The real API returns only the first ten, which is why
          // `GET .../upload/urls` exists.
          presignedUrls: Array.from(
            { length: Math.min(10, totalParts) },
            (_, index) => ({
              partNumber: index + 1,
              url: `http://minio.test/part-${index + 1}`,
            }),
          ),
        },
      },
      { status: 201 },
    );
  }),

  http.get(`${API_BASE}/storage/objects/:id/upload/urls`, ({ request }) => {
    const url = new URL(request.url);
    const from = Number(url.searchParams.get('from'));
    const to = Number(url.searchParams.get('to'));

    return HttpResponse.json({
      data: {
        presignedUrls: Array.from({ length: to - from + 1 }, (_, index) => ({
          partNumber: from + index,
          url: `http://minio.test/part-${from + index}`,
        })),
      },
    });
  }),

  http.post(`${API_BASE}/storage/objects/:id/upload/complete`, ({ params }) => {
    const object = state.objects.get(params.id as string);
    if (!object) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json({ data: object });
  }),

  http.delete(`${API_BASE}/storage/objects/:id/upload/abort`, () =>
    new HttpResponse(null, { status: 204 }),
  ),

  // The presigned PUT goes straight to the object store, not through the API.
  // `ETag` must be exposed, or `complete` has nothing to send.
  http.put('http://minio.test/*', () =>
    new HttpResponse(null, { status: 200, headers: { ETag: '"part-etag"' } }),
  ),

  http.get(`${API_BASE}/storage/objects/:id`, ({ params }) => {
    const object = state.objects.get(params.id as string);
    if (!object) return new HttpResponse(null, { status: 404 });
    // Settles on the first re-read, so ImageUpload's poll terminates.
    object.status = 'ready';
    return HttpResponse.json({ data: object });
  }),

  http.get(`${API_BASE}/storage/objects/:id/download`, ({ params }) =>
    HttpResponse.json({
      data: {
        url: `http://minio.test/download/${params.id}?signature=abc`,
        expiresIn: 3600,
      },
    }),
  ),

  http.delete(`${API_BASE}/storage/objects/:id`, ({ params }) => {
    state.objects.delete(params.id as string);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${API_BASE}/storage/quota`, () =>
    HttpResponse.json({
      data: {
        usedBytes: '1048576',
        quotaBytes: state.quotaRemaining === null ? null : '2147483648',
        remainingBytes: state.quotaRemaining,
      },
    }),
  ),

  // ---------------------------------------------------------------------------
  // Media attachments
  // ---------------------------------------------------------------------------
  http.post(`${API_BASE}/media/attachments`, async ({ request }) => {
    const body = (await request.json()) as {
      storageObjectId: string;
      purpose: MediaAttachment['purpose'];
      targetType?: MediaAttachment['targetType'];
      targetId?: string;
    };

    const object = state.objects.get(body.storageObjectId);
    if (!object) {
      return HttpResponse.json(
        { statusCode: 404, message: 'Storage object not found' },
        { status: 404 },
      );
    }

    // One attachment per upload, like the unique index.
    const existing = [...state.attachments.values()].find(
      (candidate) => candidate.storageObjectId === body.storageObjectId,
    );
    if (existing) {
      return HttpResponse.json(
        { statusCode: 409, message: 'This upload is already attached' },
        { status: 409 },
      );
    }

    sequence += 1;
    const attachment: MediaAttachment = {
      id: `attachment-${sequence}`,
      storageObjectId: object.id,
      kind: object.mimeType.startsWith('video/') ? 'VIDEO' : 'PHOTO',
      purpose: body.purpose,
      targetType: body.targetType ?? null,
      targetId: body.targetId ?? null,
      processingStatus: 'processing',
      processingError: null,
      media: {
        mimeType: object.mimeType,
        size: object.size,
        width: null,
        height: null,
        durationMs: null,
        frameCount: null,
      },
      aiSummary: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    state.attachments.set(attachment.id, attachment);
    return HttpResponse.json({ data: attachment }, { status: 201 });
  }),

  http.post(`${API_BASE}/media/attachments/:id/ask`, async ({ request, params }) => {
    const body = (await request.json()) as { question?: string };
    state.askQuestions.push(body.question);

    if (state.askOutcome) {
      const outcome = state.askOutcome;
      return HttpResponse.json(outcome.body ?? {}, {
        status: outcome.status ?? 200,
      });
    }

    const attachment = state.attachments.get(params.id as string);
    if (attachment) {
      attachment.aiSummary = {
        ...DEFAULT_ADVICE,
        askedAt: new Date().toISOString(),
        question: body.question ?? null,
        invocationId: 'inv-1',
        promptVersion: 'media_analyst.v1',
        model: 'gpt-test',
      };
    }

    return HttpResponse.json({
      data: {
        ok: true,
        advice: DEFAULT_ADVICE,
        invocationId: 'inv-1',
        model: 'gpt-test',
        latencyMs: 120,
        askedAt: new Date().toISOString(),
      },
    });
  }),

  http.get(`${API_BASE}/media/attachments/:id/preview`, ({ params, request }) => {
    const url = new URL(request.url);
    return HttpResponse.json({
      data: {
        url: `http://minio.test/preview/${params.id}`,
        expiresIn: 3600,
        variant: url.searchParams.get('variant') ?? 'original',
      },
    });
  }),

  http.get(`${API_BASE}/media/attachments/:id`, ({ params }) => {
    const id = params.id as string;
    const attachment = state.attachments.get(id);
    if (!attachment) return new HttpResponse(null, { status: 404 });

    const polls = (state.polls.get(id) ?? 0) + 1;
    state.polls.set(id, polls);

    // Ready on the SECOND poll, so the polling loop is exercised.
    if (polls >= 2 && attachment.processingStatus === 'processing') {
      attachment.processingStatus = 'ready';
      attachment.media = {
        ...attachment.media,
        width: 1024,
        height: 683,
        ...(attachment.kind === 'VIDEO'
          ? { durationMs: 2000, frameCount: 4 }
          : {}),
      };
    }

    return HttpResponse.json({ data: attachment });
  }),

  http.get(`${API_BASE}/media/attachments`, () =>
    HttpResponse.json({
      data: {
        items: [...state.attachments.values()],
        meta: {
          page: 1,
          pageSize: 20,
          totalItems: state.attachments.size,
          totalPages: 1,
        },
      },
    }),
  ),

  http.delete(`${API_BASE}/media/attachments/:id`, ({ params }) => {
    state.attachments.delete(params.id as string);
    return new HttpResponse(null, { status: 204 });
  }),
];
