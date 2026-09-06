import { expect, test, type Page } from '@playwright/test';

import { loginAsTestUser } from '../helpers/auth.helper';
import {
  apiGet,
  resetAccessToken,
  seriousAxeViolations,
  uniqueEmail,
  withToken,
} from '../helpers/path.helper';
import {
  evidenceCount,
  getComeback,
  getMilestones,
  getProgress,
  latestEvidenceType,
  pastDueOpenCommitments,
  runJob,
  seedHistory,
  seedRoutinePlan,
  simulateIdle,
  type SeededRoutinePlan,
} from '../helpers/progress.helper';

// =============================================================================
// E11 comeback loop end to end (issue #121)
// =============================================================================
//
// PRD §109 is an acceptance list that is only meaningful in a browser against
// real data:
//
//   * after multiple missed days, overdue items do NOT flood Today;
//   * the user gets a restart experience;
//   * prior misses remain evidence;
//   * one next action is recommended;
//   * plan review becomes available.
//
// Case 1 proves all five at once, and it proves the third by counting
// `evidence_items` through the public API before and after the sweep — the one
// assertion that would catch a sweep that "tidied" a history.
//
// A FRESH USER PER TEST, seeded through the API. `simulate-idle` is the only
// unnatural step and it is a documented non-production helper: every rule this
// loop enforces is about elapsed time, and a suite that could only run at the
// real `now` would have to wait three days.
// =============================================================================

async function signIn(page: Page, prefix: string): Promise<string> {
  const email = uniqueEmail(prefix);
  await loginAsTestUser(page, { email, role: 'contributor' });
  // The API helpers cache one bearer token per PAGE, so signing in as somebody
  // else without this would seed the previous user's data — silently, and only
  // visible as "the sweep offered nothing".
  resetAccessToken(page);
  return email;
}

/** Health kept twice then dropped, Work dropped once — a believable lapse. */
async function seedLapse(
  page: Page,
  options: { leftOpen?: number } = {},
): Promise<{ health: SeededRoutinePlan; work: SeededRoutinePlan }> {
  const health = await seedRoutinePlan(page, {
    domain: 'HEALTH',
    outcomeTitle: 'Three workouts a week',
    routineTitle: 'Strength workout',
    minimumMinutes: 12,
    fallbackBehavior: '12-minute bodyweight circuit',
    importance: 5,
  });

  const leftOpen = options.leftOpen ?? 2;

  await seedHistory(page, {
    domain: 'HEALTH',
    plan: health,
    title: 'Strength workout',
    commitmentType: 'workout',
    days: [
      { offset: 10, outcome: 'complete' },
      { offset: 8, outcome: 'complete' },
      ...Array.from({ length: leftOpen }, (_, i) => ({
        offset: 3 + i,
        outcome: 'leave' as const,
      })),
    ],
  });

  const work = await seedRoutinePlan(page, {
    domain: 'WORK',
    outcomeTitle: 'Ship the proposal',
    routineTitle: 'Morning focus block',
    minimumMinutes: 10,
    importance: 3,
  });

  await seedHistory(page, {
    domain: 'WORK',
    plan: work,
    title: 'Morning focus block',
    days: [{ offset: 2, outcome: 'leave' }],
  });

  return { health, work };
}

/** Idle for four days, then the real sweep — the epic's own script. */
async function lapseAndSweep(page: Page, email: string) {
  const before = await evidenceCount(page);
  await simulateIdle(page, email, 4);
  const result = await runJob(page, 'comeback', email);
  return { before, result };
}

test.describe('E11 comeback loop', () => {
  test('closes stale intentions as history, and never as a backlog', async ({ page }) => {
    const email = await signIn(page, 'comeback-sweep');
    await seedLapse(page);

    const { before, result } = await lapseAndSweep(page, email);

    expect(result.trigger).toBe('INACTIVITY');
    expect(result.comebackState).toBe('OFFERED');
    expect(result.closedCount).toBe(3);

    // PRD §109: no overdue flood.
    expect(await pastDueOpenCommitments(page)).toEqual([]);

    // PRD §109: prior misses remain evidence. The sweep changes status and
    // NOTHING else — this is the assertion that catches a sweep that tidied.
    expect(await evidenceCount(page)).toBe(before);

    await page.goto('/');
    const banner = page.getByTestId('today-comeback-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Welcome back. No catching up.');

    // Nothing on the day screen names or counts what was missed.
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/overdue|\d+ missed|you are behind/i);
  });

  test('walks the three screens to Back on Path', async ({ page }) => {
    const email = await signIn(page, 'comeback-flow');
    await seedLapse(page);
    await lapseAndSweep(page, email);

    await page.goto('/');
    await page.getByRole('button', { name: 'Restart with one thing' }).click();
    await expect(page).toHaveURL(/\/comeback$/);

    // Screen 1 — PRD §57's first sentence.
    await expect(page.getByTestId('comeback-step-1')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 1, name: "You're still on the Path." }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Screen 2 — the question, the recommendation, and one alternative.
    const step2 = page.getByTestId('comeback-step-2');
    await expect(step2).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Which area feels most important to restart?' }),
    ).toBeVisible();
    await expect(page.getByTestId('comeback-recommended')).toContainText('Recommended');
    await expect(page.getByTestId('comeback-choose-WORK')).toBeVisible();

    await page.getByTestId('comeback-take-recommendation').click();

    // Screen 3 — one small thing, sized 10–15 minutes.
    const step3 = page.getByTestId('comeback-step-3');
    await expect(step3).toBeVisible();
    await expect(step3).toContainText(/1[0-5] min/);

    await page.getByTestId('comeback-start').click();
    await expect(page).toHaveURL(/\/start\/[0-9a-f-]+$/);

    // The ordinary execution screen, unchanged.
    await page.getByRole('button', { name: /^Begin/ }).first().click();
    await page.getByRole('button', { name: 'Done for now' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();

    await expect(page).toHaveURL(/\/comeback\/done$/);
    await expect(page.getByTestId('comeback-done')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Back on Path.' })).toBeVisible();
    await expect(
      page.getByText('The important part was not that you missed. It was that you returned.'),
    ).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('First comeback');

    // The record, read back through the public API.
    await expect(async () => {
      expect((await getComeback(page)).state).toBe('NONE');
      expect(await latestEvidenceType(page)).toBe('recovery');
    }).toPass({ timeout: 10_000 });

    const milestones = await getMilestones(page);
    const firstComeback = milestones.items.find((row) => row.kind === 'FIRST_COMEBACK');
    expect(firstComeback).toBeTruthy();
    // Celebrated HERE, so `/progress` does not repeat it (PRD §77).
    expect(firstComeback?.acknowledgedAt).not.toBeNull();

    await page.goto('/');
    await expect(page.getByTestId('today-comeback-banner')).toHaveCount(0);
  });

  test('reads RECOVERING after a return, on Progress and on Today', async ({ page }) => {
    const email = await signIn(page, 'comeback-momentum');

    // A believable shape of lapse, and it has to be built in TWO shifts.
    // `seedHistory` completes a past commitment at the real `now`, so a single
    // shift would leave every completion at the same recent instant and the
    // misses BEFORE it — which is not a lapse, it is a history running
    // backwards. Pushing the completions away first, then seeding the misses,
    // then shifting again, produces the real order: kept, kept, then silence.
    const health = await seedRoutinePlan(page, {
      domain: 'HEALTH',
      outcomeTitle: 'Three workouts a week',
      routineTitle: 'Strength workout',
      minimumMinutes: 12,
      fallbackBehavior: '12-minute bodyweight circuit',
      importance: 5,
    });

    await seedHistory(page, {
      domain: 'HEALTH',
      plan: health,
      title: 'Strength workout',
      commitmentType: 'workout',
      days: [
        { offset: 2, outcome: 'complete' },
        { offset: 4, outcome: 'complete' },
      ],
    });

    await simulateIdle(page, email, 8);

    await seedHistory(page, {
      domain: 'HEALTH',
      plan: health,
      title: 'Strength workout',
      commitmentType: 'workout',
      days: [
        { offset: 1, outcome: 'leave' },
        { offset: 2, outcome: 'leave' },
        { offset: 3, outcome: 'leave' },
      ],
    });

    await lapseAndSweep(page, email);

    await page.goto('/comeback');
    await expect(page.getByTestId('comeback-step-1')).toBeVisible();
    // Wait for the step, not for the button: a direct navigation boots the
    // whole shell, and clicking into a tree that is still settling races the
    // remount rather than testing anything.
    await expect(page.getByTestId('comeback-step-1')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByTestId('comeback-take-recommendation').click();
    await page.getByTestId('comeback-start').click();
    await page.getByRole('button', { name: /^Begin/ }).first().click();
    await page.getByRole('button', { name: 'Done for now' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByTestId('comeback-done')).toBeVisible();

    await expect(async () => {
      const progress = await getProgress(page);
      expect(progress.momentum.HEALTH.state).toBe('RECOVERING');
      expect(progress.momentum.HEALTH.evidence.join(' ')).toMatch(
        /Returned \d+ days? after a miss/,
      );
    }).toPass({ timeout: 15_000 });

    const today = await apiGet<{ momentum: Record<string, { state: string }> }>(
      page,
      '/api/today',
    );
    expect(today.momentum.HEALTH.state).toBe('RECOVERING');
  });

  test('lets the user restart somewhere else instead', async ({ page }) => {
    const email = await signIn(page, 'comeback-choose');
    await seedLapse(page);
    await lapseAndSweep(page, email);

    await page.goto('/comeback');
    // Wait for the step, not for the button: a direct navigation boots the
    // whole shell, and clicking into a tree that is still settling races the
    // remount rather than testing anything.
    await expect(page.getByTestId('comeback-step-1')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByTestId('comeback-choose-WORK').click();

    await expect(page.getByTestId('comeback-step-3')).toBeVisible();

    await expect(async () => {
      const status = await getComeback(page);
      expect(status.restart?.domain).toBe('WORK');
    }).toPass({ timeout: 10_000 });

    // The offer that was replaced is cancelled, not left lying around.
    const cancelled = await apiGet<unknown[]>(
      page,
      `/api/commitments?from=${encodeURIComponent(
        new Date(Date.now() - 5 * 86_400_000).toISOString(),
      )}&to=${encodeURIComponent(
        new Date(Date.now() + 5 * 86_400_000).toISOString(),
      )}&status=CANCELLED`,
    );
    expect(cancelled.length).toBeGreaterThanOrEqual(1);
  });

  test('offers a plan review when the misses look like plan drift', async ({ page }) => {
    const email = await signIn(page, 'comeback-planreview');
    await seedLapse(page, { leftOpen: 5 });

    const { result } = await lapseAndSweep(page, email);
    expect(result.closedCount).toBeGreaterThanOrEqual(5);

    const status = await getComeback(page);
    expect(status.planReviewSuggested).toBe(true);

    await page.goto('/comeback');
    // Wait for the step, not for the button: a direct navigation boots the
    // whole shell, and clicking into a tree that is still settling races the
    // remount rather than testing anything.
    await expect(page.getByTestId('comeback-step-1')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByTestId('comeback-take-recommendation').click();
    await page.getByTestId('comeback-start').click();
    await page.getByRole('button', { name: /^Begin/ }).first().click();
    await page.getByRole('button', { name: 'Done for now' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();

    await expect(page.getByTestId('comeback-done')).toBeVisible();
    await page.getByRole('button', { name: 'Review my plan' }).click();
    await expect(page).toHaveURL(/\/coach$/);
  });

  test('lets the user decline being helped', async ({ page }) => {
    const email = await signIn(page, 'comeback-dismiss');
    await seedLapse(page);
    await lapseAndSweep(page, email);

    await page.goto('/');
    await expect(page.getByTestId('today-comeback-banner')).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss' }).click();

    await expect(page.getByTestId('today-comeback-banner')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('today-comeback-banner')).toHaveCount(0);
    expect((await getComeback(page)).state).toBe('NONE');
  });

  test('has no serious accessibility violations on any step', async ({ page }) => {
    const email = await signIn(page, 'comeback-axe');
    await seedLapse(page);
    await lapseAndSweep(page, email);

    await page.goto('/comeback');
    await expect(page.getByTestId('comeback-step-1')).toBeVisible();
    expect(await seriousAxeViolations(page)).toEqual([]);

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('comeback-step-2')).toBeVisible();
    expect(await seriousAxeViolations(page)).toEqual([]);

    await page.getByTestId('comeback-take-recommendation').click();
    await expect(page.getByTestId('comeback-step-3')).toBeVisible();
    expect(await seriousAxeViolations(page)).toEqual([]);
  });
});

// =============================================================================
// The loop with the provider unreachable
// =============================================================================
//
// PRD §120 makes this structural rather than aspirational: the restart is
// chosen by a pure function and only its WORDING is ever asked of a model, so
// with the provider gone the flow is identical and the title falls back to the
// routine's own fallback text.
// =============================================================================

test.describe('E11 comeback with the coach unreachable', () => {
  const UNREACHABLE = 'http://127.0.0.1:1/v1';

  /**
   * Point the provider somewhere, and CHECK THAT IT TOOK.
   *
   * Copied from `today.spec.ts`, and for the reason recorded there: `PUT
   * /ai-settings` is a FULL replace, so `{ baseUrl }` alone is a 400 and the
   * base URL never moves — leaving the coach perfectly reachable, which is the
   * one condition this whole block exists to rule out.
   */
  async function setBaseUrl(page: Page, baseUrl: string | null) {
    const current = await withToken(page, (token) =>
      page.request.get('/api/ai-settings', { headers: { Authorization: `Bearer ${token}` } }),
    );
    expect(current.ok(), 'reading the AI settings').toBe(true);

    const etag = current.headers()['etag'];
    const settings = ((await current.json()) as { data: Record<string, unknown> }).data;
    const { platformKey: _status, ...writable } = settings;

    const written = await withToken(page, (token) =>
      page.request.put('/api/ai-settings', {
        headers: { Authorization: `Bearer ${token}`, ...(etag ? { 'If-Match': etag } : {}) },
        data: { ...writable, baseUrl },
      }),
    );

    expect(
      written.ok(),
      `writing baseUrl=${baseUrl} → ${written.status()}: ${await written.text()}`,
    ).toBe(true);
  }

  test('still offers a restart, worded from the routine itself', async ({ page }) => {
    // A fresh ADMIN, who owns the seeded plan as well as the settings: one
    // session, one user, nothing another test can see.
    const email = uniqueEmail('comeback-nocoach');
    await loginAsTestUser(page, { email, role: 'admin' });
    resetAccessToken(page);

    await seedLapse(page);
    await setBaseUrl(page, UNREACHABLE);

    try {
      await lapseAndSweep(page, email);

      await page.goto('/comeback');
      await expect(page.getByTestId('comeback-step-1')).toBeVisible();
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByTestId('comeback-take-recommendation').click();

      const step3 = page.getByTestId('comeback-step-3');
      await expect(step3).toBeVisible();
      // The routine's OWN fallback wording, not the model's — the restart is
      // chosen by a pure function and only its wording is ever asked of a
      // model (PRD §120).
      await expect(
        page.getByRole('heading', { level: 1, name: '12-minute bodyweight circuit' }),
      ).toBeVisible();
      await expect(step3).toContainText('No catching up. We start from today.');

      // And the whole loop still finishes.
      await page.getByTestId('comeback-start').click();
      await page.getByRole('button', { name: /^Begin/ }).first().click();
      await page.getByRole('button', { name: 'Done for now' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Back on Path.' })).toBeVisible();
    } finally {
      await setBaseUrl(page, null);
    }
  });
});
