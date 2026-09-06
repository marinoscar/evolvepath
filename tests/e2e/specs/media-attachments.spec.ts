import { test, expect, type Page } from '@playwright/test';

import { loginAsTestUser } from '../helpers/auth.helper';
import { uniqueEmail } from '../helpers/path.helper';
import { enableAi } from '../helpers/weekly.helper';
import {
  getStorageObject,
  lastProviderRequest,
  listAttachments,
  storageObjectExists,
  uploadViaPicker,
  waitForAttachmentReady,
  waitForPickerReady,
} from '../helpers/media.helper';

// =============================================================================
// E03 — a phone upload becomes coach advice, end to end (issue #103)
// =============================================================================
//
// The epic's promise spans MinIO, ffmpeg, sharp, the processing pipeline, the
// attachment API, the AI gateway, the fake provider and two React components.
// Unit and integration tests cover each seam; only this proves the chain.
//
// THREE ASSERTIONS ARE ABOUT THINGS THAT DO NOT HAPPEN, and nothing but a
// browser and a real bucket can see them:
//
//   1. A `.txt` dropped into the picker makes NO NETWORK REQUEST (#91) — the
//      client-side mirror of the server allowlist, which exists so somebody at
//      a squat rack learns before four hundred megabytes leave their phone.
//   2. A MEAL answer contains NO CALORIE COUNT (#96, PRD §46).
//   3. Deleting a video removes its SAMPLED FRAMES (#79) — objects with no
//      foreign key home, which nothing cascades.
//
// The stack is `base + dev + minio + fake-openai`, with `AI_VIDEO_MAX_FRAMES=4`
// so the frame count is a number rather than a range. Readiness is polled
// through the API; there is no `page.waitForTimeout` in this file.
// =============================================================================

/** A signed-in user with a key and AI enabled — the state every case needs. */
async function signIn(page: Page, prefix: string): Promise<void> {
  await loginAsTestUser(page, {
    email: uniqueEmail(prefix),
    role: 'admin',
    withAiKey: true,
  });

  await enableAi(page);
}

/** Open `/media` and get the Add-media dialog up. */
async function openAddMedia(page: Page): Promise<void> {
  await page.goto('/media');
  await page.getByRole('button', { name: 'Add media' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test.describe('E03 media attachments', () => {
  test('the stack is up before anything else runs', async ({ request }) => {
    // A readable failure when MinIO or the fake server is missing, instead of
    // a timeout inside an upload with no explanation.
    const health = await request.get('/api/health/ready');
    expect(
      health.ok(),
      'the API is not ready — is the compose stack (base + dev + minio + fake-openai) up?',
    ).toBe(true);
  });

  test('refuses a text file client-side, with no network request', async ({
    page,
  }) => {
    await signIn(page, 'media-reject');
    await openAddMedia(page);

    const uploads: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/storage/objects')) {
        uploads.push(request.url());
      }
    });

    await uploadViaPicker(page, 'fixtures/media/note.txt');

    await expect(
      page.getByText(/File type "text\/plain" is not allowed/),
    ).toBeVisible();
    expect(uploads, 'a refused file must not reach the network').toEqual([]);
  });

  test('uploads a photo, normalizes it, and asks the coach', async ({ page }) => {
    await signIn(page, 'media-photo');
    await openAddMedia(page);

    await page.getByTestId('media-purpose-MEAL').click();
    await uploadViaPicker(page, 'fixtures/media/photo.jpg');
    await waitForPickerReady(page);

    const [attachment] = await listAttachments(page);
    const ready = await waitForAttachmentReady(page, attachment.id);

    // The 1280x960 source is normalized to a longest edge of 1024 (#87).
    expect(ready.media.width).toBe(1024);

    await page
      .getByLabel(/Question/)
      .fill('Is this a decent breakfast?');
    await page.getByTestId('media-ask-button').click();

    const summary = page.getByTestId('media-advice-summary');
    await expect(summary).toBeVisible({ timeout: 60_000 });
    await expect(summary).not.toHaveText('');

    // PRD §46: a photograph of food invites a calorie count, and the whole
    // point of this purpose is that it never produces one.
    const dialogText = (await page.getByRole('dialog').innerText()).toLowerCase();
    expect(dialogText).not.toContain('kcal');
    expect(dialogText).not.toContain('calorie');

    // Persisted, not held in the dialog that produced it.
    await page.getByRole('button', { name: 'Done' }).click();
    await page.reload();
    await page.getByRole('button', { name: 'The coach’s notes' }).click();
    await expect(page.getByTestId('media-advice-summary')).toBeVisible();
  });

  test('samples a video into frames and sends every one of them', async ({
    page,
    request,
  }) => {
    await signIn(page, 'media-video');
    await openAddMedia(page);

    await page.getByTestId('media-purpose-WORKOUT_FORM').click();
    await uploadViaPicker(page, 'fixtures/media/clip.mp4');
    await waitForPickerReady(page);

    const [attachment] = await listAttachments(page);
    const ready = await waitForAttachmentReady(page, attachment.id);

    // 2000 ms / 500 = 4, capped at AI_VIDEO_MAX_FRAMES=4.
    expect(ready.media.frameCount).toBe(4);
    expect(ready.media.durationMs).toBeGreaterThan(1800);

    const object = await getStorageObject(page, ready.storageObjectId);
    const frames = object.metadata?._processing?.['video-frames'];
    expect(frames.frameCount).toBe(4);
    expect(frames.frames).toHaveLength(4);

    // Every frame is a real, readable object of its own — which is what the
    // gateway resolves, one ownership check at a time.
    for (const frame of frames.frames as Array<{ objectId: string }>) {
      const child = await getStorageObject(page, frame.objectId);
      expect(child.status).toBe('ready');
      expect(child.metadata?.derivedFrom).toBe(ready.storageObjectId);
    }

    await page.getByTestId('media-ask-button').click();
    await expect(page.getByTestId('media-advice-summary')).toBeVisible({
      timeout: 60_000,
    });

    // The assertion nothing else can make. The attachment says four frames
    // EXIST; only the provider knows whether four images were SENT — and
    // "the model sees the video" is the whole reason the sampler exists.
    const sent = await lastProviderRequest(request);
    expect(sent.schemaName).toBe('media_advice');
    expect(sent.imageCount).toBe(4);
    // Inline mode (the default): base64 in the request body, not a URL the
    // provider would fetch from this deployment's storage.
    for (const url of sent.imageUrls) {
      expect(url.startsWith('data:image/')).toBe(true);
    }
  });

  test('renders the professional-care alert with its fixed copy', async ({
    page,
  }) => {
    await signIn(page, 'media-safety');
    await openAddMedia(page);

    await page.getByTestId('media-purpose-WORKOUT_FORM').click();
    await uploadViaPicker(page, 'fixtures/media/clip.mp4');
    await waitForPickerReady(page);

    // The fake server selects its scenario from what the USER TYPED — the API
    // calls it, the browser does not, so this is the only lever a spec has.
    await page
      .getByLabel(/Question/)
      .fill('I felt sharp pain and my knee gave way');
    await page.getByTestId('media-ask-button').click();

    const alert = page.getByTestId('media-advice-safety');
    await expect(alert).toBeVisible({ timeout: 60_000 });
    // The FIXED copy, not the model's words (PRD §45, §81).
    await expect(alert).toContainText('see a qualified professional');
    await expect(alert).toContainText('Please get this checked');
  });

  test('deleting media removes its derived frames', async ({ page }) => {
    await signIn(page, 'media-delete');
    await openAddMedia(page);

    await uploadViaPicker(page, 'fixtures/media/clip.mp4');
    await waitForPickerReady(page);

    const [attachment] = await listAttachments(page);
    const ready = await waitForAttachmentReady(page, attachment.id);
    const object = await getStorageObject(page, ready.storageObjectId);
    const frameIds = (
      object.metadata?._processing?.['video-frames']?.frames ?? []
    ).map((frame: { objectId: string }) => frame.objectId);

    expect(frameIds.length).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Delete' }).first().click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect(page.getByText('No media yet')).toBeVisible();

    // Frames have no foreign key home, so nothing cascades them — leaving them
    // behind would leave images of a video the product says is gone.
    for (const frameId of frameIds) {
      expect(await storageObjectExists(page, frameId)).toBe(false);
    }
    expect(await storageObjectExists(page, ready.storageObjectId)).toBe(false);
  });

  test('reports the storage quota', async ({ page }) => {
    await signIn(page, 'media-quota');
    await openAddMedia(page);

    await uploadViaPicker(page, 'fixtures/media/photo.jpg');
    await waitForPickerReady(page);

    // The caption is the picker's own read of GET /storage/quota.
    await expect(page.getByText(/of storage left/)).toBeVisible();
  });
});

// =============================================================================
// The phone. PRD §123 makes it the primary platform, so it is a project.
// =============================================================================
test.describe('E03 media attachments on a phone', () => {
  test.skip(
    ({ isMobile }) => !isMobile,
    'the mobile-chromium project only',
  );

  test('offers a camera control and a full-screen dialog', async ({ page }) => {
    await signIn(page, 'media-mobile');
    await page.goto('/media');
    await page.getByRole('button', { name: 'Add media' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Below `sm` the control is a camera button, not a drop zone.
    await expect(
      page.getByRole('button', { name: 'Take photo or video' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Add photos or videos' }),
    ).toHaveCount(0);

    // `capture="environment"` is the whole point: a form check that opens a
    // file browser in a gym is a feature nobody uses.
    await expect(page.getByTestId('media-picker-input')).toHaveAttribute(
      'capture',
      'environment',
    );

    const viewport = page.viewportSize()!;
    const box = (await dialog.boundingBox())!;
    expect(Math.round(box.width)).toBe(viewport.width);
  });
});
