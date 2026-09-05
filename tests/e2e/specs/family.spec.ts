import { test, expect, type Page } from '@playwright/test';

import { loginAsTestUser } from '../helpers/auth.helper';
import { uniqueEmail, withToken } from '../helpers/path.helper';
import { getCommitment } from '../helpers/commitments.helper';
import {
  apiPostRaw,
  createMember,
  createRitual,
  daysFromNow,
  getSummary,
  laterTodayHHmm,
  lint,
  listFamilyCommitments,
  listMembers,
  listRituals,
  materialize,
  mondayOf,
  placeholderBirthdayIn,
  updateRitual,
  utcDate,
  utcWeekday,
  type SeededRitual,
} from '../helpers/family.helper';

// =============================================================================
// E08 — the Family domain, end to end (issue #53)
// =============================================================================
//
// PRD §105's five family criteria, proved through a browser against the real
// API and database:
//
//   1. Create a family commitment, with a recurrence.
//   2. Complete it.
//   3. Move it.
//   4. Skip it.
//   5. THE PRODUCT NEVER CREATES A FAMILY-QUALITY SCORE.
//
// Plus the two rules the epic exists to hold. PRD §32: a commitment describes
// the user's OWN behaviour, refused deterministically whether or not the coach
// is reachable. And cancel-not-delete: editing a recurrence withdraws the
// future occurrences and leaves the record of what the user actually did.
//
// SEEDED THROUGH THE API, never the database — Playwright cannot reach
// Postgres, and going through the create contracts exercises the lint and the
// materializer too.
//
// A FRESH USER PER TEST. The suite is `fullyParallel` against one database, so
// a shared email is a shared board and every count assertion becomes a race.
//
// ON TIME. `user_profiles.timezone` defaults to UTC and the container's clock
// is UTC, so "tonight" is computable from `new Date()`. A run that starts too
// late in the day cannot have a future occurrence today; the cases that need
// one say so explicitly rather than failing.
// =============================================================================

/** The words the API and the UI both use for a refused title. */
const LINT_MESSAGE =
  'Describe what you will do, not how someone else should feel or behave.';

async function signIn(page: Page, prefix: string, role: 'contributor' | 'admin' = 'contributor') {
  await loginAsTestUser(page, { email: uniqueEmail(prefix), role });
}

/** Today plus two other weekdays, so at least one occurrence is due today. */
function weekdaysIncludingToday(): number[] {
  const today = utcWeekday();

  return [today, (today + 2) % 7, (today + 4) % 7];
}

/** A ritual due today at a still-future time, or `null` too late in the day. */
async function seedTonight(page: Page, title = 'Phone-free dinner'): Promise<SeededRitual | null> {
  const time = laterTodayHHmm(2);
  if (time === null) return null;

  return createRitual(page, {
    title,
    purpose: 'Be present at the table',
    recurrence: { weekdays: weekdaysIncludingToday(), time, everyNWeeks: 1 },
    idealMinutes: 45,
    minimumMinutes: 10,
    fallbackBehavior: 'Sit down phone-free for the first 10 minutes',
  });
}

const WINDOW = () => ({
  from: new Date(Date.now() - 60_000).toISOString(),
  to: new Date(Date.now() + 8 * 24 * 3600_000).toISOString(),
});

test.describe('E08 — family rituals, commitments and the review', () => {
  test('member → ritual → Today → I’m in → complete → the summary says kept 1', async ({ page }) => {
    await signIn(page, 'e08-keep');

    // --- The member, through the UI --------------------------------------
    await page.goto('/path/family');
    await page.getByTestId('family-add-member').click();
    await page.getByTestId('member-nickname').fill('Mia');
    await page.getByTestId('member-birthday').fill(placeholderBirthdayIn(5).replace('1900', '2026'));
    await page.getByTestId('member-save').click();

    await expect(page.getByText('Mia · Partner')).toBeVisible();

    // Exactly the five keys PRD §33 permits, on the wire.
    const [member] = await listMembers(page);
    expect(Object.keys(member).sort()).toEqual(
      ['birthday', 'createdAt', 'id', 'nickname', 'relationship'].sort(),
    );

    // --- The ritual, through the UI --------------------------------------
    const time = laterTodayHHmm(2);
    test.skip(time === null, 'Too late in the day for a future occurrence');

    await page.getByTestId('family-create-ritual').click();
    await page.getByTestId('ritual-title').fill('Phone-free dinner');

    for (const weekday of weekdaysIncludingToday()) {
      await page.getByTestId(`recurrence-weekday-${weekday}`).click();
    }
    await page.getByTestId('recurrence-time').fill(time!);
    await page.getByTestId('ritual-ideal').fill('45');
    await page.getByTestId('ritual-minimum').fill('10');
    await page.getByTestId('ritual-fallback').fill('Sit down phone-free for the first 10 minutes');
    await page.getByTestId('ritual-save').click();

    await expect(page.getByText(/45 min \(min 10\)/)).toBeVisible();

    // --- Materialized, and idempotently ----------------------------------
    const { from, to } = WINDOW();
    const occurrences = await listFamilyCommitments(page, from, to);

    expect(occurrences.length).toBeGreaterThanOrEqual(1);
    expect(occurrences.every((row) => row.ritualId !== null)).toBe(true);
    expect(occurrences[0]).toMatchObject({
      domain: 'FAMILY',
      status: 'PLANNED',
      fullMinutes: 45,
      minimumMinutes: 10,
      minimumVersion: 'Sit down phone-free for the first 10 minutes',
    });

    const today = occurrences.filter((row) => row.scheduledStart.slice(0, 10) === utcDate());
    expect(today).toHaveLength(1);

    const [ritual] = await listRituals(page);
    // The unique index turns a repeat into `skipped`, never a duplicate row.
    await expect(materialize(page, ritual.id)).resolves.toMatchObject({ created: 0 });
    expect(await listFamilyCommitments(page, from, to)).toHaveLength(occurrences.length);

    // --- Today: the cue, "I'm in", then done ------------------------------
    await page.goto('/');
    const familyCard = page.getByTestId('domain-card-FAMILY');

    await expect(familyCard).toContainText('Phone-free dinner');
    await expect(page.getByTestId('today-birthday-cue')).toContainText(/Mia.s birthday in 5 days/);

    await familyCard.getByRole('button', { name: "I'm in: Phone-free dinner" }).click();

    // The row now offers E05's Start — the ordinary lifecycle, in family words.
    await expect(familyCard.getByRole('button', { name: 'Start: Phone-free dinner' })).toBeVisible();

    await familyCard.getByRole('button', { name: 'Actions for Phone-free dinner' }).click();
    await page.getByRole('menuitem', { name: 'Complete' }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();

    await expect(familyCard.getByText('Kept')).toBeVisible();

    const completed = await getCommitment(page, today[0].id);
    expect(completed.status).toBe('COMPLETED');

    // --- The summary -------------------------------------------------------
    const summary = await getSummary(page, mondayOf(utcDate()), 1);
    const line = summary.weeks[0].rituals.find((entry) => entry.ritualId === ritual.id);

    expect(line).toBeDefined();
    expect(line!.kept).toBe(1);
    expect(line!.planned).toBeGreaterThanOrEqual(1);

    // PRD §105: the product never creates a family-quality score.
    expect(JSON.stringify(summary)).not.toMatch(/score|quality|rating/i);
  });

  test('moving and skipping an occurrence reuse the ordinary lifecycle', async ({ page }) => {
    await signIn(page, 'e08-move');

    const ritual = await seedTonight(page);
    test.skip(ritual === null, 'Too late in the day for a future occurrence');

    const { from, to } = WINDOW();
    const occurrences = await listFamilyCommitments(page, from, to);
    expect(occurrences.length).toBeGreaterThanOrEqual(2);

    const [first, second] = occurrences;

    // --- Move it, from the Family page's Upcoming panel --------------------
    await page.goto('/path/family');
    const row = page.getByTestId(`commitment-row-${first.id}`);

    await row.getByRole('button', { name: 'Actions for Phone-free dinner' }).click();
    await page.getByRole('menuitem', { name: 'Move it' }).click();

    const moved = new Date(Date.now() + 3 * 24 * 3600_000);
    moved.setUTCHours(19, 0, 0, 0);
    const pad = (value: number) => String(value).padStart(2, '0');
    await page
      .getByLabel('New time')
      .fill(
        `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}T19:00`,
      );
    await page.getByRole('button', { name: 'Move it' }).click();

    await expect
      .poll(async () => (await getCommitment(page, first.id)).status)
      .toBe('RESCHEDULED');

    // The count travels with the intention, onto the NEW row.
    const replacement = (await listFamilyCommitments(page, from, to)).find(
      (candidate) => candidate.rescheduleCount === 1,
    );
    expect(replacement).toBeDefined();

    // --- Skip today --------------------------------------------------------
    await page.reload();
    const secondRow = page.getByTestId(`commitment-row-${second.id}`);

    await secondRow.getByRole('button', { name: 'Actions for Phone-free dinner' }).click();
    await page.getByRole('menuitem', { name: 'Skip today' }).click();
    await page.getByRole('radio', { name: 'Unexpected conflict' }).click();
    await page.getByRole('button', { name: 'Skip it' }).click();

    await expect.poll(async () => (await getCommitment(page, second.id)).status).toBe('SKIPPED');

    // TWO WEEKS, counting back from NEXT Monday. `weekdaysIncludingToday()`
    // spreads the occurrences over today, +2 and +4 days, which crosses the
    // week boundary on most days of the week — and the summary counts a move in
    // the week the commitment was ORIGINALLY due, not where it landed.
    const summary = await getSummary(page, mondayOf(daysFromNow(7)), 2);
    const lines = summary.weeks.flatMap((week) =>
      week.rituals.filter((entry) => entry.ritualId === ritual!.id),
    );

    const sum = (key: 'moved' | 'skipped') =>
      lines.reduce((total, line) => total + line[key], 0);

    expect(sum('moved')).toBeGreaterThanOrEqual(1);
    expect(sum('skipped')).toBeGreaterThanOrEqual(1);
  });

  test('the behaviour lint refuses a person-targeting title, with and without the coach', async ({
    page,
  }) => {
    await signIn(page, 'e08-lint');

    // THE UI FIRST, then the API. Every API helper here mints a token from the
    // refresh cookie, and the app running in the page refreshes on boot too;
    // navigating after a burst of them is what makes a long run lose the
    // session. Driving the screen first costs nothing and removes the race.
    await page.goto('/path/family');
    await page.getByTestId('family-create-ritual').click();
    await page.getByTestId('ritual-title').fill('Make Mia happier');

    await expect(page.getByText(LINT_MESSAGE)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('ritual-save')).toBeDisabled();

    // A good title clears it, and the rewrite — when offered — only fills the
    // field; nothing is submitted on its behalf.
    await page.getByTestId('ritual-title').fill('Read with Mia for 15 minutes');
    await expect(page.getByText(LINT_MESSAGE)).toBeHidden({ timeout: 10_000 });

    // The API refuses it deterministically, and left nothing behind.
    const refusal = await apiPostRaw(page, '/api/family/rituals', {
      title: 'Make Mia happier',
      recurrence: { weekdays: [1], time: '18:30', everyNWeeks: 1 },
      idealMinutes: 45,
      minimumMinutes: 10,
    });

    expect(refusal.status()).toBe(400);
    const body = (await refusal.json()) as { details?: { reason?: string; match?: string } };
    expect(body.details?.reason).toBe('BEHAVIOUR_TARGETS_OTHER_PERSON');
    expect(body.details?.match).toBe('Make Mia happier');
    expect(await listRituals(page)).toHaveLength(0);

    // The check endpoint answers 200 either way, with a rewrite when the fake
    // coach is reachable.
    const checked = await lint(page, 'Make Mia happier');
    expect(checked.ok).toBe(false);
    expect(checked.code).toBe('TARGETS_OTHER_PERSON');
  });

  test('editing a recurrence cancels only the future planned occurrences', async ({ page }) => {
    await signIn(page, 'e08-edit');

    const time = laterTodayHHmm(2);
    test.skip(time === null, 'Too late in the day for a future occurrence');

    const weekdays = weekdaysIncludingToday();
    const ritual = await createRitual(page, {
      title: 'Phone-free dinner',
      recurrence: { weekdays, time: time!, everyNWeeks: 1 },
      idealMinutes: 45,
      minimumMinutes: 10,
    });

    const { from, to } = WINDOW();
    const before = await listFamilyCommitments(page, from, to);
    expect(before.length).toBeGreaterThanOrEqual(2);

    // Complete today's one, so the edit has a finished row to leave alone.
    const todaysRow = before.find((row) => row.scheduledStart.slice(0, 10) === utcDate())!;
    await apiPostRaw(page, `/api/commitments/${todaysRow.id}/actions/complete`, {});
    expect((await getCommitment(page, todaysRow.id)).status).toBe('COMPLETED');

    // Drop the LAST weekday of the three.
    const dropped = weekdays[2];
    await updateRitual(page, ritual.id, {
      recurrence: { weekdays: [weekdays[0], weekdays[1]], time: time!, everyNWeeks: 1 },
    });

    const after = await listFamilyCommitments(page, from, to);

    // Nothing was deleted — the rows are all still there.
    expect(after.length).toBeGreaterThanOrEqual(before.length);

    // The completed one is untouched.
    expect(after.find((row) => row.id === todaysRow.id)!.status).toBe('COMPLETED');

    // Every future occurrence on the dropped weekday is CANCELLED.
    const droppedFuture = after.filter(
      (row) =>
        new Date(row.scheduledStart).getUTCDay() === dropped &&
        new Date(row.scheduledStart).getTime() > Date.now(),
    );
    expect(droppedFuture.length).toBeGreaterThan(0);
    expect(droppedFuture.every((row) => row.status === 'CANCELLED')).toBe(true);

    // The kept weekdays still have live rows.
    const kept = after.filter(
      (row) =>
        new Date(row.scheduledStart).getUTCDay() !== dropped &&
        new Date(row.scheduledStart).getTime() > Date.now(),
    );
    expect(kept.some((row) => row.status === 'PLANNED')).toBe(true);
  });

  test('pausing a ritual withdraws its future occurrences and stops materializing', async ({
    page,
  }) => {
    await signIn(page, 'e08-pause');

    const ritual = await seedTonight(page);
    test.skip(ritual === null, 'Too late in the day for a future occurrence');

    const { from, to } = WINDOW();
    await updateRitual(page, ritual!.id, { active: false });

    const after = await listFamilyCommitments(page, from, to);
    const future = after.filter((row) => new Date(row.scheduledStart).getTime() > Date.now());

    expect(future.length).toBeGreaterThan(0);
    expect(future.every((row) => row.status === 'CANCELLED')).toBe(true);

    // A paused ritual materializes nothing.
    await expect(materialize(page, ritual!.id)).resolves.toMatchObject({ created: 0 });
  });

  // PRD §105's hard criterion, checked over every family surface at once.
  test('no family response carries a score, quality or rating', async ({ page }) => {
    await signIn(page, 'e08-no-score');

    const member = await createMember(page, { nickname: 'Mia', relationship: 'CHILD' });
    const ritual = await createRitual(page, {
      title: 'Phone-free dinner',
      familyMemberId: member.id,
      recurrence: { weekdays: [1, 3, 5], time: '18:30', everyNWeeks: 1 },
      idealMinutes: 45,
      minimumMinutes: 10,
    });

    const paths = [
      '/api/family/members',
      '/api/family/rituals',
      `/api/family/rituals/${ritual.id}`,
      `/api/family/summary?weekStart=${mondayOf(utcDate())}&weeks=1`,
    ];

    for (const path of paths) {
      const response = await withToken(page, (token) =>
        page.request.get(path, { headers: { Authorization: `Bearer ${token}` } }),
      );

      expect(response.ok(), `${path} → ${response.status()}`).toBe(true);
      expect(await response.text(), path).not.toMatch(/score|quality|rating/i);
    }

    // The published contract, not just the payloads: every `/api/family` path
    // in the OpenAPI document and the schemas it references.
    const document = await page.request.get('/api/openapi.json');
    expect(document.ok()).toBe(true);

    const spec = (await document.json()) as {
      paths: Record<string, unknown>;
      components?: { schemas?: Record<string, unknown> };
    };

    const familyPaths = Object.entries(spec.paths).filter(([path]) =>
      path.startsWith('/api/family'),
    );
    expect(familyPaths.length).toBeGreaterThan(0);

    const schemas = spec.components?.schemas ?? {};
    const collected = new Map<string, unknown>();
    const queue = familyPaths.map(([, operations]) => JSON.stringify(operations));

    while (queue.length > 0) {
      const chunk = queue.shift()!;
      for (const [, name] of chunk.matchAll(/#\/components\/schemas\/([A-Za-z0-9_.-]+)/g)) {
        if (collected.has(name) || !(name in schemas)) continue;
        collected.set(name, schemas[name]);
        queue.push(JSON.stringify(schemas[name]));
      }
    }

    const contract = JSON.stringify([
      Object.fromEntries(familyPaths),
      Object.fromEntries(collected),
    ]);
    expect(contract).not.toMatch(/score|quality|rating/i);
  });

  test('the Family page is one column on a phone and two on a wide screen', async ({ page }) => {
    await signIn(page, 'e08-responsive');
    await createRitual(page, {
      title: 'Phone-free dinner',
      recurrence: { weekdays: [1, 3, 5], time: '18:30', everyNWeeks: 1 },
      idealMinutes: 45,
      minimumMinutes: 10,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/path/family');
    await expect(page.getByText('Phone-free dinner').first()).toBeVisible();

    // Below `sm` the editor is a bottom sheet and the bottom bar is mounted.
    await page.getByTestId('family-create-ritual').click();
    await expect(page.getByRole('dialog', { name: 'Create a ritual' })).toHaveClass(
      /MuiDrawer-paper/,
    );
    await page.keyboard.press('Escape');
    await expect(page.locator('.MuiBottomNavigation-root')).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.reload();
    await page.getByTestId('family-create-ritual').click();
    await expect(page.getByRole('dialog', { name: 'Create a ritual' })).toHaveClass(
      /MuiDialog-paper/,
    );
  });

  test('the Path screen links to the Family surface', async ({ page }) => {
    await signIn(page, 'e08-path-link');
    await createRitual(page, {
      title: 'Phone-free dinner',
      recurrence: { weekdays: [1, 3, 5], time: '18:30', everyNWeeks: 1 },
      idealMinutes: 45,
      minimumMinutes: 10,
    });

    await page.goto('/path');

    const section = page.getByRole('region', { name: 'Family rituals' });
    await expect(section).toContainText('Phone-free dinner');

    await section.getByRole('link', { name: 'Manage rituals' }).click();
    await expect(page).toHaveURL(/\/path\/family$/);
  });
});

// =============================================================================
// The coach is down
// =============================================================================
//
// PRD §120 for the Family domain: the LINT VERDICT is deterministic and must
// not depend on a provider being reachable. Only the rewrite does.
// =============================================================================

test.describe('E08 — with the coach unreachable', () => {
  const UNREACHABLE = 'http://127.0.0.1:1/v1';

  /**
   * Point the provider somewhere, and CHECK THAT IT TOOK.
   *
   * The write is asserted rather than fired and forgotten: `ai-settings` is
   * system-wide and version-checked, so a stale `If-Match` after another spec
   * has written makes the PUT a silent 412 — and this whole test would then
   * pass against a perfectly reachable coach, which is the one outcome it
   * exists to rule out.
   */
  async function setBaseUrl(page: Page, baseUrl: string | null) {
    const current = await withToken(page, (token) =>
      page.request.get('/api/ai-settings', { headers: { Authorization: `Bearer ${token}` } }),
    );
    expect(current.ok(), 'reading the AI settings').toBe(true);

    const etag = current.headers()['etag'];
    const settings = ((await current.json()) as { data: Record<string, unknown> }).data;

    // A FULL REPLACE, not a patch: `PUT /ai-settings` validates the whole
    // object, so `{ baseUrl }` alone is a 400. `platformKey` is the read-only
    // status block the GET adds and the PUT refuses.
    const { platformKey: _status, ...writable } = settings;

    const written = await withToken(page, (token) =>
      page.request.put('/api/ai-settings', {
        headers: { Authorization: `Bearer ${token}`, ...(etag ? { 'If-Match': etag } : {}) },
        data: { ...writable, baseUrl },
      }),
    );

    // ASSERTED, not fired and forgotten. `ai-settings` is system-wide and
    // version-checked, so a rejected write leaves the coach perfectly
    // reachable — and this test would then pass against the one thing it
    // exists to rule out.
    expect(
      written.ok(),
      `writing baseUrl=${baseUrl} → ${written.status()}: ${await written.text()}`,
    ).toBe(true);
  }

  test('the refusal still stands, without the rewrite', async ({ page }) => {
    await signIn(page, 'e08-ai-down', 'admin');
    await setBaseUrl(page, UNREACHABLE);

    try {
      // The verdict is unchanged; only the shortcut is missing.
      const checked = await lint(page, 'Make Mia happier');
      expect(checked.ok).toBe(false);
      expect(checked.code).toBe('TARGETS_OTHER_PERSON');
      expect(checked.suggestion).toBeNull();
      expect(checked.source).toBe('none');

      // And the write path still refuses, deterministically.
      const refusal = await apiPostRaw(page, '/api/family/rituals', {
        title: 'Make Mia happier',
        recurrence: { weekdays: [1], time: '18:30', everyNWeeks: 1 },
        idealMinutes: 45,
        minimumMinutes: 10,
      });
      expect(refusal.status()).toBe(400);

      // In the editor: the error, and no rewrite button.
      await page.goto('/path/family');
      await page.getByTestId('family-create-ritual').click();
      await page.getByTestId('ritual-title').fill('Make Mia happier');

      await expect(page.getByText(LINT_MESSAGE)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('ritual-suggest-rewrite')).toBeHidden();
    } finally {
      await setBaseUrl(page, null);
    }
  });
});
