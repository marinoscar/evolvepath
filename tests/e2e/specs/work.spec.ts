import { expect, test, type Page } from '@playwright/test';

import { loginAsTestUser } from '../helpers/auth.helper';
import { apiGet, uniqueEmail, withToken } from '../helpers/path.helper';
import {
  createOutcome,
  getCommitment,
  getEvidence,
  getToday,
  tomorrowAtIso,
  type SeededOutcome,
} from '../helpers/commitments.helper';
import {
  getAvoidance,
  getWorkPlan,
  getWorkSummary,
  listFocusSessions,
  reschedule,
  startFocusSession,
} from '../helpers/work.helper';

// =============================================================================
// E07 end to end (issue #122)
// =============================================================================
//
// PRD §104's acceptance list, driven through the browser and then read back
// through the API: create a work outcome, have the coach break it into
// sessions, start a focus action, reschedule, watch repeated reschedules
// trigger the friction intervention, and see starting recorded separately from
// completing.
//
// Five properties this file exists to prove, none of which a unit test can:
//
//   1. THE AI PROPOSAL WRITES NOTHING. Case 1 counts commitments before Apply
//      and after it. "We did not write anything" is invisible to any assertion
//      that only reads a response body.
//   2. TWO RESCHEDULES, NOT ONE. Case 2 moves one session twice and a second
//      session once, and asserts the ladder tells them apart (PRD §25).
//   3. STARTING IS EVIDENCE, SEPARATE FROM COMPLETING. Case 3 reads back an
//      `APP_FLOW started` row AND a `TIMER focus_session` row for the same
//      commitment.
//   4. THE PRODUCT WORKS WITH THE COACH DOWN. Case 5 plans and diagnoses
//      friction with the provider unreachable.
//   5. THE SERVER OVERRULES THE MODEL. Case 6 makes the fake coach claim the
//      wrong intervention type and asserts the template answer wins.
//
// SEEDED THROUGH THE API, never the database, like every other spec here.
// A FRESH USER PER TEST: the suite is `fullyParallel` against one database.
//
// FAILS LOUDLY when the stack is not up. No `test.skip` anywhere: a suite that
// silently passes because the API was unreachable is worse than no suite.
// =============================================================================

/** A reschedule closes the row and opens a new one; ids move. */
interface MovedCommitment {
  id: string;
  rescheduleCount: number;
}

async function signIn(page: Page, prefix: string): Promise<void> {
  await loginAsTestUser(page, { email: uniqueEmail(prefix), role: 'contributor' });
}

async function seedWorkOutcome(page: Page): Promise<SeededOutcome> {
  return createOutcome(page, {
    domain: 'WORK',
    title: 'Finish strategy presentation',
    whyItMatters: 'The board decides budget on it',
  });
}

/** Propose and apply a plan through the dialog, returning the session count. */
async function planSessions(page: Page, outcome: SeededOutcome, useTemplate = false) {
  await page.goto(`/path/outcomes/${outcome.id}`);

  await page.getByTestId('plan-sessions-cta').click();

  if (useTemplate) {
    await page.getByTestId('plan-sessions-propose').click();
    await expect(page.getByTestId('coach-unavailable')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('use-standard-plan').click();
  } else {
    await page.getByTestId('plan-sessions-propose').click();
  }

  await expect(page.getByTestId('plan-sessions-apply')).toBeVisible({ timeout: 60_000 });
}

test.describe('E07 — the Work domain', () => {
  // The suite is meaningless if the stack is not up, and a skip would hide it.
  test.beforeAll(async ({ request }) => {
    const health = await request.get('/api/health/ready');

    expect(
      health.ok(),
      `the API is not ready (${health.status()}); start base + dev + fake-openai`,
    ).toBe(true);
  });

  test('plans sessions for a work outcome with the coach and applies them', async ({ page }) => {
    await signIn(page, 'e07-plan');
    const outcome = await seedWorkOutcome(page);

    // Nothing exists yet: the empty states, and the CTA offering a first plan.
    await page.goto(`/path/outcomes/${outcome.id}`);
    await expect(page.getByText('No milestones yet.')).toBeVisible();
    await expect(page.getByTestId('plan-sessions-cta')).toHaveText(
      'Plan sessions with the coach',
    );

    const before = await getWorkPlan(page, outcome.id);
    expect(before.sessions).toHaveLength(0);

    await planSessions(page, outcome);

    // PRD §15: the proposal is on screen and the plan is still empty.
    const during = await getWorkPlan(page, outcome.id);
    expect(during.sessions, 'a proposal must write nothing').toHaveLength(0);
    expect(during.milestones).toHaveLength(0);

    // Edit the first session before agreeing to it — the review step is the
    // approval, and it is only real if the edit is what gets applied.
    const minutes = page.getByTestId('session-minutes-0');
    await minutes.fill('20');

    await page.getByTestId('plan-sessions-apply').click();

    await expect(page.getByTestId('implementation-intention')).toBeVisible({ timeout: 30_000 });

    const after = await getWorkPlan(page, outcome.id);
    expect(after.sessions).toHaveLength(5);
    expect(after.milestones).toHaveLength(3);
    expect(after.sessions[0].durationMinutes, 'the edited duration').toBe(20);
    expect(after.implementationIntention).not.toBeNull();
    expect(after.reviewCadence).toBe('WEEKLY');

    // Every session belongs to a milestone, and every one is a real commitment.
    for (const session of after.sessions) {
      expect(session.milestoneId).not.toBeNull();
      expect(session.status).toBe('PLANNED');
    }

    // And the milestones render with their sessions underneath.
    await expect(page.getByTestId(`milestone-${after.milestones[0].id}`)).toBeVisible();
    await expect(page.getByTestId(`planned-session-${after.sessions[0].id}`)).toBeVisible();
  });

  test('two reschedules surface the friction prompt on Today, one does not', async ({ page }) => {
    await signIn(page, 'e07-friction');
    const outcome = await seedWorkOutcome(page);
    await planSessions(page, outcome);
    await page.getByTestId('plan-sessions-apply').click();
    await expect(page.getByTestId('implementation-intention')).toBeVisible({ timeout: 30_000 });

    const plan = await getWorkPlan(page, outcome.id);

    // Move the first session onto today, twice. A reschedule CLOSES the row and
    // opens a new one, so the chain has to be walked by id.
    let first: MovedCommitment = { id: plan.sessions[0].id, rescheduleCount: 0 };
    first = await reschedule(page, first.id, tomorrowAtIso(9));
    first = await reschedule(page, first.id, tomorrowAtIso(14));

    expect(first.rescheduleCount).toBe(2);

    // The second session moves once, and must stay at level 0: PRD §25 forbids
    // inferring avoidance from a single move.
    const second = await reschedule(page, plan.sessions[1].id, tomorrowAtIso(10));
    expect(second.rescheduleCount).toBe(1);

    const moved = await getAvoidance(page, first.id);
    expect(moved.level).toBe(3);
    expect(moved.interventionType).toBe('FRICTION_DIAGNOSIS');
    expect(moved.signals).toContain('RESCHEDULED_TWICE');
    expect(moved.suggestedAction).toBe('FRICTION_QUESTION');

    const movedOnce = await getAvoidance(page, second.id);
    expect(movedOnce.level, 'one move is a Tuesday, not a pattern').toBe(0);
    expect(movedOnce.suggestedAction).toBe('NONE');

    // Today carries the assessment on the card and reads it into the posture.
    const today = await getToday(page);
    const work = today.domains.find((section) => section.domain === 'WORK');
    const card = work?.commitments.find((commitment) => commitment.id === first.id);

    expect(card?.avoidance?.level).toBe(3);
    expect(card?.avoidance?.suggestedAction).toBe('FRICTION_QUESTION');
    expect(today.nextBestAction?.interventionMode).toBe('DIAGNOSE');

    // And the question is on the screen, where the user is already looking.
    await page.goto('/');
    await expect(page.getByTestId(`friction-prompt-${first.id}`)).toContainText(
      "What's making it hard to start?",
    );
  });

  test('"it feels too big" offers decomposition, and a ten-minute start records TIMER evidence', async ({
    page,
  }) => {
    await signIn(page, 'e07-decompose');
    const outcome = await seedWorkOutcome(page);
    await planSessions(page, outcome);
    await page.getByTestId('plan-sessions-apply').click();
    await expect(page.getByTestId('implementation-intention')).toBeVisible({ timeout: 30_000 });

    const plan = await getWorkPlan(page, outcome.id);
    let target: MovedCommitment = { id: plan.sessions[0].id, rescheduleCount: 0 };
    target = await reschedule(page, target.id, tomorrowAtIso(9));
    target = await reschedule(page, target.id, tomorrowAtIso(14));

    await page.goto('/');
    await page.getByTestId(`friction-answer-open-${target.id}`).click();

    await page.getByTestId('friction-answer-TOO_BIG').click();
    await page.getByTestId('friction-send').click();

    const intervention = page.getByTestId('intervention-card');
    await expect(intervention).toBeVisible({ timeout: 60_000 });
    await expect(intervention).toContainText('one task');

    // Asked once: the ladder now offers an action instead of the question.
    const asked = await getAvoidance(page, target.id);
    expect(asked.level).toBe(3);
    expect(asked.suggestedAction).toBe('DECOMPOSE');

    await page.getByTestId('intervention-start').click();

    // The intervention's minutes and its own sentence, carried into the URL.
    await page.waitForURL(new RegExp(`/start/${target.id}\\?minutes=10`));
    await expect(page.getByTestId('focus-instruction')).toBeVisible();

    await page.getByRole('button', { name: /^Begin/ }).click();

    // Persisted server-side, which is what makes the reload below meaningful.
    await page.getByTestId('focus-note-input').fill('Checked Slack');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText('Checked Slack')).toBeVisible();

    await page.reload();

    // The countdown resumes from the server's anchor and the note is still
    // there — a locally counted timer would restart at the full duration.
    await expect(page.getByText('Checked Slack')).toBeVisible();
    await expect(page.getByRole('button', { name: /done for now/i })).toBeVisible();

    await page.getByRole('button', { name: /done for now/i }).click();
    await page.getByRole('button', { name: /^Partly done$/ }).click();

    await page.waitForURL('/');

    const sessions = await listFocusSessions(page, target.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].outcome).toBe('PARTIAL');
    expect(sessions[0].distractionNotes).toEqual(['Checked Slack']);

    // PRD §104: starting is recorded separately from completing.
    const evidence = await getEvidence(page, target.id);
    const started = evidence.find(
      (row) => row.source === 'APP_FLOW' && row.evidenceType === 'started',
    );
    const focus = evidence.find(
      (row) => row.source === 'TIMER' && row.evidenceType === 'focus_session',
    );

    expect(started, 'the APP_FLOW start row').toBeTruthy();
    expect(focus, 'the TIMER focus_session row').toBeTruthy();
    expect(focus?.quantitativeValue ?? 0).toBeGreaterThanOrEqual(1);

    const commitment = await getCommitment(page, target.id);
    expect(commitment.status).toBe('PARTIALLY_COMPLETED');
  });

  test('continue extends the running session', async ({ page }) => {
    await signIn(page, 'e07-continue');
    const outcome = await seedWorkOutcome(page);
    await planSessions(page, outcome);
    await page.getByTestId('plan-sessions-apply').click();
    await expect(page.getByTestId('implementation-intention')).toBeVisible({ timeout: 30_000 });

    const plan = await getWorkPlan(page, outcome.id);
    const target = plan.sessions[1].id;

    // One minute, so the "Continue another 15?" prompt is reachable without a
    // simulated clock: the countdown is derived from the server's anchor, and
    // `page.clock` cannot move that.
    await startFocusSession(page, target, 1);

    await page.goto(`/start/${target}`);

    await expect(page.getByTestId('time-is-up')).toBeVisible({ timeout: 90_000 });
    await page.getByTestId('focus-continue').click();

    await expect
      .poll(async () => (await listFocusSessions(page, target))[0]?.continuedCount)
      .toBe(1);

    const [extended] = await listFocusSessions(page, target);
    expect(extended.plannedMinutes).toBe(16);
    expect(extended.commitment.timer?.timerMinutes).toBe(16);

    await page.getByRole('button', { name: /done for now/i }).click();
    await page.getByRole('button', { name: /^Done$/ }).click();
    await page.waitForURL('/');

    const commitment = await getCommitment(page, target);
    expect(commitment.status).toBe('COMPLETED');
  });

  test('a protected move keeps the count where it was', async ({ page }) => {
    await signIn(page, 'e07-protected');
    const outcome = await seedWorkOutcome(page);
    await planSessions(page, outcome);
    await page.getByTestId('plan-sessions-apply').click();
    await expect(page.getByTestId('implementation-intention')).toBeVisible({ timeout: 30_000 });

    const plan = await getWorkPlan(page, outcome.id);
    let target: MovedCommitment = { id: plan.sessions[0].id, rescheduleCount: 0 };
    target = await reschedule(page, target.id, tomorrowAtIso(9));
    target = await reschedule(page, target.id, tomorrowAtIso(14));
    expect(target.rescheduleCount).toBe(2);

    await page.goto('/');
    await page.getByTestId(`friction-answer-open-${target.id}`).click();
    await page.getByTestId('friction-answer-SOMETHING_URGENT').click();
    await page.getByTestId('friction-send').click();

    const move = page.getByTestId('intervention-protected-reschedule');
    await expect(move).toBeVisible({ timeout: 60_000 });

    // The move IS the action here; offering a start as well would be arguing
    // with the answer the user just gave.
    await expect(page.getByTestId('intervention-start')).toHaveCount(0);

    await move.click();

    // The new row carries the same count: having a job is not avoidance.
    await expect
      .poll(async () => {
        const today = await getToday(page);
        const work = today.domains.find((section) => section.domain === 'WORK');
        return work?.commitments.some((commitment) => commitment.rescheduleCount === 2);
      })
      .toBe(true);

    const closed = await getCommitment(page, target.id);
    expect(closed.status).toBe('RESCHEDULED');
  });

  test('the weekly summary reflects what happened', async ({ page }) => {
    await signIn(page, 'e07-summary');
    const outcome = await seedWorkOutcome(page);
    await planSessions(page, outcome);
    await page.getByTestId('plan-sessions-apply').click();
    await expect(page.getByTestId('implementation-intention')).toBeVisible({ timeout: 30_000 });

    const plan = await getWorkPlan(page, outcome.id);

    // One started-and-stopped session, and one commitment moved twice.
    const session = await startFocusSession(page, plan.sessions[0].id, 5);
    await withToken(page, (token) =>
      page.request.post(`/api/focus-sessions/${session.id}/note`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { text: 'Checked Slack' },
      }),
    );
    await withToken(page, (token) =>
      page.request.post(`/api/focus-sessions/${session.id}/stop`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { outcome: 'partial' },
      }),
    );

    let moved: MovedCommitment = { id: plan.sessions[1].id, rescheduleCount: 0 };
    moved = await reschedule(page, moved.id, tomorrowAtIso(9));
    moved = await reschedule(page, moved.id, tomorrowAtIso(14));

    const summary = await getWorkSummary(page);

    expect(summary.focusSessions.partial).toBeGreaterThanOrEqual(1);
    expect(summary.focusSessions.started).toBeGreaterThanOrEqual(1);
    expect(summary.starts.started).toBeGreaterThanOrEqual(1);
    expect(summary.distractionNoteCount).toBeGreaterThanOrEqual(1);
    expect(
      summary.repeatedlyPostponed.some((row) => row.rescheduleCount >= 2),
      'the moved-twice commitment',
    ).toBe(true);
  });
});

// =============================================================================
// With the coach unreachable, and with the coach misbehaving
// =============================================================================
//
// PRD §120 and E07-03's server guard, as end-to-end assertions. The provider's
// base URL is pointed at an unreachable port for the first; the second makes
// the fake coach claim an intervention type it was not asked for, and proves
// the deterministic template wins.
//
// A fresh ADMIN per test, because the base URL is an installation setting.
// =============================================================================

test.describe('E07 — when the coach cannot be trusted', () => {
  const UNREACHABLE = 'http://fake-openai:1/v1';

  /** Point the provider somewhere, and check the write took (see #157). */
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

  test('planning and friction both work with the provider down', async ({ page }) => {
    await loginAsTestUser(page, { email: uniqueEmail('e07-ai-down'), role: 'admin' });
    const outcome = await seedWorkOutcome(page);
    await setBaseUrl(page, UNREACHABLE);

    try {
      await planSessions(page, outcome, true);
      await page.getByTestId('plan-sessions-apply').click();
      await expect(page.getByTestId('implementation-intention')).toBeVisible({ timeout: 30_000 });

      const plan = await getWorkPlan(page, outcome.id);
      expect(plan.sessions.length).toBeGreaterThan(0);
      expect(plan.latestProposal?.source).toBe('template');

      let target: MovedCommitment = { id: plan.sessions[0].id, rescheduleCount: 0 };
      target = await reschedule(page, target.id, tomorrowAtIso(9));
      target = await reschedule(page, target.id, tomorrowAtIso(14));

      await page.goto('/');
      await page.getByTestId(`friction-answer-open-${target.id}`).click();
      await page.getByTestId('friction-answer-TIRED').click();
      await page.getByTestId('friction-send').click();

      const intervention = page.getByTestId('intervention-card');
      await expect(intervention).toBeVisible({ timeout: 60_000 });

      // A template answer is a complete one, and says so rather than passing
      // itself off as the coach's.
      await expect(intervention).toContainText('Standard suggestion');
    } finally {
      await setBaseUrl(page, null);
    }
  });

  test('the server overrules a coach that claims the wrong intervention type', async ({
    page,
  }) => {
    await signIn(page, 'e07-override');
    const outcome = await seedWorkOutcome(page);
    await planSessions(page, outcome);
    await page.getByTestId('plan-sessions-apply').click();
    await expect(page.getByTestId('implementation-intention')).toBeVisible({ timeout: 30_000 });

    const plan = await getWorkPlan(page, outcome.id);
    let target: MovedCommitment = { id: plan.sessions[0].id, rescheduleCount: 0 };
    target = await reschedule(page, target.id, tomorrowAtIso(9));
    target = await reschedule(page, target.id, tomorrowAtIso(14));

    // The sentinel the fake coach misbehaves on. It travels in the user's own
    // free text because this server never sees a header the browser set.
    const answered = await withToken(page, (token) =>
      page.request.post(`/api/commitments/${target.id}/friction`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { answer: 'WORRIED_ABOUT_QUALITY', text: 'force-wrong-intervention' },
      }),
    );

    expect(answered.ok(), await answered.text()).toBe(true);

    const { data } = (await answered.json()) as {
      data: { intervention: { interventionType: string; source: string } };
    };

    // The answer decided the type, not the model — and the reply that claimed
    // otherwise was discarded whole.
    expect(data.intervention.interventionType).toBe('PERFECTIONISM_REFRAME');
    expect(data.intervention.source).toBe('template');
  });
});
