import { expect, test } from '@playwright/test';

import { loginAsTestUser } from '../helpers/auth.helper';
import { describeViolations, seriousAxeViolations, uniqueEmail } from '../helpers/path.helper';

// =============================================================================
// The product shell — PRD §11's five destinations, in a real browser (#62)
// =============================================================================
//
// RUNS ON BOTH PROJECTS, and the two are testing different components rather
// than the same one at two sizes: below `sm` (Pixel 7 is 412px) the shell
// mounts `BottomNav`, and at or above it `NavigationRail`. A desktop-only
// suite would never load the bar at all.
//
// The `project` guards below are therefore not "skip the awkward case" — each
// half asserts something that only exists in that window class.
// =============================================================================

const DESTINATIONS = ['Today', 'Path', 'Coach', 'Progress', 'Profile'];

test.describe('product shell navigation', () => {
  test('lands on Today with a way into Path', async ({ page }) => {
    await loginAsTestUser(page, { email: uniqueEmail('nav'), withAiKey: true });

    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('today-empty-state')).toBeVisible();
    await page.getByRole('link', { name: 'Go to Path' }).click();
    await expect(page).toHaveURL('/path');
  });

  test('shows five labelled tabs and no Console on a phone', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'The bottom bar exists below sm only');

    // An ADMIN, so "no Console" is a real assertion rather than a permission
    // check passing by accident.
    await loginAsTestUser(page, { email: uniqueEmail('nav-admin'), role: 'admin', withAiKey: true });

    const bar = page.locator('.MuiBottomNavigation-root');
    await expect(bar).toBeVisible();

    for (const name of DESTINATIONS) {
      await expect(bar.getByRole('button', { name })).toBeVisible();
    }
    await expect(bar.getByRole('button', { name: 'Console' })).toHaveCount(0);
    await expect(bar.getByRole('button')).toHaveCount(5);

    await bar.getByRole('button', { name: 'Path' }).click();
    await expect(page).toHaveURL('/path');
    await expect(bar.getByRole('button', { name: 'Path' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('reaches Console from the avatar menu on a phone', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'Phone-only affordance');

    await loginAsTestUser(page, { email: uniqueEmail('nav-menu'), role: 'admin', withAiKey: true });

    await page.getByTestId('user-menu').click();
    await expect(page.getByRole('menuitem', { name: 'Console' })).toBeVisible();
  });

  test('shows the five rows with Console pinned at the rail foot on desktop', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'The rail exists at sm and up only');

    await loginAsTestUser(page, { email: uniqueEmail('nav-rail'), role: 'admin', withAiKey: true });

    const rail = page.locator('nav[aria-label="Main navigation"]');
    await expect(rail).toBeVisible();

    for (const name of DESTINATIONS) {
      await expect(rail.getByRole('link', { name })).toBeVisible();
    }
    // Console IS on the rail — it has a foot to pin it to, unlike the bar.
    await expect(rail.getByRole('link', { name: 'Console' })).toBeVisible();
  });

  test('shows the drill-down back arrow on an outcome route', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'The drill-down bar is below sm only');

    await loginAsTestUser(page, { email: uniqueEmail('nav-drill'), withAiKey: true });

    // Any id: the bar resolves its title from the PATH, before the page knows
    // whether the outcome exists.
    await page.goto('/path/outcomes/00000000-0000-4000-8000-000000000000');

    await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
    await expect(page.getByText('Outcome', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL('/path');
  });

  for (const route of ['/', '/path', '/coach', '/progress']) {
    test(`has no serious accessibility violations on ${route}`, async ({ page }) => {
      await loginAsTestUser(page, { email: uniqueEmail('nav-axe'), withAiKey: true });
      await page.goto(route);
      // The shell's own chrome renders before the page body settles; wait for
      // something on the page itself so axe sees the finished DOM.
      await page.waitForLoadState('networkidle');

      const violations = await seriousAxeViolations(page);
      expect(violations, describeViolations(violations)).toEqual([]);
    });
  }
});
