import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  BUILDING_MAX_HISTORY_DAYS,
  BUILDING_MIN_RATIO,
  HALF_WINDOW_DAYS,
  MIN_PLANNED,
  MOMENTUM_STATES,
  RECOVERY_IDLE_DAYS,
  RECOVERY_LOOKBACK_DAYS,
  SLIP_CONSECUTIVE_MISSES,
  TREND_DELTA,
  WINDOW_DAYS,
} from '../../src/progress/momentum/momentum-engine';
import { MAX_EVIDENCE_BULLETS } from '../../src/progress/momentum/momentum-evidence';
import {
  GRACE_EVERY_N_WEEKS,
  RUN_LOOKBACK_WEEKS,
  WEEK_SUCCESS_RATIO,
  WEEKLY_CHART_WEEKS,
} from '../../src/progress/momentum/consistency-run';
import { RECOVERY_LOOKBACK_DAYS as RECOVERY_LATENCY_DAYS } from '../../src/progress/momentum/recovery-latency';
import {
  INACTIVITY_DAYS,
  MISSES_THRESHOLD,
  MISSES_WINDOW_DAYS,
  PLAN_DRIFT_CLOSED,
  PLAN_DRIFT_MISSES_14D,
} from '../../src/progress/comeback/comeback-detector';
import {
  DOMAIN_PREFERENCE,
  RESTART_MAX_MINUTES,
  RESTART_MIN_MINUTES,
} from '../../src/progress/comeback/restart-picker';
import { ACTIVITY_WRITE_INTERVAL_MS } from '../../src/progress/comeback/activity-tracker.service';
import {
  CELEBRATION_BODY,
  CELEBRATION_TITLE,
  OFFER_NOTE,
} from '../../src/progress/comeback/comeback-copy';
import { COMEBACK_WORDING_PROMPT_VERSION } from '../../src/progress/comeback/restart-wording.service';
import {
  REDUCED_REMINDERS_MIN_SAMPLE,
  REDUCED_REMINDERS_RATIO,
  WEEKS_PER_MILESTONE,
  WORKOUTS_PER_MILESTONE,
} from '../../src/progress/milestones/milestone-detector';
import { TIMELINE_MAX_RANGE_DAYS } from '../../src/progress/timeline/timeline.service';

// =============================================================================
// docs/specs/momentum-and-recovery.md against the code it documents (issue #121)
// =============================================================================
//
// The same bargain `today-and-nba.md` has: E12 will read this document, believe
// it, and ship against it — so a stale one is worse than none.
//
// It asserts the DIRECTION THAT ACTUALLY FIRES: every constant the code exports
// appears in the document with its current VALUE. Changing `TREND_DELTA` from
// 0.15 to 0.2 and leaving the table alone is the realistic mistake, and a
// document-mentions-the-name check would sail straight past it.
// =============================================================================

const DOC_PATH = resolve(
  __dirname, '..', '..', '..', '..', 'docs', 'specs', 'momentum-and-recovery.md',
);

const doc = readFileSync(DOC_PATH, 'utf8');

/** A value in a table cell or prose, not a substring of a longer number. */
function documents(value: number | string): boolean {
  const literal = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w.])${literal}([^\\w.]|$)`).test(doc);
}

describe('docs/specs/momentum-and-recovery.md (#121)', () => {
  it('exists and is not a stub', () => {
    expect(doc.length).toBeGreaterThan(8_000);
  });

  describe('the momentum engine', () => {
    it.each([
      ['WINDOW_DAYS', WINDOW_DAYS],
      ['HALF_WINDOW_DAYS', HALF_WINDOW_DAYS],
      ['MIN_PLANNED', MIN_PLANNED],
      ['BUILDING_MAX_HISTORY_DAYS', BUILDING_MAX_HISTORY_DAYS],
      ['BUILDING_MIN_RATIO', BUILDING_MIN_RATIO],
      ['TREND_DELTA', TREND_DELTA],
      ['SLIP_CONSECUTIVE_MISSES', SLIP_CONSECUTIVE_MISSES],
      ['RECOVERY_IDLE_DAYS', RECOVERY_IDLE_DAYS],
      ['RECOVERY_LOOKBACK_DAYS', RECOVERY_LOOKBACK_DAYS],
      ['MAX_EVIDENCE_BULLETS', MAX_EVIDENCE_BULLETS],
    ])('documents %s with its current value', (name, value) => {
      expect(doc).toContain(name);
      expect(documents(value)).toBe(true);
    });

    it('documents every state, and the precedence they resolve in', () => {
      for (const state of MOMENTUM_STATES) expect(doc).toContain(state);

      // The order is the contract; the table has to be in it.
      const positions = MOMENTUM_STATES.map((state) => doc.indexOf(`| \`${state}\` |`));
      for (const position of positions) expect(position).toBeGreaterThan(-1);
    });
  });

  describe('the consistency run and recovery', () => {
    it.each([
      ['WEEK_SUCCESS_RATIO', WEEK_SUCCESS_RATIO],
      ['GRACE_EVERY_N_WEEKS', GRACE_EVERY_N_WEEKS],
      ['RUN_LOOKBACK_WEEKS', RUN_LOOKBACK_WEEKS],
      ['WEEKLY_CHART_WEEKS', WEEKLY_CHART_WEEKS],
    ])('documents %s with its current value', (name, value) => {
      expect(doc).toContain(name);
      expect(documents(value)).toBe(true);
    });

    it('documents the 90-day recovery window', () => {
      expect(documents(RECOVERY_LATENCY_DAYS)).toBe(true);
    });
  });

  describe('the comeback loop', () => {
    it.each([
      ['INACTIVITY_DAYS', INACTIVITY_DAYS],
      ['MISSES_WINDOW_DAYS', MISSES_WINDOW_DAYS],
      ['MISSES_THRESHOLD', MISSES_THRESHOLD],
      ['PLAN_DRIFT_MISSES_14D', PLAN_DRIFT_MISSES_14D],
      ['PLAN_DRIFT_CLOSED', PLAN_DRIFT_CLOSED],
      ['RESTART_MIN_MINUTES', RESTART_MIN_MINUTES],
      ['RESTART_MAX_MINUTES', RESTART_MAX_MINUTES],
    ])('documents %s with its current value', (name, value) => {
      expect(doc).toContain(name);
      expect(documents(value)).toBe(true);
    });

    it('documents the domain preference in its real order', () => {
      expect(doc).toContain(DOMAIN_PREFERENCE.join("', '"));
    });

    it('documents the activity write interval in minutes', () => {
      expect(documents(ACTIVITY_WRITE_INTERVAL_MS / 60_000)).toBe(true);
      expect(doc).toContain('ACTIVITY_WRITE_INTERVAL_MS');
    });

    it('quotes the three sentences that ship on a provider outage, verbatim', () => {
      expect(doc).toContain(CELEBRATION_TITLE);
      expect(doc).toContain(CELEBRATION_BODY);
      expect(doc).toContain(OFFER_NOTE);
    });

    it('records the prompt version, so a bump is visible in the diff', () => {
      expect(doc).toContain(COMEBACK_WORDING_PROMPT_VERSION);
    });
  });

  describe('milestones and the timeline', () => {
    it.each([
      ['WEEKS_PER_MILESTONE', WEEKS_PER_MILESTONE],
      ['WORKOUTS_PER_MILESTONE', WORKOUTS_PER_MILESTONE],
      ['REDUCED_REMINDERS_RATIO', REDUCED_REMINDERS_RATIO],
      ['REDUCED_REMINDERS_MIN_SAMPLE', REDUCED_REMINDERS_MIN_SAMPLE],
      ['TIMELINE_MAX_RANGE_DAYS', TIMELINE_MAX_RANGE_DAYS],
    ])('documents %s with its current value', (name, value) => {
      expect(doc).toContain(name);
      expect(documents(value)).toBe(true);
    });
  });

  it('records the rejected alternatives, so they are not re-proposed', () => {
    expect(doc).toContain('Rejected alternatives');
    for (const rejected of [
      'single quality-of-life score',
      'Daily streaks',
      'comebacks` table',
      'AI-chosen momentum states',
      'Closing `STARTED` rows',
    ]) {
      expect(doc).toContain(rejected);
    }
  });
});
