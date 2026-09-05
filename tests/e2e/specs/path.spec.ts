import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { loginAsTestUser } from '../helpers/auth.helper';
import {
  apiGet,
  daysAheadAt,
  describeViolations,
  seriousAxeViolations,
  tomorrowAt,
  uniqueEmail,
} from '../helpers/path.helper';

// =============================================================================
// The Path flow, end to end: browser → API → PostgreSQL (#62, epic #33)
// =============================================================================
//
// SERIAL AND STATEFUL, on purpose. This is one story — build a Path, change
// the plan, keep a commitment — and every step's meaning depends on the last
// one having happened. Splitting it into independent tests would mean either
// re-seeding through the API before each (testing the API, not the screen) or
// asserting far less than the epic promises.
//
// WHAT ONLY THIS FILE CAN PROVE. The unit and integration suites cover the
// same rules against mocks; what they cannot show is that the real database,
// the real API and the real React tree agree about them. Specifically:
//
//   * PRD §103 — activating v2 makes v1 SUPERSEDED, and v1 stays readable with
//     its own routines. Asserted on the screen AND through the API.
//   * PRD §10.9 — completing WITH a note writes one USER_LOG row; completing
//     WITHOUT one writes nothing. Both halves, because the second is the one
//     an implementation gets wrong.
//   * The reschedule count travels with the intention across two moves.
//   * Another user's outcome is 404 on the API and "not found" on the screen —
//     never a 403, which would confirm the id is real.
// =============================================================================

const IDENTITY = 'Focused, present, healthy';
const OUTCOME_TITLE = 'Three strength workouts per week';

/** Opens the outcome card and returns the detail URL it navigated to. */
async function openOutcome(page: Page): Promise<string> {
  await page.getByRole('button', { name: `Open ${OUTCOME_TITLE}` }).click();
  await page.waitForURL(/\/path\/outcomes\/[^/]+$/);
  return page.url();
}

test.describe.serial('Path flow', () => {
  let context: BrowserContext;
  let page: Page;
  let email: string;
  let outcomeUrl: string;
  let outcomeId: string;
  let planId: string;

  test.beforeAll(async ({ browser }) => {
    // ONE page for the whole describe: the state built by each step is the
    // input to the next.
    //
    // An explicit CONTEXT rather than `browser.newPage()`, because
    // `@axe-core/playwright` refuses a page created without one — it needs the
    // context to inject axe into every frame.
    context = await browser.newContext();
    page = await context.newPage();
    email = uniqueEmail('path');
    await loginAsTestUser(page, { email, withAiKey: true });
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('saves a Best Self that survives a reload', async () => {
    await page.goto('/path');
    await page.getByTestId('best-self-edit').click();

    const dialog = page.getByRole('dialog', { name: 'Your Best Self' });
    await dialog.getByLabel(/identity statement/i).fill(IDENTITY);
    await dialog
      .getByLabel(/six-month vision/i)
      .fill('Training three times a week without negotiating with myself');
    await dialog.getByRole('button', { name: 'Save' }).click();

    // Scoped to the CARD: the dialog's placeholder is the same sentence, so an
    // unscoped match would also find the (closing) form field.
    const card = page.getByTestId('best-self-card');
    await expect(card.getByText(IDENTITY)).toBeVisible();
    await expect(card.getByText(/last reviewed/i)).toBeVisible();

    // The point of the reload: it came from the database, not from React state.
    await page.reload();
    await expect(page.getByTestId('best-self-card').getByText(IDENTITY)).toBeVisible();
  });

  test('creates an outcome under Health that survives a reload', async () => {
    await page.getByTestId('add-outcome-HEALTH').click();

    const dialog = page.getByRole('dialog', { name: 'New Health outcome' });
    await dialog.getByLabel(/what do you want to be true/i).fill(OUTCOME_TITLE);
    await dialog.getByRole('button', { name: 'Save' }).click();

    const health = page.getByTestId('domain-section-HEALTH');
    await expect(health.getByText(OUTCOME_TITLE)).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('domain-section-HEALTH').getByText(OUTCOME_TITLE)).toBeVisible();

    outcomeUrl = await openOutcome(page);
    outcomeId = outcomeUrl.split('/').pop() as string;
  });

  test('creates a plan whose v1 is active', async () => {
    await page.getByTestId('create-plan').click();

    const dialog = page.getByRole('dialog', { name: 'Create plan' });
    await dialog.getByLabel(/how are you going to approach this/i).fill('Start with mornings');
    await dialog.getByLabel(/expected weekly load/i).fill('120');
    await dialog.getByRole('button', { name: 'Create plan' }).click();

    const summary = page.getByTestId('plan-summary');
    await expect(summary.getByText('Plan v1')).toBeVisible();
    // `exact` — "Active since …" is also on this card.
    await expect(summary.getByText('ACTIVE', { exact: true })).toBeVisible();

    const plans = await apiGet<Array<{ id: string }>>(page, `/api/outcomes/${outcomeId}/plans`);
    planId = plans[0].id;
  });

  test('adds a routine to the active version', async () => {
    await page.getByTestId('add-routine').click();

    const dialog = page.getByRole('dialog', { name: 'New routine' });
    await dialog.getByLabel(/what will you do/i).fill('Morning workout');
    await dialog.getByRole('button', { name: 'Something else' }).click();
    await dialog.getByLabel(/right after/i).fill('morning coffee');
    await dialog.getByLabel(/full version/i).fill('45');
    await dialog.getByLabel(/minimum version/i).fill('10');
    await dialog.getByLabel(/if you cannot do it at all/i).fill('10-minute circuit');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByTestId('routine-list').getByText('Morning workout')).toBeVisible();
  });

  test('refuses a routine whose minimum is longer than its full version', async () => {
    await page.getByTestId('add-routine').click();

    const dialog = page.getByRole('dialog', { name: 'New routine' });
    await dialog.getByLabel(/what will you do/i).fill('Impossible routine');
    await dialog.getByLabel(/minimum version/i).fill('90');
    await dialog.getByRole('button', { name: 'Save' }).click();

    // The bad-day path must not be the harder one (PRD §57). Rejected in the
    // browser, before a request is sent — the dialog is still open.
    await expect(dialog.getByText(/minimum cannot be longer than the full version/i)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  test('drafts v2 with its rationale, and activates it while v1 stays readable', async () => {
    const rationale = 'Evenings slipped; move to mornings + Saturday';

    await page.getByTestId('new-plan-version').click();
    const dialog = page.getByRole('dialog', { name: 'Why is the plan changing?' });
    await dialog.getByLabel(/reason for the change/i).fill(rationale);
    await dialog.getByRole('button', { name: 'Create draft' }).click();

    const v2 = page.getByTestId('plan-version-2');
    await expect(v2.getByText('DRAFT', { exact: true })).toBeVisible();
    await expect(v2.getByText(rationale)).toBeVisible();
    // The routine was CLONED into v2, not moved out of v1.
    await expect(v2.getByText('1 routine')).toBeVisible();

    await v2.getByRole('button', { name: /Version 2, DRAFT/ }).click();
    await page.getByTestId('activate-version-2').click();

    await expect(page.getByTestId('plan-summary').getByText('Plan v2')).toBeVisible();
    const v1 = page.getByTestId('plan-version-1');
    await expect(v1.getByText('SUPERSEDED', { exact: true })).toBeVisible();

    // v1 is still inspectable, with the routine it had — PRD §103's "the user
    // can inspect why the plan changed" needs both sides of the change.
    await v1.getByRole('button', { name: /Version 1, SUPERSEDED/ }).click();
    await expect(v1.getByText('Morning workout')).toBeVisible();
    await expect(v1.getByText('Start with mornings')).toBeVisible();

    // And in the database, through the API.
    const versions = await apiGet<
      Array<{ version: number; status: string; activeUntil: string | null }>
    >(page, `/api/plans/${planId}/versions`);
    expect(versions.map((v) => [v.version, v.status])).toEqual([
      [2, 'ACTIVE'],
      [1, 'SUPERSEDED'],
    ]);
    expect(versions.find((v) => v.version === 1)?.activeUntil).not.toBeNull();
  });

  test('adds a commitment and starts it', async () => {
    await page.getByTestId('add-commitment').click();

    const dialog = page.getByRole('dialog', { name: 'New commitment' });
    await dialog.getByLabel(/what will you do/i).fill('Upper A');
    await dialog.getByLabel('Starts').fill(tomorrowAt(6, 30));
    await dialog.getByLabel('Ends').fill(tomorrowAt(7, 15));
    await dialog.getByLabel(/minimum version/i).fill('10-minute circuit');
    await dialog.getByRole('button', { name: 'Add' }).click();

    const list = page.getByTestId('commitment-list');
    await expect(list.getByText('Upper A')).toBeVisible();
    await expect(list.getByText('Planned', { exact: true })).toBeVisible();

    // The menu offers EXACTLY the API's allowedTransitions for PLANNED.
    await list.getByRole('button', { name: /Change status of Upper A/ }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Ready',
      'Start',
      'Reschedule',
      'Skip',
      'Missed',
      'Cancel',
    ]);

    await menu.getByRole('menuitem', { name: 'Start', exact: true }).click();
    await expect(list.getByText('Started', { exact: true })).toBeVisible();
  });

  test('completes with a note and records one USER_LOG evidence row', async () => {
    const list = page.getByTestId('commitment-list');

    await list.getByRole('button', { name: /Change status of Upper A/ }).click();
    // `exact` — "Partially complete" contains "Complete".
    await page.getByRole('menu').getByRole('menuitem', { name: 'Complete', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Log what happened' });
    await dialog.getByLabel(/how did it go/i).fill('Finished all sets');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(list.getByText('Completed', { exact: true })).toBeVisible();
    await expect(list.getByText('1 evidence · USER_LOG')).toBeVisible();

    const from = new Date();
    from.setDate(from.getDate() - 1);
    const to = new Date();
    to.setDate(to.getDate() + 30);
    const evidence = await apiGet<Array<{ source: string; qualitativeValue: string | null }>>(
      page,
      `/api/evidence?from=${from.toISOString()}&to=${to.toISOString()}`,
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0].source).toBe('USER_LOG');
    expect(evidence[0].qualitativeValue).toBe('Finished all sets');
  });

  test('offers no transitions on a completed commitment', async () => {
    // Terminal: `allowedTransitions` is empty, so there is nothing to open.
    const chip = page
      .getByTestId('commitment-list')
      .getByRole('button', { name: /Change status of Upper A/ });
    await expect(chip).toHaveAttribute('aria-disabled', 'true');
  });

  test('completes a second commitment with an empty dialog and writes NO evidence', async () => {
    const list = page.getByTestId('commitment-list');

    await page.getByTestId('add-commitment').click();
    const create = page.getByRole('dialog', { name: 'New commitment' });
    await create.getByLabel(/what will you do/i).fill('Lower A');
    await create.getByLabel('Starts').fill(tomorrowAt(18, 0));
    await create.getByRole('button', { name: 'Add' }).click();
    await expect(list.getByText('Lower A')).toBeVisible();

    await list.getByRole('button', { name: /Change status of Lower A/ }).click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Start' }).click();
    await list.getByRole('button', { name: /Change status of Lower A/ }).click();
    // `exact` — "Partially complete" contains "Complete".
    await page.getByRole('menu').getByRole('menuitem', { name: 'Complete', exact: true }).click();

    // Saved with nothing filled in: a status change, not an assertion that
    // something happened (PRD §10.9).
    const dialog = page.getByRole('dialog', { name: 'Log what happened' });
    await expect(dialog.getByText('Leave empty to record the status without evidence.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Save' }).click();

    const from = new Date();
    from.setDate(from.getDate() - 1);
    const to = new Date();
    to.setDate(to.getDate() + 30);
    const evidence = await apiGet<unknown[]>(
      page,
      `/api/evidence?from=${from.toISOString()}&to=${to.toISOString()}`,
    );
    // Still ONE — from the first commitment. The second wrote nothing.
    expect(evidence).toHaveLength(1);
  });

  test('carries the reschedule count across two moves', async () => {
    const list = page.getByTestId('commitment-list');

    await page.getByTestId('add-commitment').click();
    const create = page.getByRole('dialog', { name: 'New commitment' });
    await create.getByLabel(/what will you do/i).fill('Mobility');
    await create.getByLabel('Starts').fill(tomorrowAt(9, 0));
    await create.getByRole('button', { name: 'Add' }).click();
    await expect(list.getByText('Mobility')).toBeVisible();

    // THE LIVE ROW, not the first one. After a reschedule the list holds both
    // the closed RESCHEDULED row and its replacement, ordered by start time —
    // so `.first()` picks the closed one, whose chip is disabled because it
    // has no allowed transitions. Selecting on the accessible attribute keeps
    // this off MUI's class names.
    // `[role="button"]`, not the `button` tag: a MUI Chip renders a div.
    const liveMobilityChip = list.locator(
      '[role="button"][aria-label*="Change status of Mobility"]:not([aria-disabled="true"])',
    );

    for (const [move, expected] of [
      [3, 'rescheduled ×1'],
      [5, 'rescheduled ×2'],
    ] as const) {
      await liveMobilityChip.click();
      await page.getByRole('menu').getByRole('menuitem', { name: 'Reschedule' }).click();

      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(/move it to/i).fill(daysAheadAt(move, 9, 0));
      await dialog.getByRole('button', { name: 'Reschedule' }).click();

      // The count is on the LIVE row, because it travels with the intention
      // rather than staying on the closed one.
      await expect(list.getByText(expected)).toBeVisible();
    }

    await expect(list.getByText('Rescheduled', { exact: true }).first()).toBeVisible();

    const from = new Date();
    from.setDate(from.getDate() - 1);
    const to = new Date();
    to.setDate(to.getDate() + 30);
    const closed = await apiGet<unknown[]>(
      page,
      `/api/commitments?from=${from.toISOString()}&to=${to.toISOString()}&status=RESCHEDULED`,
    );
    expect(closed).toHaveLength(2);
  });

  test('has no serious accessibility violations on a populated outcome', async () => {
    const violations = await seriousAxeViolations(page);
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  test('archives the outcome, hiding it until "Show archived"', async () => {
    await page.getByRole('button', { name: `Actions for ${OUTCOME_TITLE}` }).click();
    await page.getByTestId('outcome-archive').click();
    await page.getByTestId('confirm-archive').click();

    await page.waitForURL('/path');
    await expect(page.getByText(OUTCOME_TITLE)).toHaveCount(0);

    await page.getByTestId('show-archived').click();
    await expect(page.getByText(OUTCOME_TITLE)).toBeVisible();
    await expect(page.getByText('ARCHIVED', { exact: true })).toBeVisible();
  });

  test('has no serious accessibility violations on a populated Path', async () => {
    const violations = await seriousAxeViolations(page);
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  test("answers another user's outcome with 404 and a not-found screen", async ({ browser }) => {
    // A SEPARATE CONTEXT, so nothing of the first user's session leaks.
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();

    try {
      await loginAsTestUser(otherPage, { email: uniqueEmail('other'), withAiKey: true });
      await otherPage.goto(outcomeUrl);

      // Not a 403: that would confirm the id is real. Unowned and unknown are
      // deliberately indistinguishable.
      await expect(otherPage.getByText('Outcome not found')).toBeVisible();

      const { accessToken } = await import('../helpers/path.helper');
      const token = await accessToken(otherPage);
      const response = await otherPage.request.get(`/api/outcomes/${outcomeId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status()).toBe(404);
      expect((await response.json()).code).toBe('NOT_FOUND');
    } finally {
      await otherContext.close();
    }
  });
});
