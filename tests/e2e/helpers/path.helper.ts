import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * A throwaway address nobody else in this run will use.
 *
 * Playwright runs specs in parallel against ONE database. Two specs sharing an
 * email share a user, and therefore share outcomes — so a "the list has one
 * outcome" assertion becomes a race that passes alone and fails in a full run.
 * The random suffix matters as much as the timestamp: two workers starting in
 * the same millisecond is not hypothetical.
 */
export function uniqueEmail(prefix: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${suffix}@test.local`;
}

/**
 * Tomorrow at a given local time, as a `datetime-local` input value.
 *
 * COMPUTED IN THE BROWSER'S TIMEZONE, not in UTC. `<input type="datetime-local">`
 * holds wall-clock text with no zone, and the app converts it to an instant
 * using the browser's own offset — so a UTC-derived string would be entered as
 * a different wall-clock time than intended and the assertion about "06:30"
 * would fail anywhere but Greenwich.
 */
export function tomorrowAt(hour: number, minute: number): string {
  const when = new Date();
  when.setDate(when.getDate() + 1);
  when.setHours(hour, minute, 0, 0);

  const pad = (value: number) => String(value).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

/** `daysAhead` days from now at a given local time, same format. */
export function daysAheadAt(daysAhead: number, hour: number, minute: number): string {
  const when = new Date();
  when.setDate(when.getDate() + daysAhead);
  when.setHours(hour, minute, 0, 0);

  const pad = (value: number) => String(value).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

/**
 * Serious and critical axe violations on the current page.
 *
 * FILTERED TO serious/critical DELIBERATELY. A blanket "zero violations" gate
 * over a third-party component library fails on `moderate` findings nobody in
 * this repo can fix (MUI's own colour-contrast choices, for instance), and a
 * gate that cannot be satisfied gets disabled — at which point it catches
 * nothing at all. Serious and critical are the levels that actually block a
 * user, and they stay enforced.
 */
export async function seriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}

/** A readable failure message: the rule, its impact, and where it is. */
export function describeViolations(
  violations: Awaited<ReturnType<typeof seriousAxeViolations>>,
): string {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n  ${violation.nodes
          .map((node) => node.target.join(' '))
          .join('\n  ')}`,
    )
    .join('\n');
}

/**
 * A bearer token for the signed-in user, minted from their refresh cookie.
 *
 * NOT READ FROM `localStorage`, because it is not there: `services/api.ts`
 * keeps the access token in a private field on the `ApiService` instance and
 * persists only the HttpOnly refresh cookie. That is the right design — a
 * token in `localStorage` is readable by any script on the page — and it means
 * a spec cannot simply lift the app's token.
 *
 * `page.request` shares the browser context's cookie jar, so `POST
 * /auth/refresh` exchanges that cookie for a fresh access token exactly as the
 * app does. Playwright cannot reach the database, so this is how the specs
 * assert persisted state: through the API, as the user.
 */
export async function accessToken(page: Page): Promise<string> {
  const response = await page.request.post('/api/auth/refresh');

  if (!response.ok()) {
    throw new Error(
      `Could not mint an access token (POST /api/auth/refresh → ${response.status()}). ` +
        'Is the page signed in?',
    );
  }

  const body = (await response.json()) as { data?: { accessToken?: string } };
  const token = body.data?.accessToken;
  if (!token) {
    throw new Error(`No accessToken in the refresh response: ${JSON.stringify(body)}`);
  }
  return token;
}

/** A GET against the API as the signed-in user, with the body on a failure. */
export async function apiGet<T>(page: Page, path: string): Promise<T> {
  const token = await accessToken(page);
  const response = await page.request.get(path, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok()) {
    throw new Error(`GET ${path} → ${response.status()}: ${await response.text()}`);
  }

  const body = (await response.json()) as { data: T };
  return body.data;
}
