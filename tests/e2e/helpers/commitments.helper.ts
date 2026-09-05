import type { Page } from '@playwright/test';

import { apiGet, withToken } from './path.helper';

// =============================================================================
// Seeding and reading the Today domain over the API (issue #55, epic E05)
// =============================================================================
//
// SEEDED THROUGH THE API, NEVER THROUGH THE DATABASE. Playwright cannot reach
// Postgres, and that limitation is a feature here: seeding through
// `POST /outcomes` and `POST /commitments` means the spec exercises those
// create contracts too, and a fixture that drifts from them fails loudly rather
// than testing a state the API would never produce.
// =============================================================================

/** A POST against the API as the signed-in user, with the body on a failure. */
export async function apiPost<T>(page: Page, path: string, data: unknown): Promise<T> {
  const response = await withToken(page, (token) =>
    page.request.post(path, {
      headers: { Authorization: `Bearer ${token}` },
      data: data as Record<string, unknown>,
    }),
  );

  if (!response.ok()) {
    throw new Error(`POST ${path} → ${response.status()}: ${await response.text()}`);
  }

  const body = (await response.json()) as { data: T };
  return body.data;
}

/** A PUT, for the admin AI-settings fixture in case 5. */
export async function apiPut<T>(
  page: Page,
  path: string,
  data: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await withToken(page, (token) =>
    page.request.put(path, {
      headers: { Authorization: `Bearer ${token}`, ...headers },
      data: data as Record<string, unknown>,
    }),
  );

  if (!response.ok()) {
    throw new Error(`PUT ${path} → ${response.status()}: ${await response.text()}`);
  }

  const body = (await response.json()) as { data: T };
  return body.data;
}

export type Domain = 'WORK' | 'FAMILY' | 'HEALTH';

export interface SeededOutcome {
  id: string;
  domain: Domain;
  title: string;
}

export interface SeededCommitment {
  id: string;
  domain: Domain;
  title: string;
  status: string;
  /** Which size was actually attempted, once a fallback has been chosen (#75). */
  versionUsed?: 'FULL' | 'SHORT' | 'MINIMUM' | null;
  rescheduleCount: number;
  rescheduledFromId: string | null;
  rescheduledToId: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export async function createOutcome(
  page: Page,
  input: { domain: Domain; title: string; whyItMatters?: string },
): Promise<SeededOutcome> {
  return apiPost<SeededOutcome>(page, '/api/outcomes', {
    domain: input.domain,
    title: input.title,
    importance: 5,
    // E02 shipped this column as `motivation`; the E05 issues call it
    // "whyItMatters". One field, one name — and the Start screen reads it back
    // through `GET /commitments/:id/actions`.
    motivation: input.whyItMatters ?? null,
  });
}

export interface CommitmentSeed {
  domain: Domain;
  title: string;
  /** ISO instant. Use `todayAt` so it lands inside the local day window. */
  scheduledStart: string;
  /**
   * ISO instant. Optional, and only worth setting when a test cares about how
   * much room is left — E12's fallback offer is the case: it fires only while a
   * smaller version still fits before the commitment's own end (#75).
   */
  scheduledEnd?: string | null;
  importance?: number;
  outcomeId?: string | null;
  fullVersion?: string;
  fullMinutes?: number;
  shortVersion?: string;
  shortMinutes?: number;
  minimumVersion?: string;
  minimumMinutes?: number;
}

export async function createCommitment(
  page: Page,
  seed: CommitmentSeed,
): Promise<SeededCommitment> {
  return apiPost<SeededCommitment>(page, '/api/commitments', {
    domain: seed.domain,
    title: seed.title,
    scheduledStart: seed.scheduledStart,
    scheduledEnd: seed.scheduledEnd ?? null,
    importance: seed.importance ?? 3,
    outcomeId: seed.outcomeId ?? null,
    fullVersion: seed.fullVersion ?? seed.title,
    fullMinutes: seed.fullMinutes ?? 25,
    shortVersion: seed.shortVersion ?? null,
    shortMinutes: seed.shortMinutes ?? null,
    minimumVersion: seed.minimumVersion ?? null,
    minimumMinutes: seed.minimumMinutes ?? null,
  });
}

export async function getCommitment(page: Page, id: string): Promise<SeededCommitment> {
  return apiGet<SeededCommitment>(page, `/api/commitments/${id}`);
}

export interface TodayResponse {
  dateLocal: string;
  checkIn: { feel: string } | null;
  nextBestAction: {
    commitmentId: string;
    title: string;
    durationMinutes: number;
    version: string;
    interventionMode: string;
  } | null;
  domains: Array<{ domain: Domain; mode: string; commitments: Array<{ id: string }> }>;
}

export async function getToday(page: Page): Promise<TodayResponse> {
  return apiGet<TodayResponse>(page, '/api/today');
}

export interface EvidenceRow {
  evidenceType: string;
  source: string;
  commitmentId: string | null;
}

/**
 * Evidence for one commitment.
 *
 * The window is required and capped at 93 days by the API, so this asks for a
 * generous one around now rather than leaving it off.
 */
export async function getEvidence(page: Page, commitmentId: string): Promise<EvidenceRow[]> {
  const from = new Date(Date.now() - 24 * 3600_000).toISOString();
  const to = new Date(Date.now() + 24 * 3600_000).toISOString();

  return apiGet<EvidenceRow[]>(
    page,
    `/api/evidence?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&commitmentId=${commitmentId}`,
  );
}

export interface ReflectionRow {
  relatedType: string;
  relatedId: string | null;
  frictionTags: string[];
  userText: string | null;
}

export async function getReflections(page: Page, relatedId?: string): Promise<ReflectionRow[]> {
  const suffix = relatedId ? `?relatedId=${relatedId}` : '';
  return apiGet<ReflectionRow[]>(page, `/api/reflections${suffix}`);
}

/**
 * Today at a given local hour, as an ISO instant.
 *
 * COMPUTED IN THE BROWSER'S (and therefore the runner's) TIMEZONE. The API
 * resolves "today" from `user_profiles.timezone`, which defaults to UTC for a
 * test user — so this deliberately keeps the hour well inside the day in both
 * zones rather than assuming they agree at the edges.
 */
export function todayAt(hour: number, minute = 0): string {
  const when = new Date();
  when.setHours(hour, minute, 0, 0);
  return when.toISOString();
}

/** Now plus a few minutes, so a seeded commitment is due but not overdue. */
export function inMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/** Tomorrow at a local hour, as an ISO instant. */
export function tomorrowAtIso(hour: number, minute = 0): string {
  const when = new Date();
  when.setDate(when.getDate() + 1);
  when.setHours(hour, minute, 0, 0);
  return when.toISOString();
}

/** The `datetime-local` value for tomorrow at a local hour. */
export function tomorrowLocalInput(hour: number, minute = 0): string {
  const when = new Date();
  when.setDate(when.getDate() + 1);
  when.setHours(hour, minute, 0, 0);

  const pad = (value: number) => String(value).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

/** The `datetime-local` value for today at a local hour. */
export function todayLocalInput(hour: number, minute = 0): string {
  const when = new Date();
  when.setHours(hour, minute, 0, 0);

  const pad = (value: number) => String(value).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}
