import { test, expect, type Page } from '@playwright/test';

import { loginAsTestUser } from '../helpers/auth.helper';
import { apiGet } from '../helpers/path.helper';
import { enableAi } from '../helpers/weekly.helper';

/**
 * Onboarding, end to end (epic E04, proven here by #107).
 *
 * PRD §102's acceptance list in one run: define the desired self, choose
 * domains, receive / modify / approve a plan, pick a coaching style, answer the
 * notification question, land on Today — and, the one nobody can check by
 * hand, "the initial plan must persist after session ends".
 *
 * The two assertions that only a real run can make:
 *
 *   • ZERO commitments before `Start this Path`, and three after. PRD §15 says
 *     AI output becomes a plan only through a human approval, and a claim about
 *     a write that does NOT happen is invisible to every other kind of test.
 *   • The flow COMPLETES with the provider down (PRD §120), and the plan it
 *     produced is attributed to the user rather than to a coach that never
 *     wrote it.
 *
 * Runs against the `fake-openai` overlay — see `tools/fake-openai/README.md`.
 */

const VISION = 'I want my mornings back, dinners that are not on a phone, and to train again.';

interface CommitmentRow {
  id: string;
  title: string;
  status: string;
  scheduledStart: string;
  timer: { timerMinutes: number | null } | null;
  fullMinutes?: number | null;
}

/** The window `GET /commitments` requires: ISO instants, not calendar dates. */
function weekWindow(): { from: string; to: string } {
  const now = Date.now();

  return {
    from: new Date(now - 2 * 86_400_000).toISOString(),
    to: new Date(now + 9 * 86_400_000).toISOString(),
  };
}

async function plannedCommitments(page: Page): Promise<CommitmentRow[]> {
  const { from, to } = weekWindow();
  const rows = await apiGet<CommitmentRow[]>(
    page,
    `/api/commitments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&status=PLANNED`,
  );

  return rows;
}

/** Steps 1 → 7, stopping on the proposal screen. */
async function fillTheWizard(page: Page, options: { health?: boolean } = {}) {
  const health = options.health ?? true;

  await expect(page.getByRole('heading', { name: 'Become who you want to be.' })).toBeVisible();
  await page.getByRole('button', { name: 'Build my Path' }).click();

  await expect(page.getByRole('heading', { name: 'Six months from now' })).toBeVisible();
  await page.getByLabel('Six months from now').fill(VISION);
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'Where does that start?' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Work' }).click();
  await page.getByRole('checkbox', { name: 'Family' }).click();
  if (health) await page.getByRole('checkbox', { name: 'Health' }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'What usually gets in the way?' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'I procrastinate' }).click();
  await page.getByRole('checkbox', { name: 'I make plans that are too ambitious' }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(
    page.getByRole('heading', { name: 'How much time do you actually have?' }),
  ).toBeVisible();

  // `page.fill` does not work on a MUI slider — it is a div with a hidden
  // input. Arrow keys on the thumb are the only interaction that moves it.
  const slider = page.getByRole('slider', { name: 'Minutes on a normal weekday' });
  await slider.focus();
  const current = Number(await slider.getAttribute('aria-valuenow'));
  for (let value = current; value < 45; value += 5) {
    await slider.press('ArrowRight');
  }
  await expect(slider).toHaveAttribute('aria-valuenow', '45');
  await page.getByRole('button', { name: 'Next' }).click();

  if (health) {
    await expect(page.getByRole('heading', { name: 'Where are you starting from?' })).toBeVisible();
    await page.getByRole('radio', { name: 'Beginner' }).check();
    await page.getByRole('button', { name: '3 days a week' }).click();
    await page.getByRole('checkbox', { name: 'Dumbbells' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
  }

  await expect(page.getByRole('heading', { name: 'How should I talk to you?' })).toBeVisible();
  await page.getByRole('radio', { name: /Balanced/ }).check();
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'Your first Path' })).toBeVisible();
}

test.describe('Onboarding', () => {
  /**
   * Turn the deployment's AI on, ONCE, through a throwaway admin.
   *
   * `ai_settings` ships `enabled: false` with no provider, so a fresh stack
   * answers the planner with `ai_disabled` — and step 8 would show "the coach
   * is unavailable" while looking, from the outside, exactly like a provider
   * that happened to be down. That is the one outcome this fixture rules out.
   *
   * A SEPARATE CONTEXT, and an admin, because the wizard's own users are
   * viewers: `PUT /ai-settings` is `system_settings:write`, and a spec that
   * made every onboarding user an admin would stop testing the role a real
   * first-time user has.
   */
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await loginAsTestUser(page, {
      email: `onboard-admin-${Date.now()}@test.local`,
      role: 'admin',
      withAiKey: true,
      withOnboarding: true,
    });

    await enableAi(page);
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    // Fail loudly rather than skipping: a suite that quietly passes because the
    // stack is not up is worse than one that does not run.
    const ready = await page.request.get('/api/health/ready');
    expect(ready.ok(), 'the API must be reachable and ready').toBeTruthy();
  });

  test('completes with the AI proposal and lands on Today with persisted commitments', async ({
    page,
  }) => {
    await loginAsTestUser(page, {
      email: `onboard-${Date.now()}@test.local`,
      role: 'viewer',
      withAiKey: true,
      withOnboarding: false,
    });

    await expect(page).toHaveURL(/\/onboarding$/);

    await fillTheWizard(page);

    // ---- PRD §15: nothing is written until the user approves ---------------

    const state = await apiGet<{ pendingProposal: unknown; completed: boolean }>(
      page,
      '/api/onboarding',
    );

    expect(state.pendingProposal, 'the proposal is stored on the profile').toBeTruthy();
    expect(state.completed).toBe(false);
    expect(await plannedCommitments(page), 'no commitments before approval').toHaveLength(0);

    // ---- approve ------------------------------------------------------------

    await page.getByRole('button', { name: '4' }).click();

    const approve = page.getByRole('button', { name: 'Start this Path' });
    await expect(approve).toBeEnabled();
    await approve.click();

    await expect(page.getByRole('heading', { name: /One notification a day/ })).toBeVisible();

    // The permission prompt blocks a headless run, so the spec always declines.
    await page.getByRole('button', { name: 'Not now' }).click();
    await page.getByRole('button', { name: 'Finish' }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('today-state-line')).toBeVisible();

    const created = await plannedCommitments(page);
    expect(created.length, 'three PLANNED commitments in the first week').toBeGreaterThanOrEqual(3);

    const me = await apiGet<{ onboarding: { completed: boolean } }>(page, '/api/auth/me');
    expect(me.onboarding.completed).toBe(true);

    // "The initial plan must persist after session ends" (PRD §102).
    await page.reload();
    await expect(page).toHaveURL(/\/$/);
    expect(await plannedCommitments(page)).toHaveLength(created.length);

    // And the wizard is closed for good.
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/$/);
  });

  test('resumes at the saved step after a reload', async ({ page }) => {
    await loginAsTestUser(page, {
      email: `resume-${Date.now()}@test.local`,
      role: 'viewer',
      withAiKey: true,
      withOnboarding: false,
    });

    await page.getByRole('button', { name: 'Build my Path' }).click();
    await page.getByLabel('Six months from now').fill(VISION);
    await page.getByRole('button', { name: 'Next' }).click();

    await expect(page.getByRole('heading', { name: 'Where does that start?' })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Work' }).click();
    await page.getByRole('button', { name: 'Next' }).click();

    await expect(page.getByRole('heading', { name: 'What usually gets in the way?' })).toBeVisible();

    await page.reload();

    // The step, and the answers, came back from the server — nothing here is
    // in `localStorage`.
    await expect(page.getByRole('heading', { name: 'What usually gets in the way?' })).toBeVisible();
    await page.getByRole('button', { name: /^Back$/ }).click();
    await expect(page.getByRole('checkbox', { name: 'Work' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('a low confidence answer yields a smaller plan', async ({ page }) => {
    await loginAsTestUser(page, {
      email: `confidence-${Date.now()}@test.local`,
      role: 'viewer',
      withAiKey: true,
      withOnboarding: false,
    });

    await fillTheWizard(page);

    const health = page.getByRole('region', { name: 'Health' });

    await expect(health.getByText('Strength session', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '2' }).click();

    await expect(page.getByText('I made it smaller — take another look')).toBeVisible();
    await expect(
      page.getByText(/I intentionally kept this smaller than what you asked for/),
    ).toBeVisible();

    // The fixture drops one routine when asked to reduce. The Health SECTION
    // survives, because its outcome does — what shrank is the week, not what
    // matters — so the routine is what disappears.
    await expect(health.getByText('Strength session', { exact: true })).toHaveCount(0);
    await expect(health).toBeVisible();
    await expect(health.getByText('Train consistently')).toBeVisible();

    // A second answer proceeds rather than looping.
    await page.getByRole('button', { name: '4' }).click();
    await expect(page.getByRole('button', { name: 'Start this Path' })).toBeEnabled();
    await page.getByRole('button', { name: 'Start this Path' }).click();

    await expect(page.getByRole('heading', { name: /One notification a day/ })).toBeVisible();
  });

  test('edits a commitment before approving, and the edit is what gets stored', async ({
    page,
  }) => {
    await loginAsTestUser(page, {
      email: `edit-${Date.now()}@test.local`,
      role: 'viewer',
      withAiKey: true,
      withOnboarding: false,
    });

    await fillTheWizard(page);

    await page.getByRole('button', { name: 'Adjust' }).click();

    const work = page.getByRole('region', { name: 'Work' });
    // `exact`: a substring match on "For" also hits the Remove button's
    // aria-label, which contains "beFORe email".
    await work.getByLabel('For', { exact: true }).click();
    await page.getByRole('option', { name: '15 min' }).click();

    await page.getByRole('button', { name: '4' }).click();
    await page.getByRole('button', { name: 'Start this Path' }).click();

    await expect(page.getByRole('heading', { name: /One notification a day/ })).toBeVisible();
    await page.getByRole('button', { name: 'Not now' }).click();
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page).toHaveURL(/\/$/);

    const created = await plannedCommitments(page);
    const edited = created.find((row) => row.title === 'Start the most important task before email');

    expect(edited, 'the Work commitment exists').toBeTruthy();
    expect(edited?.fullMinutes ?? edited?.timer?.timerMinutes).toBe(15);
  });

  test('completes without AI through the template path', async ({ page }) => {
    await loginAsTestUser(page, {
      email: `template-${Date.now()}@test.local`,
      role: 'viewer',
      withAiKey: true,
      withOnboarding: false,
    });

    // The provider is unreachable from the API's point of view. Routing the
    // BROWSER's request would prove nothing — the API calls the provider, the
    // browser does not — so the failure is injected where the browser can reach
    // it: the API route the wizard calls.
    await page.route('**/api/onboarding/propose', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'The coach is unavailable right now',
          details: { reason: 'AI_UNAVAILABLE', code: 'provider', retryable: true },
        }),
      }),
    );

    await fillTheWizard(page);

    await expect(page.getByText('The coach is unavailable right now')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();

    await page.getByRole('button', { name: 'Continue without AI' }).click();

    await expect(
      page.getByText('Starting template — the coach will refine this once it is back'),
    ).toBeVisible();

    await page.getByRole('button', { name: '4' }).click();
    await page.getByRole('button', { name: 'Start this Path' }).click();

    await page.getByRole('button', { name: 'Not now' }).click();
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page).toHaveURL(/\/$/);

    expect((await plannedCommitments(page)).length).toBeGreaterThanOrEqual(3);

    // No coach wrote this plan, so it is attributed to the user.
    const outcomes = await apiGet<Array<{ id: string }>>(page, '/api/outcomes');
    expect(outcomes.length).toBeGreaterThan(0);

    const plans = await apiGet<Array<{ id: string }>>(
      page,
      `/api/outcomes/${outcomes[0].id}/plans`,
    );
    const plan = await apiGet<{ activeVersion: { createdBy: string; userApproved: boolean } }>(
      page,
      `/api/plans/${plans[0].id}`,
    );

    expect(plan.activeVersion.createdBy).toBe('USER');
    expect(plan.activeVersion.userApproved).toBe(true);
  });

  test('the key gate wins over the onboarding gate', async ({ page }) => {
    await loginAsTestUser(page, {
      email: `gate-order-${Date.now()}@test.local`,
      role: 'viewer',
      withAiKey: false,
      withOnboarding: false,
    });

    await expect(page).toHaveURL(/\/setup\/ai-key$/);

    // Even asking for the wizard directly: step 8 needs the key.
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/setup\/ai-key$/);
  });

  test('an onboarded user is sent away from the wizard', async ({ page }) => {
    await loginAsTestUser(page, {
      email: `done-${Date.now()}@test.local`,
      role: 'viewer',
      withAiKey: true,
      withOnboarding: true,
    });

    await expect(page).toHaveURL(/\/$/);

    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/$/);
  });
});
