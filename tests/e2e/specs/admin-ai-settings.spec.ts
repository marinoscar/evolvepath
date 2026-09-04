import { test, expect } from '@playwright/test';
import { loginAsAdmin } from '../helpers/auth.helper';

/**
 * The admin AI settings page, end to end (issue #24/#27, proven here by #30).
 *
 * What only this level can show: that the GPT ≥ 5.4 filter reaches the actual
 * `<select>` a person clicks. The stand-in serves `gpt-5.3`, `gpt-4o` and
 * `gpt-5.5-realtime` alongside the two supported models precisely so a broken
 * filter is visible here rather than passing a unit test against a list nobody
 * assembled.
 *
 * Runs against the `fake-openai` overlay — see `tools/fake-openai/README.md`.
 */

const PLATFORM_KEY = 'sk-test-platform-0000000000';

/** Served by the stand-in and dropped by the >= 5.4 filter. */
const UNSUPPORTED = ['gpt-5.3', 'gpt-4o', 'gpt-5.5-realtime'];

test.describe('admin AI settings', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, `ai-admin-${Date.now()}@test.local`);
  });

  test('is reachable from the settings hub as a registry card', async ({ page }) => {
    await page.goto('/admin/settings');

    await page.getByRole('link', { name: /AI/ }).first().click();

    await expect(page).toHaveURL(/\/admin\/settings\/ai$/);
    await expect(page.getByRole('heading', { name: 'AI', level: 1 })).toBeVisible();
  });

  test('stores the platform key write-only and never echoes it back', async ({ page }) => {
    await page.goto('/admin/settings/ai');

    await page.getByRole('radio', { name: 'OpenAI' }).check();
    await page.getByLabel('Enable AI features').check();
    await page.getByLabel('Platform API key').fill(PLATFORM_KEY);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('AI settings saved')).toBeVisible();

    // Emptied on save, and only the mask is shown afterwards.
    await expect(page.getByLabel('Platform API key')).toHaveValue('');
    await expect(page.getByText(/Configured · ••••/)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(PLATFORM_KEY);
  });

  test('offers only GPT 5.4 and newer in the model selects', async ({ page }) => {
    await page.goto('/admin/settings/ai');
    await page.getByRole('radio', { name: 'OpenAI' }).check();
    await page.getByLabel('Enable AI features').check();
    await page.getByLabel('Platform API key').fill(PLATFORM_KEY);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('AI settings saved')).toBeVisible();

    await page.getByRole('button', { name: 'Refresh models' }).click();
    await expect(page.getByText(/live/)).toBeVisible();

    await page.getByLabel('Default model').click();

    await expect(page.getByRole('option', { name: 'gpt-5.4', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'gpt-5.4-mini' })).toBeVisible();
    for (const id of UNSUPPORTED) {
      await expect(page.getByRole('option', { name: id })).toHaveCount(0);
    }

    await page.getByRole('option', { name: 'gpt-5.4', exact: true }).click();

    // A per-persona override, saved alongside the default.
    await page.getByLabel('Model for Coach').click();
    await page.getByRole('option', { name: 'gpt-5.4-mini' }).click();

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('AI settings saved')).toBeVisible();
  });

  test('tests the connection and reports both probes', async ({ page }) => {
    await page.goto('/admin/settings/ai');
    await page.getByRole('radio', { name: 'OpenAI' }).check();
    await page.getByLabel('Enable AI features').check();
    await page.getByLabel('Platform API key').fill(PLATFORM_KEY);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('AI settings saved')).toBeVisible();

    await page.getByRole('button', { name: 'Refresh models' }).click();
    await page.getByLabel('Default model').click();
    await page.getByRole('option', { name: 'gpt-5.4', exact: true }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('AI settings saved')).toBeVisible();

    await page.getByRole('button', { name: 'Test connection' }).click();

    const result = page.getByRole('region', { name: 'Test result' });
    await expect(result).toContainText('Connection works');
    await expect(result).toContainText('models passed · generate passed');
  });

  test('rejects a model below the floor at the API, not only in the UI', async ({
    page,
  }) => {
    // Through `page.request`, so the assertion is about the API's own rule
    // rather than about a select that simply did not offer the option.
    //
    // THE TOKEN COMES FROM `/auth/refresh`, NOT FROM `localStorage`. This app
    // keeps the access token in memory (`ApiService.setAccessToken`) and only
    // the refresh token in a cookie — deliberately, so an XSS cannot read it.
    // `page.request` shares the browser context's cookies, so minting a fresh
    // access token is the supported way for a spec to make an authenticated
    // call of its own.
    await page.goto('/admin/settings/ai');

    const refreshed = await page.request.post('/api/auth/refresh');
    expect(refreshed.ok()).toBe(true);
    const refreshBody = await refreshed.json();
    const token: string = refreshBody.data?.accessToken ?? refreshBody.accessToken;
    expect(token).toBeTruthy();

    const authorized = { authorization: `Bearer ${token}` };

    const current = await page.request.get('/api/ai-settings', { headers: authorized });
    const version = (await current.json()).data.version as number;

    const response = await page.request.put('/api/ai-settings', {
      headers: { ...authorized, 'if-match': String(version) },
      data: {
        provider: 'openai',
        enabled: true,
        defaultModel: 'gpt-5.3',
        personaModels: {},
      },
    });

    expect(response.status()).toBe(400);
    expect(await response.text()).toContain('gpt-5.3');

    // The stored row is untouched by the rejected write.
    const after = await page.request.get('/api/ai-settings', { headers: authorized });
    expect((await after.json()).data.version).toBe(version);
  });

  test('renders the persona matrix as cards on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/settings/ai');

    await expect(page.getByTestId('persona-model-cards')).toBeVisible();
    await expect(page.getByTestId('persona-model-table')).toHaveCount(0);
  });
});
