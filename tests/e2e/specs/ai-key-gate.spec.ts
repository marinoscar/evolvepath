import { test, expect } from '@playwright/test';
import { loginAsTestUser } from '../helpers/auth.helper';

/**
 * The AI-key gate, end to end (issue #29, proven here by #30, epic #20).
 *
 * The one path in this product that CANNOT be proven by unit tests: it spans
 * the encrypted credential store, the API's `aiKey` on `/auth/me`, the web
 * app's route tree, and the fake OpenAI server standing in for the provider.
 * Every one of those has its own tests; none of them can tell you whether a
 * user who signs in without a key ends up somewhere they can fix it.
 *
 * Runs against the `fake-openai` overlay — see `tools/fake-openai/README.md`.
 */

/** Accepted by the stand-in (any `sk-test-` prefix) and long enough for the DTO. */
const GOOD_KEY = 'sk-test-e2e-playwright-0000';

/** Rejected by the stand-in with OpenAI's own 401 wording. */
const BAD_KEY = 'sk-wrong-000000000000000000';

test.describe('AI key gate', () => {
  test('a signed-in user with no key is held on the setup page', async ({ page }) => {
    await loginAsTestUser(page, {
      email: `gate-${Date.now()}@test.local`,
      role: 'viewer',
      withAiKey: false,
    });

    await expect(page).toHaveURL(/\/setup\/ai-key$/);
    await expect(
      page.getByRole('heading', { name: 'Connect your OpenAI API key' }),
    ).toBeVisible();

    // No app chrome: none of those destinations work yet.
    await expect(page.getByTestId('bottom-nav')).toHaveCount(0);
    await expect(page.getByTestId('user-menu')).toHaveCount(0);

    // Every shell route bounces back, including the admin surface and the key
    // page itself.
    for (const path of ['/', '/settings', '/admin/settings', '/settings/ai-key']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/setup\/ai-key$/);
    }
  });

  test('a bad key is diagnosed with the provider’s own message', async ({ page }) => {
    await loginAsTestUser(page, {
      email: `gate-bad-${Date.now()}@test.local`,
      role: 'viewer',
      withAiKey: false,
    });

    // Test is unavailable until something is stored — the API tests what is
    // SAVED, so a "test before saving" button would have to save silently.
    await expect(page.getByRole('button', { name: 'Test key' })).toBeDisabled();

    await page.getByLabel('OpenAI API key').fill(BAD_KEY);
    await page.getByRole('button', { name: 'Save and continue' }).click();

    // The save succeeds — the API stores whatever is well-formed — so the user
    // is carried into the app. Come back to test it.
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/settings/ai-key');

    await page.getByRole('button', { name: 'Test key' }).click();

    const result = page.getByRole('region', { name: 'Test result' });
    await expect(result).toContainText('Test failed');
    await expect(result).toContainText('Incorrect API key provided: sk-***');
    await expect(result).toContainText('models failed');
  });

  test('a good key lets the user through, and removing it sends them back', async ({
    page,
  }) => {
    await loginAsTestUser(page, {
      email: `gate-good-${Date.now()}@test.local`,
      role: 'viewer',
      withAiKey: false,
    });

    await page.getByLabel('OpenAI API key').fill(GOOD_KEY);
    await page.getByRole('button', { name: 'Save and continue' }).click();

    await expect(page).toHaveURL(/\/$/);

    await page.goto('/settings/ai-key');
    await expect(page.getByText(/Configured/)).toBeVisible();

    await page.getByRole('button', { name: 'Remove key' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('asked for a key again');
    await dialog.getByRole('button', { name: 'Remove key' }).click();

    // The promise the dialog makes, kept.
    await expect(page).toHaveURL(/\/setup\/ai-key$/);
  });

  test('a seeded key skips the gate entirely', async ({ page }) => {
    // The default for every other e2e spec in this repo, asserted once here so
    // it is not merely assumed by all of them.
    await loginAsTestUser(page, {
      email: `gate-seeded-${Date.now()}@test.local`,
      role: 'viewer',
    });

    await expect(page).toHaveURL(/\/$/);
  });
});
