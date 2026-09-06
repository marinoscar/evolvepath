import { expect, test, type Page } from '@playwright/test';

import { loginAsTestUser } from '../helpers/auth.helper';
import { seriousAxeViolations, uniqueEmail } from '../helpers/path.helper';
import {
  getMilestones,
  getProgress,
  NO_SCORE_PATTERNS,
  runJob,
  seedHistory,
  seedRoutinePlan,
} from '../helpers/progress.helper';

// =============================================================================
// E11 Progress end to end (issue #121)
// =============================================================================
//
// PRD §53 asks for a momentum formula that is "deterministic and testable" and
// §54 forbids a score. Both are only really provable here: a unit test can pin
// the engine, but only a browser against a real database can show that the
// STATE the engine computed is the state the user reads, and that no rendered
// pixel anywhere carries a percentage.
//
// Two properties this file exists to prove, neither of which a unit test can:
//
//   1. THE UI AND THE API AGREE. Every momentum assertion below is made twice —
//      once against the screen, once against `GET /api/progress`.
//   2. THERE IS NO SCORE. The whole `body.innerText` of three routes is swept
//      for `N/100`, a percentage and the word "score".
//
// SEEDED THROUGH THE API, never the database, and a FRESH USER PER TEST: the
// suite is `fullyParallel` against one database, so a shared email would make
// every count assertion a race.
// =============================================================================

async function signIn(page: Page, prefix: string): Promise<string> {
  const email = uniqueEmail(prefix);
  await loginAsTestUser(page, { email, role: 'contributor' });
  return email;
}

/** HEALTH: 5 of 6 kept, one at the minimum size. WORK: 3 kept then 3 skipped. */
async function seedTwoDomains(page: Page) {
  const health = await seedRoutinePlan(page, {
    domain: 'HEALTH',
    outcomeTitle: 'Three workouts a week',
    routineTitle: 'Strength workout',
    minimumMinutes: 12,
    fallbackBehavior: '12-minute bodyweight circuit',
  });

  await seedHistory(page, {
    domain: 'HEALTH',
    plan: health,
    title: 'Strength workout',
    commitmentType: 'workout',
    days: [
      { offset: 20, outcome: 'complete' },
      { offset: 17, outcome: 'complete' },
      { offset: 13, outcome: 'complete' },
      { offset: 10, outcome: 'complete_min' },
      { offset: 6, outcome: 'complete' },
      { offset: 3, outcome: 'leave' },
    ],
  });

  const work = await seedRoutinePlan(page, {
    domain: 'WORK',
    outcomeTitle: 'Ship the proposal',
    routineTitle: 'Morning focus block',
    minimumMinutes: 10,
    importance: 4,
  });

  await seedHistory(page, {
    domain: 'WORK',
    plan: work,
    title: 'Morning focus block',
    days: [
      { offset: 21, outcome: 'complete' },
      { offset: 18, outcome: 'complete' },
      { offset: 14, outcome: 'complete' },
      { offset: 8, outcome: 'skip' },
      { offset: 5, outcome: 'skip' },
      { offset: 2, outcome: 'skip' },
    ],
  });

  return { health, work };
}

test.describe('E11 Progress', () => {
  test('renders the state the engine computed, for each domain', async ({ page }) => {
    await signIn(page, 'progress-states');
    await seedTwoDomains(page);

    await page.goto('/progress');

    const health = page.getByTestId('progress-momentum-HEALTH');
    await expect(health).toBeVisible();
    await expect(health.getByTestId('progress-momentum-state')).toHaveText(
      /Steady|Improving/,
    );
    await expect(health.getByTestId('progress-evidence-bullet').first()).toHaveText(
      /5 of 6 planned (workouts|health commitments) completed/,
    );
    await expect(
      health.getByTestId('progress-evidence-bullet').filter({
        hasText: /completed with the short or minimum version/,
      }),
    ).toHaveCount(1);

    const work = page.getByTestId('progress-momentum-WORK');
    await expect(work.getByTestId('progress-momentum-state')).toHaveText('Slipping');
    await expect(
      work.getByTestId('progress-evidence-bullet').filter({ hasText: '3 in a row not started' }),
    ).toHaveCount(1);

    const family = page.getByTestId('progress-momentum-FAMILY');
    await expect(family.getByTestId('progress-momentum-state')).toHaveText('Not enough yet');

    // The API agrees. If these ever diverge, the screen is lying about the
    // engine — which is the whole failure mode this pairing exists to catch.
    const api = await getProgress(page);
    expect(['STEADY', 'IMPROVING']).toContain(api.momentum.HEALTH.state);
    expect(api.momentum.WORK.state).toBe('SLIPPING');
    expect(api.momentum.FAMILY.state).toBe('INSUFFICIENT_DATA');
    expect(api.momentum.HEALTH.signals).toMatchObject({
      planned: 6,
      completed: 5,
      fallback: 1,
    });
  });

  test('renders no score, no percentage and no "/100" anywhere', async ({ page }) => {
    await signIn(page, 'progress-noscore');
    await seedTwoDomains(page);

    for (const route of ['/progress', '/progress/timeline', '/']) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      const text = await page.locator('body').innerText();
      for (const pattern of NO_SCORE_PATTERNS) {
        expect(text, `${route} rendered a forbidden ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  test('shows the evidence timeline, and the full list behind it', async ({ page }) => {
    await signIn(page, 'progress-timeline');
    await seedTwoDomains(page);

    await page.goto('/progress');

    const timeline = page.getByTestId('progress-timeline');
    await expect(timeline).toBeVisible();
    // The fallback completion is LABELLED, not diminished (PRD §44).
    await expect(
      timeline.getByText(/Completed Strength workout — minimum version/),
    ).toBeVisible();

    await page.getByRole('link', { name: 'See all' }).click();
    await expect(page).toHaveURL(/\/progress\/timeline$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Evidence' })).toBeVisible();

    // Filtering is a SERVER round trip; a Health filter cannot show Work rows.
    await page.getByRole('button', { name: 'Health' }).click();
    await expect(page.getByText('Completed Morning focus block')).toHaveCount(0);
    await expect(page.getByText(/Completed Strength workout/).first()).toBeVisible();
  });

  test('counts the run in weeks and says what recovery is not yet known', async ({ page }) => {
    await signIn(page, 'progress-consistency');
    await seedTwoDomains(page);

    await page.goto('/progress');

    await expect(page.getByTestId('progress-consistency')).toContainText(
      /\d+ weeks? building momentum|first successful week is ahead/,
    );
    // Nothing is MISSED yet — the sweep has not run — so recovery is unknown
    // rather than zero.
    await expect(page.getByText('No misses to recover from yet')).toBeVisible();
    await expect(
      page.getByText('Available once notifications learn your rhythm.'),
    ).toBeVisible();
  });

  test('celebrates a milestone once, and only once', async ({ page }) => {
    const email = await signIn(page, 'progress-milestone');

    const health = await seedRoutinePlan(page, {
      domain: 'HEALTH',
      outcomeTitle: 'Ten workouts',
      routineTitle: 'Strength workout',
      minimumMinutes: 12,
    });

    await seedHistory(page, {
      domain: 'HEALTH',
      plan: health,
      title: 'Strength workout',
      commitmentType: 'workout',
      days: Array.from({ length: 10 }, (_, i) => ({
        offset: i + 1,
        outcome: 'complete' as const,
      })),
    });

    await runJob(page, 'milestones', email);

    // Ten workouts over ten days also completes a full week, so more than one
    // milestone can be waiting. PRD §77 says they arrive ONE AT A TIME — so the
    // queue is drained one toast at a time and the workouts sentence has to
    // appear somewhere in it, rather than being assumed to be first.
    await page.goto('/progress');
    // The first one has to arrive before the loop can drain: the milestones
    // fetch is async, and `isVisible()` on an empty page is a fast `false`.
    await expect(page.getByTestId('milestone-toast')).toBeVisible();

    const seen: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const toast = page.getByTestId('milestone-toast');
      if (!(await toast.isVisible().catch(() => false))) break;

      seen.push((await toast.innerText()).trim());
      await toast.getByRole('button', { name: /close/i }).click();
      // A closing toast unmounts before the next one mounts; without this the
      // next iteration reads the one that is on its way out.
      await page.waitForTimeout(500);
    }

    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen.join(' | ')).toContain('10 workouts completed');

    // Acknowledged on the SERVER, so it does not come back on the next device.
    await expect(async () => {
      const unseen = await getMilestones(page, true);
      expect(unseen.items).toHaveLength(0);
    }).toPass({ timeout: 10_000 });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('milestone-toast')).toHaveCount(0);
  });

  test('has no serious accessibility violations', async ({ page }) => {
    await signIn(page, 'progress-axe');
    await seedTwoDomains(page);

    for (const route of ['/progress', '/progress/timeline']) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      const violations = await seriousAxeViolations(page);
      expect(violations, `${route} has serious violations`).toEqual([]);
    }
  });
});
