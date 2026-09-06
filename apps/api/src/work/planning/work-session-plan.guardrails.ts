import { localDate, localDayBounds } from '../../today/local-date';
import type { WorkSessionPlan } from './work-session-plan.schema';

// =============================================================================
// The guardrails (issue #108, epic E07)
// =============================================================================
//
// PURE, AND APPLIED TO ALL THREE SOURCES: the planner's output, the
// deterministic template, and the copy the user edited before pressing Apply.
// A rule enforced on only one of them is a rule the other two can break — and
// the user-edited copy is the one that reaches the database.
//
// Failures come back as SENTENCES, not codes. They are rendered verbatim in the
// `PROPOSAL_INVALID` response and read by a person looking at a form they just
// filled in; "3 sessions on 2026-09-08 — at most 2 fit in a day" is actionable
// and "DAILY_CAP" is not.
//
// The lower time bound is the START OF THE CURRENT LOCAL DAY rather than the
// instant of validation. A plan proposed at 09:00 whose first session is at
// 09:00 must not become invalid at 09:01 while the user reads it; a plan whose
// sessions are yesterday still fails.
// =============================================================================

export interface GuardrailContext {
  now: Date;
  timezone: string;
  /** The outcome's target date as `YYYY-MM-DD`, or null. */
  targetDate: string | null;
  availableMinutesPerDay: number;
}

/** How far out a plan may reach when the outcome names no target date. */
export const DEFAULT_HORIZON_DAYS = 14;

/** PRD §24: two focus sessions is a working day; three is a wish. */
export const MAX_SESSIONS_PER_DAY = 2;

/** The last resort when neither the request nor the profile says otherwise. */
export const DEFAULT_AVAILABLE_MINUTES_PER_DAY = 60;

/**
 * Every rule the plan breaks, as readable sentences. Empty means it is valid.
 */
export function validateWorkSessionPlan(
  plan: WorkSessionPlan,
  ctx: GuardrailContext,
): string[] {
  const details: string[] = [];

  // ---- milestones -----------------------------------------------------------

  const orders = plan.milestones.map((m) => m.order).sort((a, b) => a - b);
  const contiguous = orders.every((order, index) => order === index);

  if (!contiguous) {
    details.push(
      `Milestone orders must be 0..${plan.milestones.length - 1} with no gaps or duplicates, got [${orders.join(', ')}].`,
    );
  }

  for (const session of plan.sessions) {
    if (session.milestoneIndex >= plan.milestones.length) {
      details.push(
        `Session "${session.title}" points at milestone ${session.milestoneIndex}, but there are only ${plan.milestones.length}.`,
      );
    }
  }

  // ---- the window -----------------------------------------------------------

  const lowerBound = localDayBounds(localDate(ctx.now, ctx.timezone), ctx.timezone).start;
  const upperBound = ctx.targetDate
    ? localDayBounds(ctx.targetDate, ctx.timezone).end
    : new Date(ctx.now.getTime() + DEFAULT_HORIZON_DAYS * 86_400_000);

  for (const session of plan.sessions) {
    const start = new Date(session.scheduledStart);

    if (Number.isNaN(start.getTime())) {
      details.push(`Session "${session.title}" has an unreadable start time.`);
      continue;
    }

    if (start < lowerBound) {
      details.push(`Session "${session.title}" is scheduled in the past.`);
    }

    if (start >= upperBound) {
      details.push(
        ctx.targetDate
          ? `Session "${session.title}" is scheduled after the target date ${ctx.targetDate}.`
          : `Session "${session.title}" is more than ${DEFAULT_HORIZON_DAYS} days out; set a target date to plan further ahead.`,
      );
    }
  }

  // ---- ordering -------------------------------------------------------------

  for (let i = 1; i < plan.sessions.length; i += 1) {
    if (new Date(plan.sessions[i].scheduledStart) < new Date(plan.sessions[i - 1].scheduledStart)) {
      details.push('Sessions must be listed in ascending order of start time.');
      break;
    }
  }

  // ---- per-day load ---------------------------------------------------------

  const byDay = new Map<string, { count: number; minutes: number }>();

  for (const session of plan.sessions) {
    const start = new Date(session.scheduledStart);
    if (Number.isNaN(start.getTime())) continue;

    const day = localDate(start, ctx.timezone);
    const bucket = byDay.get(day) ?? { count: 0, minutes: 0 };

    bucket.count += 1;
    bucket.minutes += session.durationMinutes;
    byDay.set(day, bucket);
  }

  for (const [day, bucket] of [...byDay.entries()].sort()) {
    if (bucket.count > MAX_SESSIONS_PER_DAY) {
      details.push(
        `${bucket.count} sessions on ${day} — at most ${MAX_SESSIONS_PER_DAY} fit in a day.`,
      );
    }

    if (bucket.minutes > ctx.availableMinutesPerDay) {
      details.push(
        `${bucket.minutes} minutes planned on ${day}, above the ${ctx.availableMinutesPerDay} minutes a day you said you have.`,
      );
    }
  }

  // ---- the minimum start ----------------------------------------------------

  for (const session of plan.sessions) {
    if (session.minimumStart.minutes >= session.durationMinutes) {
      details.push(
        `The minimum start for "${session.title}" (${session.minimumStart.minutes} min) is not smaller than the session itself (${session.durationMinutes} min).`,
      );
    }
  }

  return details;
}
