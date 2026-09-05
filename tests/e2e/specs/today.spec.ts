import { expect, test, type Page } from '@playwright/test';

import { loginAsTestUser } from '../helpers/auth.helper';
import { accessToken, apiGet, uniqueEmail } from '../helpers/path.helper';
import {
  createCommitment,
  createOutcome,
  getCommitment,
  getEvidence,
  getReflections,
  getToday,
  inMinutes,
  todayLocalInput,
  tomorrowLocalInput,
} from '../helpers/commitments.helper';

// =============================================================================
// E05 end to end (issue #55)
// =============================================================================
//
// The epic's promise (PRD §101 Day 1–3) is only real if a browser can drive it
// against the API and the database. Every assertion below therefore lands in
// BOTH places: what the screen shows, and what `GET /api/…` says afterwards.
//
// Three properties this file exists to prove, none of which a unit test can:
//
//   1. STARTING IS EVIDENCE, SEPARATE FROM COMPLETING. Case 1 reads the evidence
//      rows back through the public API and asserts their order and sources.
//   2. A RESCHEDULE MOVES THE INTENTION, NOT THE ROW. Case 2 moves the same
//      commitment twice through the UI, then walks the chain by id.
//   3. THE PRODUCT WORKS WITH THE COACH DOWN. The last block points the provider
//      at an unreachable URL and drives Today and "Make it smaller" anyway.
//
// SEEDED THROUGH THE API, never the database: Playwright cannot reach Postgres,
// and going through the create contracts is the better test anyway.
//
// A FRESH USER PER TEST. The suite is `fullyParallel` against one database, so
// a shared email is a shared board and every count assertion becomes a race.
// =============================================================================

/** `M:SS` or `MM:SS`. Never an exact second — the clock moves as we assert. */
const CLOCK = /^\d{1,2}:\d{2}$/;

async function signIn(page: Page, prefix: string, role: 'contributor' | 'admin' = 'contributor') {
  await loginAsTestUser(page, { email: uniqueEmail(prefix), role });
}

/** The three-domain board the epic's manual script describes. */
async function seedThreeDomains(page: Page) {
  const outcome = await createOutcome(page, {
    domain: 'WORK',
    title: 'Ship the Q4 proposal',
    whyItMatters: 'Free my evenings',
  });

  const work = await createCommitment(page, {
    domain: 'WORK',
    title: 'Draft the proposal storyline',
    scheduledStart: inMinutes(30),
    importance: 5,
    outcomeId: outcome.id,
    fullVersion: 'Draft the storyline',
    fullMinutes: 25,
    shortVersion: 'Write the decision statement',
    shortMinutes: 10,
    minimumVersion: 'Open the doc and write one sentence',
    minimumMinutes: 5,
  });

  const family = await createCommitment(page, {
    domain: 'FAMILY',
    title: 'Phone-free dinner',
    scheduledStart: inMinutes(120),
    importance: 4,
    fullMinutes: 45,
  });

  const health = await createCommitment(page, {
    domain: 'HEALTH',
    title: 'Upper A',
    scheduledStart: inMinutes(180),
    importance: 3,
    fullMinutes: 38,
    shortVersion: 'Bench and rows',
    shortMinutes: 20,
    minimumVersion: '10-minute circuit',
    minimumMinutes: 10,
  });

  return { outcome, work, family, health };
}

test.describe('E05 — Today, commitments and the Start flow', () => {
  test('start, pause, continue and complete leave four evidence rows', async ({ page }) => {
    await signIn(page, 'e05-start');
    const { work } = await seedThreeDomains(page);

    await page.goto('/');

    const nba = page.getByTestId('next-best-action');
    await expect(nba).toContainText('Draft the storyline');

    await nba.getByRole('button', { name: 'Start 25 min' }).click();
    await page.waitForURL(`/start/${work.id}`);

    // The outcome's motivation, joined onto the card the Start screen reads.
    await expect(page.getByTestId('why-it-matters')).toContainText('Free my evenings');

    await page.getByRole('button', { name: '5 min' }).click();
    await page.getByRole('button', { name: 'Begin 5:00' }).click();

    const countdown = page.getByTestId('countdown');
    await expect(countdown).toHaveText(CLOCK);

    // THE RELOAD CASE. Let the timer run, reload, and require that it did NOT
    // come back at the full duration — which is exactly what a locally counted
    // timer would do, and the whole reason the server anchors it.
    await page.waitForTimeout(3500);
    await page.reload();
    await expect(countdown).toHaveText(CLOCK);
    await expect(countdown).not.toHaveText('5:00');

    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByTestId('countdown-status')).toHaveText('Paused');

    const frozen = (await countdown.textContent()) ?? '';
    await page.waitForTimeout(2000);
    await expect(countdown).toHaveText(frozen);

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('countdown-status')).not.toHaveText('Paused');

    await page.getByRole('button', { name: 'Done for now' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();

    await page.waitForURL('/');

    const finished = await getCommitment(page, work.id);
    expect(finished.status).toBe('COMPLETED');
    expect(finished.startedAt).not.toBeNull();
    expect(finished.completedAt).not.toBeNull();

    // Starting is evidence in its own right; completing is a different row.
    // The API returns newest first, so this reads the story forwards.
    const evidence = await getEvidence(page, work.id);
    expect(evidence.map((row) => row.evidenceType).reverse()).toEqual([
      'started',
      'paused',
      'continued',
      'completed',
    ]);
    expect(evidence.find((row) => row.evidenceType === 'started')?.source).toBe('APP_FLOW');
    expect(evidence.find((row) => row.evidenceType === 'completed')?.source).toBe('USER_LOG');
  });

  test('rescheduling twice moves the intention, not the row', async ({ page }) => {
    await signIn(page, 'e05-reschedule');
    const { health } = await seedThreeDomains(page);

    await page.goto('/');

    const healthCard = page.getByTestId('domain-card-HEALTH');
    await expect(healthCard).toContainText('Upper A');

    await healthCard.getByRole('button', { name: 'Actions for Upper A' }).click();
    await page.getByRole('menuitem', { name: 'Reschedule' }).click();
    await page.getByLabel('New time').fill(todayLocalInput(20));
    await page.getByRole('button', { name: 'Move it' }).click();

    // The original closed and a NEW row carries the intention, badged with the
    // count. The UI has to follow the returned id from here on.
    await expect(healthCard.getByLabel('Moved 1 times')).toBeVisible();

    await healthCard.getByRole('button', { name: 'Actions for Upper A' }).click();
    await page.getByRole('menuitem', { name: 'Reschedule' }).click();
    await page.getByLabel('New time').fill(tomorrowLocalInput(7));
    await page.getByRole('button', { name: 'Move it' }).click();

    // Moved off today entirely — VISION §33 refuses catch-up debt.
    await expect(healthCard).not.toContainText('Upper A');

    const original = await getCommitment(page, health.id);
    expect(original.status).toBe('RESCHEDULED');
    expect(original.rescheduleCount).toBe(0);
    expect(original.rescheduledToId).not.toBeNull();

    const middle = await getCommitment(page, original.rescheduledToId as string);
    expect(middle.status).toBe('RESCHEDULED');
    expect(middle.rescheduleCount).toBe(1);
    expect(middle.rescheduledFromId).toBe(health.id);

    const live = await getCommitment(page, middle.rescheduledToId as string);
    expect(live.status).toBe('PLANNED');
    expect(live.rescheduleCount).toBe(2);
    expect(live.rescheduledFromId).toBe(middle.id);
  });

  test('a low-energy check-in sizes the recommendation down', async ({ page }) => {
    await signIn(page, 'e05-checkin');
    await seedThreeDomains(page);

    await page.goto('/');

    const nba = page.getByTestId('next-best-action');
    await expect(nba.getByRole('button', { name: 'Start 25 min' })).toBeVisible();

    await page.getByRole('radio', { name: 'Low energy' }).click();

    // The API decides the new size; the screen renders whatever came back.
    await expect(nba.getByRole('button', { name: 'Start 5 min' })).toBeVisible();
    await expect(nba).toContainText('Open the doc and write one sentence');

    const today = await getToday(page);
    expect(today.checkIn?.feel).toBe('LOW_ENERGY');
    expect(today.nextBestAction?.version).toBe('minimum');
    expect(today.nextBestAction?.durationMinutes).toBe(5);
    expect(today.nextBestAction?.interventionMode).toBe('RECONNECT');
  });

  test('make it smaller creates a child commitment and opens its Start screen', async ({
    page,
  }) => {
    await signIn(page, 'e05-decompose');
    const { work } = await seedThreeDomains(page);

    await page.goto('/');
    await page
      .getByTestId('next-best-action')
      .getByRole('button', { name: 'Make it smaller' })
      .click();

    const dialog = page.getByRole('dialog');
    // Against the fake OpenAI server this is the coach's own first step; with it
    // unreachable it is the deterministic one. Either way it is a real move.
    await expect(dialog.getByLabel('First step')).not.toHaveValue('');
    await dialog.getByRole('button', { name: 'Use this' }).click();

    await page.waitForURL(/\/start\/[0-9a-f-]{36}$/);

    const newId = page.url().split('/').pop() as string;
    const child = await apiGet<{ decomposedFromId: string | null }>(
      page,
      `/api/commitments/${newId}/actions`,
    );
    expect(child.decomposedFromId).toBe(work.id);
  });

  test('skipping records the reason as a reflection, and no evidence', async ({ page }) => {
    await signIn(page, 'e05-skip');
    const { family } = await seedThreeDomains(page);

    await page.goto('/');

    const familyCard = page.getByTestId('domain-card-FAMILY');
    await familyCard.getByRole('button', { name: 'Actions for Phone-free dinner' }).click();
    await page.getByRole('menuitem', { name: 'Skip' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: 'Unexpected conflict' }).click();
    await dialog.getByLabel(/Anything else/).fill('in-laws visiting');
    await dialog.getByRole('button', { name: 'Skip it' }).click();

    await expect(
      familyCard.getByRole('button', { name: 'Actions for Phone-free dinner' }),
    ).toBeHidden();

    const skipped = await getCommitment(page, family.id);
    expect(skipped.status).toBe('SKIPPED');

    const reflections = await getReflections(page, family.id);
    expect(reflections[0]?.frictionTags).toEqual(['UNEXPECTED_CONFLICT']);
    expect(reflections[0]?.userText).toBe('in-laws visiting');

    // A skip is not execution: recording it as evidence would make "what did
    // you do this week" include the things you did not do.
    expect(await getEvidence(page, family.id)).toEqual([]);
  });

  test('quick add puts a family intention on the family card', async ({ page }) => {
    await signIn(page, 'e05-quickadd');
    await seedThreeDomains(page);

    await page.goto('/');
    await page.getByTestId('quick-add-fab').click();

    await page.getByRole('button', { name: /Family intention/ }).click();
    await page.getByLabel(/What are you committing to/).fill('Read with Mia');
    await page.getByLabel('When').fill(todayLocalInput(20));
    await page.getByRole('button', { name: '20 min' }).click();
    await page.getByRole('button', { name: 'Add it' }).click();

    await expect(page.getByTestId('domain-card-FAMILY')).toContainText('Read with Mia');

    const today = await getToday(page);
    const familySection = today.domains.find((section) => section.domain === 'FAMILY');
    expect(familySection?.commitments.length).toBe(2);
  });

  test('a notification deep link opens the Start screen and cleans the URL', async ({ page }) => {
    await signIn(page, 'e05-deeplink');
    const { work } = await seedThreeDomains(page);

    await page.goto(`/?commitment=${work.id}&action=start`);

    await page.waitForURL(`/start/${work.id}`);
    expect(page.url()).not.toContain('action=start');
  });

  test('an unknown deep link says so rather than failing silently', async ({ page }) => {
    await signIn(page, 'e05-deeplink-gone');
    await seedThreeDomains(page);

    await page.goto('/?commitment=11111111-1111-4111-8111-111111111111&action=skip');

    await expect(page.getByText(/no longer on today/)).toBeVisible();
  });
});

// =============================================================================
// The coach is down
// =============================================================================
//
// PRD §120 as an end-to-end assertion. The provider's base URL is pointed at an
// unreachable port — the closest a browser-driven test can get to "OpenAI is
// down" — and Today, its rationale and "Make it smaller" are driven anyway.
//
// A fresh admin per test, so nothing this block does can reach another test's
// user; the `afterEach` restore is belt and braces on top of that.
// =============================================================================

test.describe('E05 — with the coach unreachable', () => {
  const UNREACHABLE = 'http://fake-openai:1/v1';

  /** Reads the current settings for their ETag, then writes `baseUrl`. */
  async function setBaseUrl(page: Page, baseUrl: string | null) {
    const token = await accessToken(page);
    const current = await page.request.get('/api/ai-settings', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const etag = current.headers()['etag'];

    await page.request.put('/api/ai-settings', {
      headers: { Authorization: `Bearer ${token}`, ...(etag ? { 'If-Match': etag } : {}) },
      data: { baseUrl },
    });
  }

  test('Today renders completely and the fallbacks are real offers', async ({ page }) => {
    await signIn(page, 'e05-ai-down', 'admin');
    await seedThreeDomains(page);
    await setBaseUrl(page, UNREACHABLE);

    try {
      await page.goto('/');

      // The whole board, with no AI involved in producing any of it.
      await expect(page.getByTestId('next-best-action')).toBeVisible();
      await expect(page.getByTestId('nba-rationale')).not.toBeEmpty();
      await expect(page.getByTestId('domain-card-WORK')).toBeVisible();
      await expect(page.getByTestId('domain-card-FAMILY')).toBeVisible();
      await expect(page.getByTestId('domain-card-HEALTH')).toBeVisible();

      // The insight is written without the coach, and says so. The timeout is
      // generous because the provider call has to fail first.
      await expect(page.getByTestId('coach-insight-template')).toBeVisible({ timeout: 60_000 });

      // A stuck user who reached for help still gets a real five-minute move.
      await page
        .getByTestId('next-best-action')
        .getByRole('button', { name: 'Make it smaller' })
        .click();

      const dialog = page.getByRole('dialog');
      await expect(dialog.getByTestId('decompose-template')).toBeVisible({ timeout: 60_000 });
      await expect(dialog.getByLabel('First step')).toHaveValue(
        'Open it and do the first 5 minutes',
      );
      await expect(dialog.getByRole('button', { name: 'Use this' })).toBeEnabled();
    } finally {
      // Restored here rather than in `afterEach` so it runs with this test's own
      // signed-in admin, whoever else is running in parallel.
      await setBaseUrl(page, null).catch(() => undefined);
    }
  });
});
