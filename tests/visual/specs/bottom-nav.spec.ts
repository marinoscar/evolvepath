import { expect, test } from '@playwright/test';
import { harnessUrl, waitForInter } from '../support/harness';

/**
 * The five-tab bottom bar at 360px — the narrowest phone this product targets
 * (PRD §123 makes mobile the primary platform).
 *
 * THIS SPEC EXISTS BECAUSE THE CLAIM IS A LAYOUT CLAIM. #51 replaced three
 * destinations with five, and five labelled tabs only fit because
 * `BottomNavigationAction` gets `minWidth: 0`: MUI's default is 80px, and five
 * of those is 400px of content in a 360px bar. A unit test can see the five
 * buttons exist; only a real browser can see whether their labels survive.
 *
 * The DOM assertions run BEFORE the screenshot and are the ones that name the
 * failure. A pixel diff on a truncated label says "something moved"; the
 * `scrollWidth <= clientWidth` check says "the labels no longer fit", which is
 * the sentence a reader needs.
 */

test.describe('Bottom navigation — five tabs at 360px', () => {
  test('fits five labelled tabs with no truncation', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(harnessUrl({ route: '/path' }));
    // Inter must be in before any pixel is captured - see waitForInter (#111).
    await waitForInter(page);

    const bar = page.locator('.MuiBottomNavigation-root');
    await expect(bar).toBeVisible();

    const actions = bar.locator('button.MuiBottomNavigationAction-root');
    await expect(actions).toHaveCount(5);

    // Console is `pinned` and the bar omits pinned destinations — the harness
    // user is an admin, so this is a real assertion rather than a tautology.
    await expect(bar.getByRole('button', { name: 'Console' })).toHaveCount(0);

    for (const name of ['Today', 'Path', 'Coach', 'Progress', 'Profile']) {
      const action = bar.getByRole('button', { name });
      await expect(action).toBeVisible();

      // `noWrap`/`text-overflow: ellipsis` truncation shows up as content
      // wider than the box holding it. Measured on the label element, which is
      // the one MUI applies the overflow rule to.
      const label = action.locator('.MuiBottomNavigationAction-label');
      const fits = await label.evaluate((el) => el.scrollWidth <= el.clientWidth);
      expect(fits, `${name} label is truncated at 360px`).toBe(true);
    }

    const paper = page.locator('.MuiPaper-root', { has: bar });
    await expect(paper).toHaveScreenshot('bottom-nav-360px-five-tabs.png');
  });
});
