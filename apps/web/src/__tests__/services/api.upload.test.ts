import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { api, ApiError, putToSignedUrl } from '../../services/api';

// =============================================================================
// `api.upload` and `putToSignedUrl` are XHR, and that is the point (issue #91)
// =============================================================================
//
// `fetch` has no upload progress event, and a phone video is a
// multi-hundred-megabyte upload over a mobile connection: without a progress
// bar the user cannot tell a slow upload from a dead one. So these two are the
// only XHR in the app, and they are tested against a minimal fake rather than
// through MSW, which intercepts fetch.
// =============================================================================

interface FakeXhrOptions {
  status?: number;
  responseText?: string;
  headers?: Record<string, string>;
  fail?: boolean;
}

let instances: FakeXhr[] = [];
let nextResponses: FakeXhrOptions[] = [];

class FakeXhr {
  static instances: FakeXhr[] = [];

  method = '';
  url = '';
  withCredentials = false;
  headers: Record<string, string> = {};
  body: unknown = null;
  status = 200;
  responseText = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null };

  private responseHeaders: Record<string, string> = {};

  constructor() {
    instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  getResponseHeader(name: string): string | null {
    return this.responseHeaders[name] ?? null;
  }

  abort() {
    this.onabort?.();
  }

  send(body: unknown) {
    this.body = body;
    const response = nextResponses.shift() ?? { status: 200, responseText: '{}' };

    // Progress first, then completion — the order a real upload reports in.
    this.upload.onprogress?.({ loaded: 50, total: 100 } as ProgressEvent);

    if (response.fail) {
      queueMicrotask(() => this.onerror?.());
      return;
    }

    this.status = response.status ?? 200;
    this.responseText = response.responseText ?? '{}';
    this.responseHeaders = response.headers ?? {};
    queueMicrotask(() => this.onload?.());
  }
}

function queueResponses(...responses: FakeXhrOptions[]) {
  nextResponses = responses;
}

describe('api.upload', () => {
  beforeEach(() => {
    instances = [];
    nextResponses = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr as unknown as typeof XMLHttpRequest);
    api.setAccessToken('token-abc');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    api.setAccessToken(null);
  });

  it('sends the bearer token and no Content-Type', async () => {
    // The browser writes `multipart/form-data; boundary=…` itself; a
    // hand-written header omits the boundary and makes the body unparseable.
    queueResponses({ status: 201, responseText: '{"data":{"id":"obj-1"}}' });

    await api.upload('/storage/objects', new FormData());

    expect(instances[0].headers.Authorization).toBe('Bearer token-abc');
    expect(instances[0].headers['Content-Type']).toBeUndefined();
    expect(instances[0].withCredentials).toBe(true);
  });

  it('unwraps the data envelope', async () => {
    queueResponses({ status: 201, responseText: '{"data":{"id":"obj-1"}}' });

    await expect(api.upload('/storage/objects', new FormData())).resolves.toEqual(
      { id: 'obj-1' },
    );
  });

  it('reports progress', async () => {
    queueResponses({ status: 201, responseText: '{"data":{}}' });
    const onProgress = vi.fn();

    await api.upload('/storage/objects', new FormData(), { onProgress });

    expect(onProgress).toHaveBeenCalledWith(50, 100);
  });

  it('retries once after a 401 and a successful refresh', async () => {
    queueResponses(
      { status: 401, responseText: '{"message":"Unauthorized"}' },
      { status: 201, responseText: '{"data":{"id":"obj-1"}}' },
    );
    vi.spyOn(api, 'refreshToken').mockResolvedValue(true);

    await expect(
      api.upload('/storage/objects', new FormData()),
    ).resolves.toEqual({ id: 'obj-1' });
    expect(instances).toHaveLength(2);
  });

  it('gives up when the refresh fails', async () => {
    queueResponses({ status: 401, responseText: '{"message":"Unauthorized"}' });
    vi.spyOn(api, 'refreshToken').mockResolvedValue(false);

    await expect(api.upload('/storage/objects', new FormData())).rejects.toThrow(
      ApiError,
    );
    expect(instances).toHaveLength(1);
  });

  it('surfaces a 413 with its status and the server’s message', async () => {
    // The picker branches on 413 to say "you have used all of your storage",
    // and the server's message names used and quota bytes.
    queueResponses({
      status: 413,
      responseText:
        '{"message":"Storage quota exceeded: 900 of 1000 bytes used"}',
    });

    await expect(
      api.upload('/storage/objects', new FormData()),
    ).rejects.toMatchObject({
      status: 413,
      message: 'Storage quota exceeded: 900 of 1000 bytes used',
    });
  });

  it('surfaces a network failure as status 0', async () => {
    queueResponses({ fail: true });

    await expect(
      api.upload('/storage/objects', new FormData()),
    ).rejects.toMatchObject({ status: 0 });
  });
});

describe('putToSignedUrl', () => {
  beforeEach(() => {
    instances = [];
    nextResponses = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr as unknown as typeof XMLHttpRequest);
    api.setAccessToken('token-abc');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    api.setAccessToken(null);
  });

  it('carries NO Authorization header', async () => {
    // The presigned URL is the credential. Sending a bearer token alongside it
    // makes S3 reject the request as double-authenticated.
    queueResponses({ status: 200, headers: { ETag: '"abc"' } });

    await putToSignedUrl('http://minio.test/part-1', new Blob(['x']));

    expect(instances[0].headers.Authorization).toBeUndefined();
    expect(instances[0].method).toBe('PUT');
  });

  it('returns the ETag, which complete needs', async () => {
    queueResponses({ status: 200, headers: { ETag: '"part-1-etag"' } });

    await expect(
      putToSignedUrl('http://minio.test/part-1', new Blob(['x'])),
    ).resolves.toBe('"part-1-etag"');
  });

  it('fails with an actionable message when CORS hides the ETag', async () => {
    // The commonest real misconfiguration: an AWS bucket without
    // `ExposeHeaders: [ETag]`. Without this the failure surfaces much later,
    // as a complete call with a missing field.
    queueResponses({ status: 200, headers: {} });

    await expect(
      putToSignedUrl('http://minio.test/part-1', new Blob(['x'])),
    ).rejects.toThrow(/CORS configuration must expose that header/);
  });
});
