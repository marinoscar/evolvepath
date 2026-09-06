import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { apiGet } from './path.helper';

// =============================================================================
// Driving the media flow from a spec (issue #103, epic #67)
// =============================================================================
//
// A SIBLING of the other helpers, not a copy: `apiGet` and `loginAsTestUser`
// are imported. What lives here is the E03-shaped waiting — an upload is not
// finished when the bytes land, because the server still has to sample a video
// into frames or normalize a photo, and every assertion downstream of that
// depends on it.
//
// NOTHING HERE USES `page.waitForTimeout`. Readiness is polled through the API
// with `expect.poll`, so a failure names the state it was stuck in rather than
// timing out with no explanation.
// =============================================================================

export interface E2eMediaAttachment {
  id: string;
  storageObjectId: string;
  kind: 'PHOTO' | 'VIDEO';
  purpose: string;
  processingStatus: 'processing' | 'ready' | 'failed';
  processingError: string | null;
  media: {
    mimeType: string;
    size: string;
    width: number | null;
    height: number | null;
    durationMs: number | null;
    frameCount: number | null;
  };
  aiSummary: Record<string, unknown> | null;
}

/** Put a file into the picker's hidden input. */
export async function uploadViaPicker(
  page: Page,
  fixturePath: string,
): Promise<void> {
  // The library input rather than the camera one: `capture="environment"` is
  // the phone affordance, and Playwright is not a phone. Both accept the same
  // files.
  await page
    .locator('[data-testid="media-picker-library-input"]')
    .setInputFiles(fixturePath);
}

/** Wait until the picker's own status chip says the pipeline is done. */
export async function waitForPickerReady(page: Page): Promise<void> {
  await expect(page.getByTestId('media-item-status')).toHaveText('Ready', {
    timeout: 60_000,
  });
}

/** The caller's attachments, newest first. */
export async function listAttachments(
  page: Page,
): Promise<E2eMediaAttachment[]> {
  const result = await apiGet<{ items: E2eMediaAttachment[] }>(
    page,
    '/api/media/attachments?pageSize=50',
  );
  return result.items;
}

/**
 * Poll one attachment until it stops processing.
 *
 * Through the API rather than the DOM: the screen is one consumer of this
 * state and a spec that only watches the screen cannot tell "the pipeline is
 * slow" from "the component forgot to poll".
 */
export async function waitForAttachmentReady(
  page: Page,
  attachmentId: string,
): Promise<E2eMediaAttachment> {
  await expect
    .poll(
      async () => {
        const attachment = await apiGet<E2eMediaAttachment>(
          page,
          `/api/media/attachments/${attachmentId}`,
        );
        return attachment.processingStatus;
      },
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .toBe('ready');

  return apiGet<E2eMediaAttachment>(
    page,
    `/api/media/attachments/${attachmentId}`,
  );
}

/** The raw storage object, for the `_processing` metadata the API derives from. */
export async function getStorageObject(
  page: Page,
  objectId: string,
): Promise<{
  id: string;
  status: string;
  metadata: Record<string, any> | null;
}> {
  return apiGet(page, `/api/storage/objects/${objectId}`);
}

/** Does this storage object still exist for the caller? */
export async function storageObjectExists(
  page: Page,
  objectId: string,
): Promise<boolean> {
  try {
    await getStorageObject(page, objectId);
    return true;
  } catch {
    return false;
  }
}

/**
 * What the fake provider was actually sent, last time (issue #103).
 *
 * The one assertion nothing else in the stack can make: the attachment can say
 * four frames EXIST, and only the provider knows whether four images were
 * SENT. `e2e-media.compose.yml` publishes port 8089 so the runner — which is
 * on the host, not inside the Compose network — can reach it.
 *
 * Ids, counts and 40-character URL prefixes. Never bytes.
 */
export async function lastProviderRequest(request: APIRequestContext): Promise<{
  schemaName: string | null;
  imageCount: number;
  imageUrls: string[];
  textParts: number;
}> {
  // A literal rather than an env var: the port is fixed by
  // `e2e-media.compose.yml`, and a knob here would be a second place for it to
  // be wrong.
  const response = await request.get('http://localhost:8089/__debug/last');

  if (!response.ok()) {
    throw new Error(
      `fake-openai /__debug/last -> ${response.status()}. Is e2e-media.compose.yml in the stack? It is what publishes port 8089.`,
    );
  }

  return response.json();
}
