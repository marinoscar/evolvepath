import { test, expect, type Page } from '@playwright/test';

import { loginAsTestUser } from '../helpers/auth.helper';
import { uniqueEmail, withToken } from '../helpers/path.helper';
import {
  createCommitment,
  createOutcome,
  getCommitment,
} from '../helpers/commitments.helper';
import { createRitual } from '../helpers/family.helper';
import {
  getMetrics,
  getPolicy,
  inbox,
  inboxFor,
  metricsFor,
  minutesFromNow,
  runCoachingJob,
  setPolicy,
} from '../helpers/notifications.helper';

// =============================================================================
// E12 — coaching notifications, end to end (issue #75)
// =============================================================================
//
// PRD §108's acceptance list, proved through a browser against the real API,
// the real database and the real scheduler:
//
//   1. quiet hours respected
//   2. the action deep link works
//   3. move and skip from the notification itself
//   4. ignored notifications tracked
//   5. no uncontrolled repeats per commitment
//   6. comeback copy without shame
//
// -----------------------------------------------------------------------------
// THE JOB IS INVOKED, NEVER WAITED FOR
// -----------------------------------------------------------------------------
//
// The scheduler ticks every five minutes. A spec that waited for it would be a
// five-minute spec that still raced the tick, so every case calls
// `POST /api/auth/test/run-job` — the SAME `runOnce` the cron calls, not a
// stand-in — and passes `now` where the case is about a moment other than this
// one. That is the only reason "at the scheduled start" is assertable at all.
//
// -----------------------------------------------------------------------------
// A FRESH USER PER TEST
// -----------------------------------------------------------------------------
//
// The suite is `fullyParallel` against one database, and every assertion here
// counts rows in one person's inbox. A shared email is a shared inbox and every
// count becomes a race.
//
// -----------------------------------------------------------------------------
// WHAT IS ASSERTED ABOUT THE COPY, AND WHAT IS NOT
// -----------------------------------------------------------------------------
//
// With the fake OpenAI server up, the copywriter's words are the fake server's,
// so the cases below assert on BUTTONS, LINKS and INTERACTION ROWS. Exact
// wording is asserted only where the deterministic template is the one that must
// run — the coach-unreachable case — which is also the case that matters most.
// =============================================================================

/** The banned vocabulary, mirrored from `copy/banned-phrases.ts` (PRD §129). */
const BANNED = [
  /disappoint/i,
  /let\s+(me|us|them|yourself|everyone)\s+down/i,
  /you\s+promised/i,
  /\bshame\b/i,
  /\bguilt\b/i,
  /last\s+chance/i,
  /don'?t\s+miss/i,
  /\bmiss(ed|ing)?\s+you\b/i,
  /!{2,}/,
];

async function signIn(page: Page, prefix: string) {
  await loginAsTestUser(page, {
    email: uniqueEmail(prefix),
    role: 'admin',
    withAiKey: true,
  });
}

/** A HEALTH commitment with all three sizes, `minutes` from now. */
async function seedWorkout(page: Page, minutes: number, title = 'Upper A') {
  const outcome = await createOutcome(page, {
    domain: 'HEALTH',
    title: 'Train consistently',
    whyItMatters: 'Energy',
  });

  return createCommitment(page, {
    domain: 'HEALTH',
    title,
    outcomeId: outcome.id,
    scheduledStart: minutesFromNow(minutes),
    importance: 4,
    fullVersion: title,
    fullMinutes: 38,
    shortVersion: `${title} short`,
    shortMinutes: 20,
    minimumVersion: `10-minute ${title}`,
    minimumMinutes: 10,
  });
}

/** Open the bell and wait for its popover. */
async function openBell(page: Page) {
  await page.goto('/');
  await page.getByTestId('notification-bell').click();
}

test.describe('E12 — the coaching engine', () => {
  // ===========================================================================
  // 1. The whole path: a reminder becomes a completed workout
  // ===========================================================================
  test('a reminder deep-links to the Start flow and records the action', async ({ page }) => {
    await signIn(page, 'e12-start');
    const commitment = await seedWorkout(page, 20);

    expect(await runCoachingJob(page)).toMatchObject({ sent: 1, suppressed: 0 });

    // The row exists, with the buttons PRD §63 names.
    await expect
      .poll(async () => (await inboxFor(page, 'coach.commitment_upcoming')).length)
      .toBe(1);

    await openBell(page);
    const row = page.getByTestId('notification-row-coach.commitment_upcoming');
    await expect(row).toBeVisible();
    await expect(row.getByTestId('notification-action-start')).toBeVisible();
    await expect(row.getByTestId('notification-action-move')).toBeVisible();
    await expect(row.getByTestId('notification-action-skip')).toBeVisible();

    await row.getByTestId('notification-action-start').click();

    // Landed on the action, not on a screen from which the action can be found.
    await page.waitForURL(new RegExp(`/start/${commitment.id}`));

    await page.getByRole('button', { name: /begin/i }).click();

    await expect
      .poll(async () => metricsFor(await getMetrics(page, 7), 'coach.commitment_upcoming'))
      .toMatchObject({ sent: 1, actioned: 1 });

    const metrics = metricsFor(await getMetrics(page, 7), 'coach.commitment_upcoming');
    expect(metrics.opened).toBeGreaterThanOrEqual(1);
    expect(metrics.ignored).toBe(0);
  });

  // ===========================================================================
  // 2. No uncontrolled repeats — PRD §108
  // ===========================================================================
  test('the same commitment is decided once, however often the job runs', async ({ page }) => {
    await signIn(page, 'e12-once');
    await seedWorkout(page, 20);

    expect(await runCoachingJob(page)).toMatchObject({ sent: 1 });

    // The unique decision index is the guarantee; three more runs prove it.
    expect(await runCoachingJob(page)).toMatchObject({ sent: 0, scanned: 0 });
    expect(await runCoachingJob(page)).toMatchObject({ sent: 0, scanned: 0 });

    expect(await inboxFor(page, 'coach.commitment_upcoming')).toHaveLength(1);
  });

  test('a commitment already finished is suppressed as ALREADY_DONE', async ({ page }) => {
    await signIn(page, 'e12-done');
    const commitment = await seedWorkout(page, 20);

    // Complete it without ever having been reminded.
    await withToken(page, (token) =>
      page.request.post(`/api/commitments/${commitment.id}/actions/complete`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { minutesSpent: 38 },
      }),
    );

    // At the scheduled start the start-cue candidate exists — and is refused.
    const result = await runCoachingJob(page, minutesFromNow(20));

    expect(result.sent).toBe(0);
    await expect
      .poll(async () =>
        metricsFor(await getMetrics(page, 7), 'coach.start_cue').suppressed.ALREADY_DONE,
      )
      .toBeGreaterThanOrEqual(1);
  });

  // ===========================================================================
  // 3. Quiet hours — PRD §108, set from the UI
  // ===========================================================================
  test('quiet hours set on the settings page silence the coach', async ({ page }) => {
    await signIn(page, 'e12-quiet');

    await page.goto('/settings/notifications');
    await expect(page.getByRole('region', { name: /coaching reminders/i })).toBeVisible();

    // A window covering the whole day, so the case cannot depend on when it runs.
    await page.getByTestId('policy-quiet-start').locator('input').fill('00:00');
    await page.getByTestId('policy-quiet-end').locator('input').fill('23:59');
    await page.getByTestId('policy-quiet-end').locator('input').blur();

    await expect
      .poll(async () => (await getPolicy(page)).quietHours)
      .toEqual({ start: '00:00', end: '23:59' });

    await seedWorkout(page, 20);

    expect(await runCoachingJob(page)).toMatchObject({ sent: 0, suppressed: 1 });
    expect(
      metricsFor(await getMetrics(page, 7), 'coach.commitment_upcoming').suppressed
        .QUIET_HOURS,
    ).toBe(1);
    expect(await inboxFor(page, 'coach.commitment_upcoming')).toHaveLength(0);
  });

  // ===========================================================================
  // 4. Skip from the notification, and never be asked again — PRD §61, §108
  // ===========================================================================
  test('skipping from the notification stops the coach for that commitment', async ({
    page,
  }) => {
    await signIn(page, 'e12-skip');
    const commitment = await seedWorkout(page, 20);

    expect(await runCoachingJob(page)).toMatchObject({ sent: 1 });

    await openBell(page);
    await page
      .getByTestId('notification-row-coach.commitment_upcoming')
      .getByTestId('notification-action-skip')
      .click();

    // The deep link lands on Today with the skip dialog open on that row.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /skip/i }).last().click();

    await expect
      .poll(async () => (await getCommitment(page, commitment.id)).status)
      .toBe('SKIPPED');

    // PRD §61: a skip is an answer, not a postponement.
    const atStart = await runCoachingJob(page, minutesFromNow(20));
    expect(atStart.sent).toBe(0);

    await expect
      .poll(async () =>
        metricsFor(await getMetrics(page, 7), 'coach.start_cue').suppressed.SKIPPED,
      )
      .toBeGreaterThanOrEqual(1);

    expect(await inboxFor(page, 'coach.start_cue')).toHaveLength(0);
  });

  // ===========================================================================
  // 5. The per-commitment cap
  // ===========================================================================
  test('one commitment cannot monopolise the day’s budget', async ({ page }) => {
    await signIn(page, 'e12-cap');
    await setPolicy(page, { perCommitmentMax: 1 });
    await seedWorkout(page, 20);

    expect(await runCoachingJob(page)).toMatchObject({ sent: 1 });

    // The start cue would be a second message about the same commitment.
    expect(await runCoachingJob(page, minutesFromNow(20))).toMatchObject({
      sent: 0,
      suppressed: 1,
    });

    expect(
      metricsFor(await getMetrics(page, 7), 'coach.start_cue').suppressed
        .PER_COMMITMENT_MAX,
    ).toBe(1);
  });

  // ===========================================================================
  // 6. The fallback offer picks the smaller version
  // ===========================================================================
  test('a fallback offer starts the short version', async ({ page }) => {
    await signIn(page, 'e12-fallback');

    const outcome = await createOutcome(page, {
      domain: 'HEALTH',
      title: 'Train consistently',
    });

    // Started ten minutes ago, twenty-five minutes of room left: the full 38
    // no longer fits and the 20-minute version does.
    const commitment = await createCommitment(page, {
      domain: 'HEALTH',
      title: 'Upper A',
      outcomeId: outcome.id,
      scheduledStart: minutesFromNow(-10),
      scheduledEnd: minutesFromNow(25),
      fullVersion: 'Upper A',
      fullMinutes: 38,
      shortVersion: 'Upper A short',
      shortMinutes: 20,
      minimumVersion: '10-minute Upper A',
      minimumMinutes: 10,
    });

    expect(await runCoachingJob(page)).toMatchObject({ sent: 1 });
    expect(await inboxFor(page, 'coach.fallback_offer')).toHaveLength(1);

    await openBell(page);
    await page
      .getByTestId('notification-row-coach.fallback_offer')
      .getByTestId('notification-action-short')
      .click();

    await page.waitForURL(new RegExp(`/start/${commitment.id}`));

    await expect
      .poll(async () => (await getCommitment(page, commitment.id)).versionUsed)
      .toBe('SHORT');
  });

  // ===========================================================================
  // 7. The family cue asks the user to show up, not to execute
  // ===========================================================================
  test('"I\'m in" on a family cue marks the ritual ready', async ({ page }) => {
    await signIn(page, 'e12-family');

    const start = new Date(Date.now() + 15 * 60_000);
    const hhmm = `${String(start.getUTCHours()).padStart(2, '0')}:${String(
      start.getUTCMinutes(),
    ).padStart(2, '0')}`;

    await createRitual(page, {
      title: 'Phone-free dinner',
      purpose: 'Mia talks at dinner',
      recurrence: { weekdays: [start.getUTCDay()], time: hhmm, everyNWeeks: 1 },
      idealMinutes: 45,
      minimumMinutes: 10,
    });

    expect(await runCoachingJob(page)).toMatchObject({ sent: 1 });

    const [cue] = await inboxFor(page, 'coach.family_presence');
    expect(cue).toBeDefined();
    // PRD §63's vocabulary, verbatim: a ritual is something you show up to.
    expect(cue.actions.map((action) => action.action)).toEqual(['in', 'move', 'skip']);
    expect(cue.actions[0].label).toBe("I'm in");

    await openBell(page);
    await page
      .getByTestId('notification-row-coach.family_presence')
      .getByTestId('notification-action-in')
      .click();

    const commitmentId = new URL(cue.actions[0].link, 'https://local.invalid').searchParams.get(
      'commitment',
    )!;

    await expect
      .poll(async () => (await getCommitment(page, commitmentId)).status)
      .toBe('READY');
  });

  // ===========================================================================
  // 8. Tone — PRD §129, VISION §12
  // ===========================================================================
  test('no coaching notification uses the banned vocabulary', async ({ page }) => {
    await signIn(page, 'e12-tone');

    await seedWorkout(page, 20);
    await runCoachingJob(page);

    // A second commitment, past its moment, for the fallback wording.
    const outcome = await createOutcome(page, { domain: 'WORK', title: 'Ship the proposal' });
    await createCommitment(page, {
      domain: 'WORK',
      title: 'Draft the storyline',
      outcomeId: outcome.id,
      scheduledStart: minutesFromNow(-10),
      scheduledEnd: minutesFromNow(25),
      fullVersion: 'Draft the storyline',
      fullMinutes: 38,
      shortVersion: 'Write the decision statement',
      shortMinutes: 20,
      minimumVersion: 'Open the doc',
      minimumMinutes: 10,
    });
    await runCoachingJob(page);

    const rows = await inbox(page);
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      for (const pattern of BANNED) {
        expect(pattern.test(row.title), `${pattern} in title: ${row.title}`).toBe(false);
        expect(pattern.test(row.body), `${pattern} in body: ${row.body}`).toBe(false);
      }
    }
  });

  // ===========================================================================
  // 10. Independence — PRD §65
  // ===========================================================================
  test('a completion nobody had to ask for counts as independent', async ({ page }) => {
    await signIn(page, 'e12-independence');

    // Three hours out: far outside every candidate window, so no reminder can
    // exist for it however many times the job runs.
    const commitment = await seedWorkout(page, 180);
    await runCoachingJob(page);

    await withToken(page, (token) =>
      page.request.post(`/api/commitments/${commitment.id}/actions/complete`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { minutesSpent: 38 },
      }),
    );

    await expect
      .poll(async () => (await getMetrics(page, 7)).independence)
      .toMatchObject({ completions: 1, unprompted: 1, ratio: 1 });
  });

  // ===========================================================================
  // 11. Push subscriptions over the API
  // ===========================================================================
  //
  // The dev server registers NO service worker, so there is no browser push to
  // drive here — the worker's own handlers are covered by Vitest and by the
  // production-build check in the epic's manual script. What this case proves is
  // the contract the worker depends on.
  test('a browser can register and remove a push subscription', async ({ page }) => {
    await signIn(page, 'e12-push');

    const endpoint = `https://push.example.test/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;

    const created = await withToken(page, (token) =>
      page.request.post('/api/notifications/push-subscriptions', {
        headers: { Authorization: `Bearer ${token}` },
        data: { endpoint, keys: { p256dh: 'p256key', auth: 'authkey' }, userAgent: 'Playwright' },
      }),
    );
    expect(created.status()).toBe(201);

    const listed = await withToken(page, (token) =>
      page.request.get('/api/notifications/push-subscriptions', {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    const body = (await listed.json()) as {
      data: { items: { endpointHost: string }[] };
    };
    expect(body.data.items[0].endpointHost).toBe('push.example.test');
    // A full endpoint is a bearer capability for that device, so it never
    // leaves the server.
    expect(JSON.stringify(body)).not.toContain(endpoint);

    const removed = await withToken(page, (token) =>
      page.request.delete('/api/notifications/push-subscriptions', {
        headers: { Authorization: `Bearer ${token}` },
        data: { endpoint },
      }),
    );
    expect(removed.status()).toBe(204);
  });
});

// =============================================================================
// 9. With the coach unreachable — PRD §120
// =============================================================================
//
// Its own block, with a fresh admin, because it edits the DEPLOYMENT-WIDE AI
// settings. The `afterEach` restore is belt and braces on top of that.
// =============================================================================

test.describe('E12 — with the coach unreachable', () => {
  const UNREACHABLE = 'http://fake-openai:1/v1';

  /** Point the provider somewhere, and check that the write took. */
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

  test('the notification still goes out, with the deterministic copy', async ({ page }) => {
    await signIn(page, 'e12-ai-down');
    await setBaseUrl(page, UNREACHABLE);

    try {
      await seedWorkout(page, 20);

      expect(await runCoachingJob(page)).toMatchObject({ sent: 1 });

      const [row] = await inboxFor(page, 'coach.commitment_upcoming');
      expect(row).toBeDefined();

      // The one place exact wording is asserted: this is the template path, and
      // the template is what ships on every provider outage.
      expect(row.title).toBe('Upper A starts in 20 minutes');
      expect(row.body).toContain('Health');
      expect(row.actions.map((action) => action.action)).toEqual(['start', 'move', 'skip']);
      expect(row.link).toContain('/today?commitment=');
      expect(row.link).toContain('&n=');
    } finally {
      await setBaseUrl(page, null);
    }
  });
});
