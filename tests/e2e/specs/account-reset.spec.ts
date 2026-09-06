import { expect, test, type Page } from '@playwright/test';

import { loginAsTestUser } from '../helpers/auth.helper';
import { apiGet, seriousAxeViolations, uniqueEmail } from '../helpers/path.helper';
import { createCommitment } from '../helpers/commitments.helper';
import { seedRoutinePlan } from '../helpers/progress.helper';

// =============================================================================
// E13 Account data reset end to end (epic #220, issue #226)
// =============================================================================
//
// Every claim this feature makes is a claim about a DELETION, which is the
// hardest kind to test by accident. A reset that quietly skipped a table, or
// deleted one thing too many, would pass any test that only checks for a 200
// and a redirect.
//
// Three properties this file exists to prove, none of which a unit test can:
//
//   1. THE SCREEN AND THE API AGREE. The counts the dialog shows are asserted
//      against `GET /api/account/data-summary`, and the emptiness afterwards is
//      asserted the same way — not inferred from the screen having changed.
//   2. THE GATE IS REAL IN A BROWSER. A wrong phrase leaves the confirm control
//      inert, and the request is never made.
//   3. THE ACCOUNT SURVIVES. This is the feature's central promise and the one
//      most easily broken by a later change: after a reset the user is still
//      signed in, and `GET /api/auth/me` still answers for them. Asserting it
//      is the point — assuming it is how it would regress unnoticed.
//
// SEEDED THROUGH THE API, never the database, and a FRESH USER PER TEST: the
// suite is `fullyParallel` against one database, so a shared email would make
// every count assertion a race.
// =============================================================================

interface DataSummary {
  counts: Record<string, number>;
  phrases: { data: string; data_and_key: string };
}

async function signIn(page: Page, prefix: string): Promise<string> {
  const email = uniqueEmail(prefix);
  await loginAsTestUser(page, { email, role: 'contributor' });
  return email;
}

/** One outcome, one plan, one commitment — enough that a reset has something to take. */
async function seedSomethingToLose(page: Page) {
  const plan = await seedRoutinePlan(page, {
    domain: 'WORK',
    outcomeTitle: 'Ship the proposal',
    routineTitle: 'Morning focus block',
    estimatedMinutes: 50,
    minimumMinutes: 10,
  });

  await createCommitment(page, {
    domain: 'WORK',
    title: 'Morning focus block',
    outcomeId: plan.outcomeId,
    scheduledStart: new Date(Date.now() + 3_600_000).toISOString(),
    scheduledEnd: new Date(Date.now() + 7_200_000).toISOString(),
  });
}

async function summary(page: Page): Promise<DataSummary> {
  return apiGet<DataSummary>(page, '/api/account/data-summary');
}

test.describe('E13 — the Danger zone', () => {
  test('is reachable from the settings hub as its own group', async ({ page }) => {
    await signIn(page, 'reset-hub');

    await page.goto('/settings');

    await expect(page.getByText('Danger zone')).toBeVisible();
    await expect(
      page.getByRole('link', { name: /reset your data/i }).or(
        page.getByText('Reset your data'),
      ).first(),
    ).toBeVisible();
  });

  test('shows the counts the API reports, not a static warning', async ({ page }) => {
    await signIn(page, 'reset-counts');
    await seedSomethingToLose(page);

    const before = await summary(page);
    expect(before.counts.commitments).toBeGreaterThan(0);
    expect(before.counts.outcomes).toBeGreaterThan(0);

    await page.goto('/settings/reset');

    // Asserted twice, as this suite does everywhere: once against the JSON
    // above, once against what the reader actually sees.
    await expect(
      page.getByText(new RegExp(`${before.counts.commitments} commitment`, 'i')),
    ).toBeVisible();
  });

  test('refuses a wrong phrase without sending anything', async ({ page }) => {
    await signIn(page, 'reset-refuse');
    await seedSomethingToLose(page);

    const before = await summary(page);

    await page.goto('/settings/reset');
    await page.getByRole('button', { name: /^reset my data$/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Lower case: the service's comparison is case-sensitive on purpose.
    await dialog.getByLabel(/delete my data/i).fill('delete my data');

    await expect(
      dialog.getByRole('button', { name: /^reset my data$/i }),
    ).toBeDisabled();

    // And nothing moved.
    const after = await summary(page);
    expect(after.counts).toEqual(before.counts);
  });

  test('erases the data, lands on onboarding, and leaves the account signed in', async ({
    page,
  }) => {
    await signIn(page, 'reset-run');
    await seedSomethingToLose(page);

    const before = await summary(page);
    expect(before.counts.commitments).toBeGreaterThan(0);

    await page.goto('/settings/reset');
    await page.getByRole('button', { name: /^reset my data$/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/delete my data/i).fill(before.phrases.data);

    const confirm = dialog.getByRole('button', { name: /^reset my data$/i });
    await expect(confirm).toBeEnabled();
    await confirm.click();

    // Deleting `user_profiles` clears onboarding completion, so the wizard is
    // the honest destination — a shell with nothing in it is not.
    await page.waitForURL(/\/onboarding/, { timeout: 15_000 });

    const after = await summary(page);
    expect(after.counts.commitments).toBe(0);
    expect(after.counts.outcomes).toBe(0);

    // THE CENTRAL PROMISE. A data reset, not an account deletion: the fact that
    // `GET /api/auth/me` still answers is the whole boundary this feature draws,
    // and the thing a later change is most likely to break quietly.
    const me = await apiGet<{ email: string }>(page, '/api/auth/me');
    expect(me.email).toBeTruthy();
  });

  test('keeps the stored AI key on the narrow scope', async ({ page }) => {
    await signIn(page, 'reset-keeps-key');
    await seedSomethingToLose(page);

    const before = await summary(page);

    await page.goto('/settings/reset');
    await page.getByRole('button', { name: /^reset my data$/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/delete my data/i).fill(before.phrases.data);
    await dialog.getByRole('button', { name: /^reset my data$/i }).click();

    await page.waitForURL(/\/onboarding/, { timeout: 15_000 });

    const key = await apiGet<{ configured: boolean }>(page, '/api/me/ai-key');
    expect(key.configured).toBe(true);
  });

  test('removes the stored AI key on the wide scope and re-arms the key gate', async ({
    page,
  }) => {
    await signIn(page, 'reset-drops-key');
    await seedSomethingToLose(page);

    const before = await summary(page);

    await page.goto('/settings/reset');
    await page.getByRole('button', { name: /^reset everything$/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog
      .getByLabel(/delete everything/i)
      .fill(before.phrases.data_and_key);
    await dialog.getByRole('button', { name: /^reset everything$/i }).click();

    await page.waitForURL(/\/setup\/ai-key/, { timeout: 15_000 });

    const key = await apiGet<{ configured: boolean }>(page, '/api/me/ai-key');
    expect(key.configured).toBe(false);
  });

  test('has no serious accessibility violations, page or dialog', async ({ page }) => {
    await signIn(page, 'reset-a11y');
    await seedSomethingToLose(page);

    await page.goto('/settings/reset');
    expect(await seriousAxeViolations(page)).toEqual([]);

    await page.getByRole('button', { name: /^reset my data$/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await seriousAxeViolations(page)).toEqual([]);
  });
});
