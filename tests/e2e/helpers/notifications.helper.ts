import type { Page } from '@playwright/test';

import { apiGet, withToken } from './path.helper';
import { apiPost } from './commitments.helper';

// =============================================================================
// E12 coaching notifications, over the API (issue #75)
// =============================================================================
//
// THE JOB IS ALWAYS INVOKED EXPLICITLY. The scheduler runs every five minutes
// in production, and a test that waited for it would be a five-minute test that
// still raced the tick. `runCoachingJob` calls the same `runOnce` the cron
// calls — not a stand-in — and `now` moves the whole run, which is what lets a
// spec assert "at the scheduled start" without sleeping.

export interface CoachingRunResult {
  scanned: number;
  sent: number;
  suppressed: number;
  skipped: boolean;
}

export async function runCoachingJob(page: Page, now?: string): Promise<CoachingRunResult> {
  return apiPost<CoachingRunResult>(page, '/api/auth/test/run-job', {
    job: 'coaching-notifications',
    ...(now ? { now } : {}),
  });
}

export interface InboxNotification {
  id: string;
  eventKey: string;
  title: string;
  body: string;
  link: string | null;
  actions: { action: string; label: string; link: string }[];
  readAt: string | null;
  createdAt: string;
}

/** The inbox, newest first. */
export async function inbox(page: Page): Promise<InboxNotification[]> {
  const body = await apiGet<{ items: InboxNotification[] }>(page, '/api/notifications');
  return body.items;
}

/** The rows for one coaching event. */
export async function inboxFor(page: Page, eventKey: string): Promise<InboxNotification[]> {
  return (await inbox(page)).filter((row) => row.eventKey === eventKey);
}

export interface SuppressCounts {
  QUIET_HOURS: number;
  DAILY_CAP: number;
  WEEKLY_CAP: number;
  PER_COMMITMENT_MAX: number;
  SKIPPED: number;
  MUTED: number;
  DOMAIN_PAUSED: number;
  FATIGUE: number;
  ALREADY_DONE: number;
}

export interface EventMetrics {
  eventKey: string;
  category: string | null;
  sent: number;
  opened: number;
  actioned: number;
  dismissed: number;
  ignored: number;
  suppressed: SuppressCounts;
  actionRate: number | null;
  bestLeadMinutes: number | null;
}

export interface NotificationMetrics {
  window: { from: string; to: string; days: number };
  perEvent: EventMetrics[];
  independence: { completions: number; unprompted: number; ratio: number | null };
  reminderTrend: { month: string; domain: string; sent: number; completions: number }[];
  insights: string[];
}

export async function getMetrics(page: Page, days = 7): Promise<NotificationMetrics> {
  return apiGet<NotificationMetrics>(page, `/api/notifications/metrics?days=${days}`);
}

export function metricsFor(metrics: NotificationMetrics, eventKey: string): EventMetrics {
  const found = metrics.perEvent.find((event) => event.eventKey === eventKey);
  if (!found) throw new Error(`No metrics for '${eventKey}'`);
  return found;
}

export interface NotificationPolicy {
  timezone: string;
  quietHours: { start: string; end: string } | null;
  dailyCap: number;
  weeklyCap: number;
  perCommitmentMax: number;
  mutedCategories: string[];
  fatigue: { active: boolean; effectiveDailyCap: number };
}

export async function getPolicy(page: Page): Promise<NotificationPolicy> {
  return apiGet<NotificationPolicy>(page, '/api/me/notification-policy');
}

export async function setPolicy(
  page: Page,
  patch: Record<string, unknown>,
): Promise<NotificationPolicy> {
  const response = await withToken(page, (token) =>
    page.request.patch('/api/me/notification-policy', {
      headers: { Authorization: `Bearer ${token}` },
      data: patch,
    }),
  );

  if (!response.ok()) {
    throw new Error(
      `PATCH /api/me/notification-policy → ${response.status()}: ${await response.text()}`,
    );
  }

  return ((await response.json()) as { data: NotificationPolicy }).data;
}

/** `now + minutes`, as an ISO instant. The scanner's windows are all relative. */
export function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
