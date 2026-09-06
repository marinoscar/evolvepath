import { localDate } from '../../today/local-date';
import { validateWorkSessionPlan } from './work-session-plan.guardrails';
import { workSessionPlanSchema } from './work-session-plan.schema';
import {
  TEMPLATE_MAX_SESSIONS,
  buildTemplateSessionPlan,
  templateDays,
} from './work-session-templates';

// =============================================================================
// The deterministic plan (issue #108)
// =============================================================================
//
// Every case ends the same way — the output passes the schema AND the
// guardrails. That pairing is the whole promise of the fallback: with the
// provider down, `apply` must accept what the template produced, and a template
// that could not be applied is an outage with extra steps.
// =============================================================================

// A Monday, 08:00 UTC.
const MONDAY = new Date('2026-09-07T08:00:00.000Z');

function assertUsable(plan: unknown, ctx: Parameters<typeof validateWorkSessionPlan>[1]) {
  const parsed = workSessionPlanSchema.safeParse(plan);
  expect(parsed.success).toBe(true);
  if (!parsed.success) return;

  expect(validateWorkSessionPlan(parsed.data, ctx)).toEqual([]);
}

describe('templateDays', () => {
  it('takes the next five weekdays when there is no target date', () => {
    // 2026-09-07 is a Monday.
    expect(templateDays('2026-09-07', null)).toEqual([
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-14',
    ]);
  });

  it('stops at the target date', () => {
    expect(templateDays('2026-09-07', '2026-09-10')).toEqual([
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
    ]);
  });

  it('caps at ten and spreads them evenly over a long horizon', () => {
    const days = templateDays('2026-09-07', '2026-10-19');

    expect(days).toHaveLength(TEMPLATE_MAX_SESSIONS);
    // Evenly, not front-loaded: the last day is at the end of the range.
    expect(days[0]).toBe('2026-09-08');
    expect(days[days.length - 1]).toBe('2026-10-19');
  });

  it('falls back to weekend days when the range contains no weekday', () => {
    // Friday → Sunday: the only days available are Saturday and Sunday.
    expect(templateDays('2026-09-11', '2026-09-13')).toEqual(['2026-09-12', '2026-09-13']);
  });
});

describe('buildTemplateSessionPlan', () => {
  const outcome = { title: 'Finish strategy presentation' };

  it.each(['America/Costa_Rica', 'Asia/Tokyo', 'Australia/Adelaide'])(
    'puts five weekday sessions at 09:00 local in %s',
    (timezone) => {
      const plan = buildTemplateSessionPlan({
        outcome,
        now: MONDAY,
        timezone,
        targetDate: null,
        availableMinutesPerDay: 60,
      });

      expect(plan.sessions).toHaveLength(5);

      for (const session of plan.sessions) {
        const hhmm = new Intl.DateTimeFormat('en-GB', {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(session.scheduledStart));

        expect(hhmm).toBe('09:00');
      }

      assertUsable(plan, {
        now: MONDAY,
        timezone,
        targetDate: null,
        availableMinutesPerDay: 60,
      });
    },
  );

  it('produces one session per weekday up to a near target date', () => {
    const plan = buildTemplateSessionPlan({
      outcome,
      now: MONDAY,
      timezone: 'UTC',
      targetDate: '2026-09-10',
      availableMinutesPerDay: 60,
    });

    expect(plan.sessions).toHaveLength(3);
    expect(localDate(new Date(plan.sessions[0].scheduledStart), 'UTC')).toBe('2026-09-08');
  });

  it('caps a six-week horizon at ten sessions', () => {
    const plan = buildTemplateSessionPlan({
      outcome,
      now: MONDAY,
      timezone: 'UTC',
      targetDate: '2026-10-19',
      availableMinutesPerDay: 60,
    });

    expect(plan.sessions).toHaveLength(TEMPLATE_MAX_SESSIONS);
  });

  it('never exceeds the minutes the user said they have', () => {
    const plan = buildTemplateSessionPlan({
      outcome,
      now: MONDAY,
      timezone: 'UTC',
      targetDate: null,
      availableMinutesPerDay: 20,
    });

    expect(plan.sessions.every((s) => s.durationMinutes === 20)).toBe(true);
    // Still strictly smaller than the session — the guardrail depends on it.
    expect(plan.sessions.every((s) => s.minimumStart.minutes < s.durationMinutes)).toBe(true);

    assertUsable(plan, {
      now: MONDAY,
      timezone: 'UTC',
      targetDate: null,
      availableMinutesPerDay: 20,
    });
  });

  it('stays usable at the schema floor of ten minutes a day', () => {
    assertUsable(
      buildTemplateSessionPlan({
        outcome,
        now: MONDAY,
        timezone: 'UTC',
        targetDate: null,
        availableMinutesPerDay: 10,
      }),
      { now: MONDAY, timezone: 'UTC', targetDate: null, availableMinutesPerDay: 10 },
    );
  });

  it('says out loud that it is a standard schedule', () => {
    const plan = buildTemplateSessionPlan({
      outcome,
      now: MONDAY,
      timezone: 'UTC',
      targetDate: null,
      availableMinutesPerDay: 45,
    });

    expect(plan.rationale).toMatch(/standard schedule/i);
    expect(plan.reviewCadence).toBe('WEEKLY');
  });

  it('is pure: the same input twice is the same plan', () => {
    const input = {
      outcome,
      now: MONDAY,
      timezone: 'Asia/Tokyo',
      targetDate: null,
      availableMinutesPerDay: 45,
    };

    expect(buildTemplateSessionPlan(input)).toEqual(buildTemplateSessionPlan(input));
  });
});
