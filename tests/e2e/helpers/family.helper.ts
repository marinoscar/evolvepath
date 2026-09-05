import type { Page } from '@playwright/test';

import { apiGet, withToken } from './path.helper';
import { apiPost } from './commitments.helper';

// =============================================================================
// Seeding and reading the Family domain over the API (issue #53, epic E08)
// =============================================================================
//
// SEEDED THROUGH THE API, NEVER THROUGH THE DATABASE, for the reason
// `commitments.helper.ts` gives: Playwright cannot reach Postgres, and that
// limitation is a feature — seeding through `POST /family/rituals` exercises
// the create contract, the behaviour lint and the materializer, so a fixture
// that drifts from them fails loudly instead of testing a state the API would
// never produce.
//
// ON TIMEZONES. `user_profiles.timezone` defaults to `UTC` and there is no
// write endpoint for it yet (E04 adds `PATCH /me/profile`). That default is
// exactly what these specs want — the container runs in UTC, so "tonight" is
// computable from `new Date()` without a conversion — so there is deliberately
// no `setTimezone` helper here to go stale. When E04 lands, a spec that needs
// a different zone can add one.
// =============================================================================

/** A PATCH against the API as the signed-in user, with the body on a failure. */
export async function apiPatch<T>(page: Page, path: string, data: unknown): Promise<T> {
  const response = await withToken(page, (token) =>
    page.request.patch(path, {
      headers: { Authorization: `Bearer ${token}` },
      data: data as Record<string, unknown>,
    }),
  );

  if (!response.ok()) {
    throw new Error(`PATCH ${path} → ${response.status()}: ${await response.text()}`);
  }

  const body = (await response.json()) as { data: T };
  return body.data;
}

/** The raw response, for the cases that assert on a refusal. */
export async function apiPostRaw(page: Page, path: string, data: unknown) {
  return withToken(page, (token) =>
    page.request.post(path, {
      headers: { Authorization: `Bearer ${token}` },
      data: data as Record<string, unknown>,
    }),
  );
}

export type FamilyRelationship =
  | 'PARTNER'
  | 'CHILD'
  | 'PARENT'
  | 'SIBLING'
  | 'FRIEND'
  | 'OTHER';

export interface SeededMember {
  id: string;
  nickname: string;
  relationship: FamilyRelationship;
  birthday: string | null;
  createdAt: string;
}

export interface RitualRecurrence {
  weekdays: number[];
  time: string;
  everyNWeeks: 1 | 2 | 4;
}

export interface SeededRitual {
  id: string;
  title: string;
  recurrence: RitualRecurrence;
  idealMinutes: number;
  minimumMinutes: number;
  fallbackBehavior: string | null;
  active: boolean;
  lastMaterializedThrough: string | null;
  routineId: string | null;
}

export interface FamilyCommitment {
  id: string;
  domain: string;
  title: string;
  status: string;
  scheduledStart: string;
  ritualId: string | null;
  familyMemberId: string | null;
  rescheduleCount: number;
  fullMinutes: number | null;
  minimumMinutes: number | null;
  minimumVersion: string | null;
}

export interface RitualWeekCounts {
  ritualId: string | null;
  title: string;
  planned: number;
  kept: number;
  partial: number;
  moved: number;
  skipped: number;
  missed: number;
  open: number;
}

export interface FamilySummary {
  timezone: string;
  weeks: Array<{
    weekStart: string;
    rituals: RitualWeekCounts[];
    totals: Omit<RitualWeekCounts, 'ritualId' | 'title'>;
  }>;
  coachNote: { text: string; source: 'ai' | 'template' } | null;
}

export async function createMember(
  page: Page,
  body: { nickname: string; relationship: FamilyRelationship; birthday?: string | null },
): Promise<SeededMember> {
  return apiPost<SeededMember>(page, '/api/family/members', body);
}

export async function listMembers(page: Page): Promise<SeededMember[]> {
  return apiGet<SeededMember[]>(page, '/api/family/members');
}

export async function createRitual(
  page: Page,
  body: {
    title: string;
    purpose?: string | null;
    familyMemberId?: string | null;
    recurrence: RitualRecurrence;
    idealMinutes: number;
    minimumMinutes: number;
    fallbackBehavior?: string | null;
  },
): Promise<SeededRitual> {
  return apiPost<SeededRitual>(page, '/api/family/rituals', body);
}

export async function listRituals(page: Page): Promise<SeededRitual[]> {
  return apiGet<SeededRitual[]>(page, '/api/family/rituals');
}

export async function getRitual(page: Page, id: string) {
  return apiGet<SeededRitual & { upcoming: unknown[] }>(page, `/api/family/rituals/${id}`);
}

export async function updateRitual(
  page: Page,
  id: string,
  body: Record<string, unknown>,
): Promise<SeededRitual> {
  return apiPatch<SeededRitual>(page, `/api/family/rituals/${id}`, body);
}

export async function materialize(
  page: Page,
  ritualId: string,
): Promise<{ created: number; skipped: number; through: string }> {
  return apiPost(page, `/api/family/rituals/${ritualId}/materialize`, {});
}

/** Every FAMILY commitment in a window, including the cancelled ones. */
export async function listFamilyCommitments(
  page: Page,
  from: string,
  to: string,
): Promise<FamilyCommitment[]> {
  return apiGet<FamilyCommitment[]>(
    page,
    `/api/commitments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&domain=FAMILY`,
  );
}

export async function getSummary(
  page: Page,
  weekStart: string,
  weeks = 1,
): Promise<FamilySummary> {
  return apiGet<FamilySummary>(
    page,
    `/api/family/summary?weekStart=${weekStart}&weeks=${weeks}`,
  );
}

export async function lint(page: Page, title: string) {
  return apiPost<{
    ok: boolean;
    code: string | null;
    match: string | null;
    suggestion: string | null;
    source: 'ai' | 'none';
  }>(page, '/api/family/lint', { title });
}

// --- Calendar arithmetic, in the container's own (UTC) clock -----------------

/** `YYYY-MM-DD` for an instant, in UTC. */
export function utcDate(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/** The Monday of the week containing `dateLocal`, as `YYYY-MM-DD`. */
export function mondayOf(dateLocal: string): string {
  const [year, month, day] = dateLocal.split('-').map(Number);
  const at = new Date(Date.UTC(year, month - 1, day));
  // 0 = Sunday, so Sunday is 6 days into a Monday-start week.
  at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 6) % 7));

  return at.toISOString().slice(0, 10);
}

/** `days` from now, as `YYYY-MM-DD` in UTC. */
export function daysFromNow(days: number): string {
  return utcDate(new Date(Date.now() + days * 24 * 3600_000));
}

/** `0 = Sunday … 6 = Saturday` for an instant, in UTC. */
export function utcWeekday(at: Date = new Date()): number {
  return at.getUTCDay();
}

/**
 * A time later today, rounded to five minutes — or `null` when the day is too
 * far gone for the ritual to still be in the future.
 *
 * Materialization only ever creates FUTURE occurrences, so a spec that wants
 * "tonight" has to accept that a run starting at 23:58 does not get one. The
 * caller rolls to another day rather than failing, which is what the issue's
 * note about running after 21:55 asks for.
 */
export function laterTodayHHmm(hoursAhead = 2, now: Date = new Date()): string | null {
  const at = new Date(now.getTime() + hoursAhead * 3600_000);
  if (at.getUTCDate() !== now.getUTCDate()) return null;

  const minutes = Math.ceil(at.getUTCMinutes() / 5) * 5;
  if (minutes >= 60) {
    at.setUTCHours(at.getUTCHours() + 1, 0);
    if (at.getUTCDate() !== now.getUTCDate()) return null;
  } else {
    at.setUTCMinutes(minutes);
  }

  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
}

/** `MM-DD` for a birthday `days` from now, with the 1900 placeholder year. */
export function placeholderBirthdayIn(days: number): string {
  const at = new Date(Date.now() + days * 24 * 3600_000);
  const pad = (value: number) => String(value).padStart(2, '0');

  return `1900-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}
