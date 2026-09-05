import { test, expect, type Page } from '@playwright/test';

import { loginAsTestUser } from '../helpers/auth.helper';
import { apiPost } from '../helpers/commitments.helper';
import { accessToken, uniqueEmail } from '../helpers/path.helper';
import {
  addDays,
  atUtc,
  currentReview,
  domainModes,
  enableAi,
  generateReview,
  listCommitmentsBetween,
  seedMixedWeek,
  weeklySettings,
  type SeededWeek,
} from '../helpers/weekly.helper';

// =============================================================================
// E10 — the weekly loop, end to end (issue #89)
// =============================================================================
//
// PRD §135's loop, driven through the browser: review the week → read the
// numbers and the pattern → accept the plan change → plan the next week →
// hit the §48 load warning → approve → find the commitments on the calendar.
// Every step crosses the browser, the API and the database, which is why it is
// proved here and not in a unit test.
//
// THE CENTRAL ASSERTION IS A COUNT, TAKEN THREE TIMES, as it is in
// `coach.spec.ts`: `plan_versions` before the review, after the review, and
// after the accept. PRD §15/§89 say the reviewer never changes a plan, and
// that is a claim about a write that DOESN'T happen — which nothing but a
// count can see.
//
// THE WEEK REVIEWED IS LAST WEEK. A partially-elapsed week aggregates only as
// far as `coverage.to = min(weekEnd, now)`, so a "Monday to today" fixture
// makes every number depend on the day and hour CI runs — the workout moved to
// Saturday is simply absent on a Wednesday. See `weekly.helper.ts`.
//
// The stack is `base + dev + fake-openai` with `WEEKLY_REVIEW_CRON_DISABLED=true`
// (see docs/TESTING.md): an hourly sweep writing reviews for every seeded user
// turns a deterministic assertion into a race.
// =============================================================================

const AI_TIMEOUT = 30_000;

interface Fixture extends SeededWeek {
  /** The Monday of the week the plan is made FOR — the one after the review. */
  planWeek: string;
}

/**
 * Sign in, turn AI on, seed last week, and generate its review.
 *
 * AI is enabled explicitly rather than assumed: `ai_settings` ships disabled,
 * and a review that quietly fell back to its template would look, from the
 * outside, exactly like a coach that chose not to propose anything.
 */
async function signInWithAWeek(page: Page, prefix: string): Promise<Fixture> {
  await loginAsTestUser(page, {
    email: uniqueEmail(prefix),
    role: 'admin',
    withAiKey: true,
  });

  await enableAi(page);
  const week = await seedMixedWeek(page);

  return { ...week, planWeek: addDays(week.weekStart, 7) };
}

test.describe('E10 — the weekly loop', () => {
  test('the review shows the week’s real numbers and a labelled pattern', async ({
    page,
  }) => {
    const fixture = await signInWithAWeek(page, 'e10-review');

    const review = await generateReview(page, fixture.weekStart);
    expect(review.status).toBe('READY');
    expect(review.aiSummary?.source).toBe('ai');

    // The epic's own numbers. A rescheduled intention is counted ONCE — three
    // HEALTH rows carry the same workout and `planned` must see one week's
    // worth of intent, not one per row.
    expect(review.aggregates.domains.WORK).toMatchObject({
      planned: 5,
      completed: 4,
      skipped: 1,
    });
    expect(review.aggregates.domains.FAMILY).toMatchObject({ planned: 3, completed: 2 });
    expect(review.aggregates.domains.HEALTH).toMatchObject({
      planned: 3,
      completed: 2,
      rescheduled: 2,
      fallbackUsed: 1,
    });
    expect(review.aggregates.rescheduleLeaders[0]).toMatchObject({
      title: 'Strength workout',
      rescheduleCount: 2,
    });

    // An internal telemetry pointer must not reach a client.
    expect(review).not.toHaveProperty('invocationId');

    await page.goto(`/progress/week?weekStart=${fixture.weekStart}`);

    // The UI counts are the API's counts.
    await expect(page.getByTestId('week-tile-WORK')).toContainText('4 / 5');
    await expect(page.getByTestId('week-tile-FAMILY')).toContainText('2 / 3');
    await expect(page.getByTestId('week-tile-HEALTH')).toContainText('2 / 3');

    // PRD §14.4: the observation is labelled as one, separately from the guess.
    const pattern = page.getByTestId('review-pattern');
    await expect(pattern).toBeVisible();
    await expect(pattern).toContainText('Observation');
    await expect(pattern).toContainText(/morning/i);

    const proposal = page.getByTestId('review-proposal');
    await expect(proposal).toBeVisible();
    await expect(proposal).toContainText(/Saturday/i);
  });

  test('accepting the recommendation is what makes v2 — nothing before it does', async ({
    page,
  }) => {
    const fixture = await signInWithAWeek(page, 'e10-accept');

    const before = await versionsFor(page, fixture.health.planId);
    expect(before).toHaveLength(1);

    await generateReview(page, fixture.weekStart);

    // The whole protocol, in one assertion: the reviewer proposed a change and
    // the plan is untouched.
    expect(await versionsFor(page, fixture.health.planId)).toHaveLength(1);

    await page.goto(`/progress/week?weekStart=${fixture.weekStart}`);
    const proposal = page.getByTestId('review-proposal');
    await expect(proposal).toBeVisible({ timeout: AI_TIMEOUT });

    await proposal.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByText(/Plan updated \(v2\)/)).toBeVisible({ timeout: AI_TIMEOUT });

    const after = (await versionsFor(page, fixture.health.planId)) as Array<{
      version: number;
      status: string;
    }>;
    expect(after).toHaveLength(2);
    expect(after.find((v) => v.version === 2)?.status).toBe('ACTIVE');
    expect(after.find((v) => v.version === 1)?.status).toBe('SUPERSEDED');
  });

  test('planning the next week warns at the cap and materialises on approve', async ({
    page,
  }) => {
    const fixture = await signInWithAWeek(page, 'e10-plan');
    await generateReview(page, fixture.weekStart);

    // Accept the move first: the Saturday morning workout the wizard
    // materialises only exists because v2 put it there.
    await page.goto(`/progress/week?weekStart=${fixture.weekStart}`);
    const proposal = page.getByTestId('review-proposal');
    await expect(proposal).toBeVisible({ timeout: AI_TIMEOUT });
    await proposal.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByText(/Plan updated \(v2\)/)).toBeVisible({ timeout: AI_TIMEOUT });

    // The CTA goes to the wizard. The plan itself is created for the week
    // AFTER the reviewed one, so approving it closes that review.
    await page.getByTestId('review-approve-next-week').click();
    await expect(page).toHaveURL(/\/progress\/week\/plan$/);

    const plan = await apiPost<{ id: string }>(page, '/api/weekly/plans', {
      weekStart: fixture.planWeek,
    });
    await page.goto(`/progress/week/plan?planId=${plan.id}`);
    await expect(page.getByTestId('weekly-plan-wizard')).toBeVisible();

    // Step 1 — a travel day on the Wednesday.
    // Exactly one chip in the week is a Wednesday, so the weekday alone
    // identifies it — the chip's own label format is the browser's locale's.
    await page.getByRole('button', { name: /^Wed/ }).click();
    await next(page);

    // Step 2 — one focus.
    await page.getByTestId('wizard-focus').fill('Ship the proposal draft');
    await next(page);

    // Step 3 — FAMILY eases off.
    await page
      .getByRole('group', { name: 'Family' })
      .getByRole('button', { name: 'Maintain' })
      .click();
    await next(page);

    // Step 4 — the API's own materialisation, travel day and all.
    await expect(page.getByTestId('wizard-load-summary')).toContainText(
      '2 recurring commitments',
    );
    await expect(page.getByText('Travel day').first()).toBeVisible();
    await expect(page.getByTestId('wizard-load-warning')).toHaveCount(0);

    // Two routines plus seven recurring extras is nine — one past the default
    // cap of eight. Read from the environment rather than hard-coded, so the
    // assertion follows `WEEKLY_LOAD_SOFT_CAP` if a deployment moves it.
    const softCap = Number(process.env.WEEKLY_LOAD_SOFT_CAP ?? 8);
    for (let i = 0; i < softCap - 1; i += 1) {
      await addRecurringExtra(page, `Extra ${i}`);
    }

    const warning = page.getByTestId('wizard-load-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(`${softCap + 1} recurring commitments`);

    await next(page);

    // Approve is gated on having READ the warning, not on the week being light.
    const approve = page.getByTestId('wizard-approve');
    await expect(approve).toBeDisabled();
    await page.getByTestId('wizard-ack-warnings').click();
    await expect(approve).toBeEnabled();

    await approve.click();
    await expect(page).toHaveURL(/\/progress\/week$/);
    await expect(page.getByText(/Next week approved/)).toBeVisible();

    // The week is on the calendar, and the workout is on a Saturday morning
    // because v2 moved it there.
    const created = await listCommitmentsBetween(
      page,
      atUtc(fixture.planWeek, '00:00'),
      atUtc(addDays(fixture.planWeek, 6), '23:59'),
    );
    const focus = created.filter((row) => row.title === 'Morning focus block');
    const workouts = created.filter((row) => row.title === 'Strength workout');

    expect(created.every((row) => row.status === 'PLANNED')).toBe(true);
    // Monday, Tuesday, Thursday, Friday — Wednesday is the travel day.
    expect(focus).toHaveLength(4);
    expect(workouts.some((row) => row.scheduledStart.startsWith(addDays(fixture.planWeek, 5)))).toBe(
      true,
    );

    expect(
      (await domainModes(page)).find((row) => row.domain === 'FAMILY')?.mode,
    ).toBe('MAINTAIN');
    expect((await currentReview(page))?.status).toBe('APPROVED');
  });

  test('the review still renders with the provider unreachable', async ({ page }) => {
    const fixture = await signInWithAWeek(page, 'e10-ai-down');

    // Point the provider at a closed port. PRD §120: the numbers are the same
    // and the screen still works; only the coach's reading of them is missing.
    await pointProviderAt(page, 'http://127.0.0.1:1/v1');

    try {
      const review = await generateReview(page, fixture.weekStart);

      expect(review.status).toBe('READY');
      expect(review.aiSummary?.source).toBe('template');
      expect(review.proposals).toHaveLength(0);

      await page.goto(`/progress/week?weekStart=${fixture.weekStart}`);

      await expect(page.getByTestId('review-template-notice')).toContainText(
        /coach was unavailable/i,
      );
      // The counts are untouched by the outage.
      await expect(page.getByTestId('week-tile-WORK')).toContainText('4 / 5');
      await expect(page.getByTestId('review-proposal')).toHaveCount(0);
    } finally {
      await pointProviderAt(page, null);
    }
  });

  test('the weekly rhythm is chosen from settings', async ({ page }) => {
    await loginAsTestUser(page, { email: uniqueEmail('e10-rhythm'), role: 'contributor' });

    await page.goto('/settings');
    await page.getByText('Weekly rhythm', { exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/weekly-rhythm$/);

    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Friday' }).click();
    await page.getByTestId('rhythm-time').fill('16:00');
    await page.getByTestId('rhythm-save').click();

    await expect(page.getByText('Weekly rhythm saved')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('rhythm-time')).toHaveValue('16:00');
    expect(await weeklySettings(page)).toMatchObject({
      weeklyReviewWeekday: 5,
      weeklyReviewTime: '16:00',
    });
  });

  test.describe('on a phone', () => {
    test('the tiles stack under a back arrow, with the bottom bar still there', async ({
      page,
    }, testInfo) => {
      // The `mobile-chromium` project, not a viewport override: the repo gates
      // its phone assertions this way (`navigation.spec.ts`), and a Desktop
      // Chrome context resized to 375px is not the same thing as a phone.
      test.skip(
        testInfo.project.name !== 'mobile-chromium',
        'The bottom bar exists below sm only',
      );

      const fixture = await signInWithAWeek(page, 'e10-phone');
      await generateReview(page, fixture.weekStart);

      await page.goto(`/progress/week?weekStart=${fixture.weekStart}`);

      await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
      await expect(page.getByText('Your Week').first()).toBeVisible();
      // The bottom bar stays: this is a screen, not a full-screen activity —
      // unlike E09's workout runner, which unmounts the shell.
      await expect(page.locator('.MuiBottomNavigation-root')).toBeVisible();

      const work = await page.getByTestId('week-tile-WORK').boundingBox();
      const family = await page.getByTestId('week-tile-FAMILY').boundingBox();
      // Stacked, not side by side.
      expect(family!.y).toBeGreaterThan(work!.y + work!.height - 1);
    });
  });
});

/** Every version of a plan, newest first. */
async function versionsFor(page: Page, planId: string): Promise<unknown[]> {
  const response = await page.request.get(`/api/plans/${planId}/versions`, {
    headers: { Authorization: `Bearer ${await accessToken(page)}` },
  });

  return ((await response.json()) as { data: unknown[] }).data;
}

/**
 * Advance one step.
 *
 * Waits for the button BEFORE clicking, never after: the step it lands on may
 * not have a Next at all (the last one has Approve), so asserting the same
 * button afterwards is a race against the wizard doing its job.
 *
 * The count check is for the vertical stepper below `sm`. `StepContent`
 * unmounts a collapsed step only once its exit transition has finished, so for
 * a few hundred milliseconds after a click the outgoing step's Next is still in
 * the DOM — and a strict locator resolves to two. Waiting for one is waiting
 * for the collapse to settle.
 */
async function next(page: Page): Promise<void> {
  const button = page.getByTestId('wizard-next');
  await expect(button).toHaveCount(1);
  await expect(button).toBeEnabled();
  await button.click();
}

async function addRecurringExtra(page: Page, title: string): Promise<void> {
  await page.getByTestId('wizard-add-commitment').click();
  await page.getByLabel('What are you committing to?').fill(title);
  await page.getByLabel('This is a habit I want to repeat').click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/**
 * Point the deployment's provider somewhere, and check that it took — the same
 * reason `family.spec.ts` asserts its own write: `ai_settings` is system-wide
 * and version-checked, so a stale `If-Match` makes the PUT a silent 412 and the
 * "coach is down" test would pass against a perfectly reachable coach.
 */
async function pointProviderAt(page: Page, baseUrl: string | null): Promise<void> {
  const token = await accessToken(page);
  const current = await page.request.get('/api/ai-settings', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(current.ok(), 'reading the AI settings').toBe(true);

  const etag = current.headers()['etag'];
  const { platformKey: _status, ...writable } = ((await current.json()) as {
    data: Record<string, unknown>;
  }).data;

  const written = await page.request.put('/api/ai-settings', {
    headers: { Authorization: `Bearer ${token}`, ...(etag ? { 'If-Match': etag } : {}) },
    data: { ...writable, baseUrl },
  });

  expect(
    written.ok(),
    `writing baseUrl=${baseUrl} → ${written.status()}: ${await written.text()}`,
  ).toBe(true);
}
