import { Page } from '@playwright/test';

export interface TestUserOptions {
  email: string;
  role?: 'admin' | 'contributor' | 'viewer';
  displayName?: string;
  /**
   * Seed an OpenAI key so the login lands on the app rather than on the
   * `/setup/ai-key` gate (#29, epic #20).
   *
   * DEFAULTS TO `true`, the opposite of the checkbox's own default. Every
   * existing spec expects to land on `/`, and every one of them is about
   * something other than the key gate; making them opt IN would mean editing
   * all of them to keep testing what they already test. A spec that wants the
   * keyless path asks for it explicitly.
   */
  withAiKey?: boolean;
}

/**
 * Login as a test user via the test login page.
 * This bypasses OAuth and is only available in development/test environments.
 */
export async function loginAsTestUser(
  page: Page,
  options: TestUserOptions
): Promise<void> {
  await page.goto('/testing/login');

  // Fill email
  await page.fill('[data-testid="test-email-input"]', options.email);

  // Select role if specified
  if (options.role) {
    await page.click('[data-testid="test-role-select"]');
    await page.click(`[data-value="${options.role}"]`);
  }

  // Fill display name if specified
  if (options.displayName) {
    await page.fill('input[name="displayName"]', options.displayName);
  }

  // Seed an OpenAI key unless the caller wants the gate. Unchecked by default
  // in the form, so this is a click rather than a toggle.
  const withAiKey = options.withAiKey ?? true;
  if (withAiKey) {
    await page.check('[data-testid="test-with-ai-key"]');
  }

  // Submit form
  await page.click('[data-testid="test-login-button"]');

  // Wait for redirect to complete (auth callback, then either the app or the
  // AI-key gate).
  await page.waitForURL(withAiKey ? '/' : '/setup/ai-key', { timeout: 10000 });
}

/**
 * Login as an admin test user.
 */
export async function loginAsAdmin(
  page: Page,
  email = 'admin@test.local',
  options: Pick<TestUserOptions, 'withAiKey'> = {}
): Promise<void> {
  await loginAsTestUser(page, { email, role: 'admin', ...options });
}

/**
 * Login as a contributor test user.
 */
export async function loginAsContributor(
  page: Page,
  email = 'contributor@test.local'
): Promise<void> {
  await loginAsTestUser(page, { email, role: 'contributor' });
}

/**
 * Login as a viewer test user.
 */
export async function loginAsViewer(
  page: Page,
  email = 'viewer@test.local'
): Promise<void> {
  await loginAsTestUser(page, { email, role: 'viewer' });
}

/**
 * Check if the user is logged in by checking for the user menu.
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.waitForSelector('[data-testid="user-menu"]', { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Logout the current user.
 */
export async function logout(page: Page): Promise<void> {
  await page.click('[data-testid="user-menu"]');
  await page.click('[data-testid="logout-button"]');
  await page.waitForURL('/login');
}
