import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ACCESSORY_HINT_EXERCISES,
  EXERCISE_SKIP_SESSIONS,
  MINIMUM_MINUTES,
  OVER_RUN_MINUTES,
  REDUCE_FACTOR as ADAPTATION_REDUCE_FACTOR,
  SIGNAL_THRESHOLD,
  WINDOW_DAYS,
} from '../../src/workouts/adaptation/adaptation-rules';
import { NEAR_MATCH_THRESHOLD } from '../../src/workouts/exercises/exercise-resolver.service';
import { COACHING_SUMMARY_KEY } from '../../src/workouts/media/media-summary.service';
import {
  CALORIE_PATTERN,
  EQUIPMENT_CHECK_PROMPT_VERSION,
  FORM_CHECK_PROMPT_VERSION,
  MEAL_CHECK_PROMPT_VERSION,
  REDIRECTING_FLAGS,
} from '../../src/workouts/media/schemas/media-check.schemas';
import {
  BEGINNER_MAX_DAYS,
  MINUTES_TOLERANCE_PCT,
  SECONDS_PER_REP,
  SESSION_OVERHEAD_MINUTES,
} from '../../src/workouts/programs/workout-program-rules';
import {
  PROGRAM_PROMPT_VERSION,
  PROGRAM_SCHEMA_NAME,
} from '../../src/workouts/programs/workout-program.schema';
import { SCHEDULE_DAYS } from '../../src/workouts/programs/workout-programs.service';
import {
  COMFORTABLE_RPE,
  INCREMENT_KG,
  REDUCE_FACTOR as PROGRESSION_REDUCE_FACTOR,
  WEIGHT_STEP_KG,
} from '../../src/workouts/progression/double-progression';
import { PROGRESSION_PROMPT_VERSION } from '../../src/workouts/progression/progression-explainer.service';
import {
  PAIN_SAFETY_ACTION,
  PAIN_SAFETY_COPY,
} from '../../src/workouts/safety/workout-safety-copy';
import {
  BEHAVIOUR_TIMES,
  NUTRITION_BEHAVIOR_KEYS,
} from '../../src/health-domain/nutrition/nutrition-behaviors';
import {
  MIN_POINTS_FOR_TREND,
  TREND_WINDOW_DAYS,
} from '../../src/health-domain/weight/rolling-mean';

// =============================================================================
// docs/specs/health-domain.md against the code it documents (issue #114)
// =============================================================================
//
// The same bargain `family-domain.md` and `weekly-review.md` have, and it is
// worth restating because E09 is the epic most likely to be extended by
// somebody who was not here: a later reader will take the progression table,
// the detector thresholds and the safety copy at face value and ship against
// them. A stale document is worse than none.
//
// IT ASSERTS THE DIRECTION THAT ACTUALLY FIRES: every constant the code exports
// appears in the document WITH ITS CURRENT VALUE. Moving `REDUCE_FACTOR` from
// 0.65 to 0.5 and leaving the table alone is the realistic mistake, and a
// does-the-document-mention-the-name check sails straight past it.
//
// TWO CONSTANTS ARE NAMED HERE AND NOT IMPORTED, deliberately: the outbox lives
// in `apps/web` and this suite cannot import across the workspace boundary. The
// literals below are the document's claim about it; the web unit tests are what
// hold the code to the same numbers.
// =============================================================================

const REPO = resolve(__dirname, '..', '..', '..', '..');
const DOC_PATH = resolve(REPO, 'docs', 'specs', 'health-domain.md');

const doc = readFileSync(DOC_PATH, 'utf8');

/**
 * The document with its line wrapping collapsed.
 *
 * Prose is hard-wrapped at 80 columns, so a quoted sentence is almost never on
 * one line and a raw `toContain` would fail for reflowing a paragraph — which
 * teaches the next person to delete the test rather than fix the document.
 * Blockquote markers go first, so a wrapped quote does not keep a `>` in the
 * middle of it.
 */
const flat = doc
  .replace(/^\s*>\s?/gm, ' ')
  .replace(/\s+/g, ' ');

/** `NAME` = `VALUE`, `NAME = VALUE`, and `NAME` `VALUE` all count. */
function documentsValue(name: string, value: string | number): boolean {
  const escaped = String(value).replace(/\./g, '\\.');

  return new RegExp(`${name}\`?\\s*(?:=\\s*)?\`?${escaped}\``).test(flat);
}

describe('docs/specs/health-domain.md', () => {
  it('exists and is substantial enough to be the contract it claims to be', () => {
    expect(doc.length).toBeGreaterThan(12000);
    expect(doc).toContain('# The Health domain');
  });

  describe('the program builder', () => {
    it.each([
      ['BEGINNER_MAX_DAYS', BEGINNER_MAX_DAYS],
      ['MINUTES_TOLERANCE_PCT', MINUTES_TOLERANCE_PCT],
      ['SECONDS_PER_REP', SECONDS_PER_REP],
      ['SESSION_OVERHEAD_MINUTES', SESSION_OVERHEAD_MINUTES],
      ['SCHEDULE_DAYS', SCHEDULE_DAYS],
      ['NEAR_MATCH_THRESHOLD', NEAR_MATCH_THRESHOLD],
    ])('documents %s with its current value', (name, value) => {
      expect(documentsValue(name as string, value as number)).toBe(true);
    });

    it('names every rule code', () => {
      for (const code of ['BEGINNER_MAX_DAYS', 'CONTRAINDICATED', 'OVER_TIME_BUDGET', 'DAYS_MISMATCH']) {
        expect(doc).toContain(code);
      }
    });

    it('documents the contract and its prompt version', () => {
      expect(doc).toContain(PROGRAM_PROMPT_VERSION);
      expect(doc).toContain(PROGRAM_SCHEMA_NAME);
    });

    // The rule the whole fallback rests on: a violation degrades, it does not
    // throw. A document that lost this sentence would invite the next person to
    // "fix" the swallowed error.
    it('records that a violation degrades to the starter program', () => {
      expect(flat).toContain('never a 500 and never an exception');
      expect(doc).toContain('starter program');
    });

    it('records that approve is one transaction and notifies after the commit', () => {
      expect(flat).toContain('one `$transaction`');
      expect(doc).toContain('health.program_activated');
      expect(flat).toContain('after the commit');
    });
  });

  describe('the session', () => {
    it('records that the client mints the set id', () => {
      expect(doc).toContain('clientId');
      expect(flat).toContain('P2002');
      expect(flat.toLowerCase()).toContain('a replay');
    });

    it('documents the outbox constants the web app holds', () => {
      expect(documentsValue('RETRY_INTERVAL_MS', 5000)).toBe(true);
      expect(documentsValue('BATCH_THRESHOLD', 2)).toBe(true);
      expect(doc).toContain('workout.outbox.');
    });

    it('carries the finish → commitment table', () => {
      for (const status of ['COMPLETED', 'PARTIALLY_COMPLETED', 'ABANDONED']) {
        expect(doc).toContain(status);
      }
      expect(doc).toContain('WORKOUT_LOG');
    });
  });

  describe('the safety copy', () => {
    it('quotes it verbatim, because it is the one sentence nothing generates', () => {
      expect(flat).toContain(PAIN_SAFETY_COPY);
      expect(doc).toContain(PAIN_SAFETY_ACTION);
    });
  });

  describe('progression', () => {
    it.each([
      ['COMFORTABLE_RPE', COMFORTABLE_RPE],
      ['REDUCE_FACTOR', PROGRESSION_REDUCE_FACTOR],
      ['WEIGHT_STEP_KG', WEIGHT_STEP_KG],
    ])('documents %s with its current value', (name, value) => {
      expect(documentsValue(name as string, value as number)).toBe(true);
    });

    it('documents every increment, per implement', () => {
      for (const [equipment, increment] of Object.entries(INCREMENT_KG)) {
        expect(documentsValue(equipment, increment)).toBe(true);
      }
    });

    // The ORDER is the rule. A table that lists the same six reasons in a
    // different order describes a different product.
    it('lists the six reasons in the order the code evaluates them', () => {
      const order = [
        'first_session',
        'discomfort',
        'top_of_range_twice',
        'below_min_twice',
        'insufficient_history',
        'building',
      ];
      // Backticked, because `discomfort:` appears in §4 as well and a bare
      // substring search would compare the wrong occurrences.
      const positions = order.map((reason) => doc.indexOf(`\`${reason}\``));

      expect(positions.every((position) => position >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    });

    it('records that the explainer may not introduce a number', () => {
      expect(doc).toContain(PROGRESSION_PROMPT_VERSION);
      expect(flat).toContain('numbersAreSafe');
    });
  });

  describe('adaptation', () => {
    it.each([
      ['SIGNAL_THRESHOLD', SIGNAL_THRESHOLD],
      ['WINDOW_DAYS', WINDOW_DAYS],
      ['OVER_RUN_MINUTES', OVER_RUN_MINUTES],
      ['EXERCISE_SKIP_SESSIONS', EXERCISE_SKIP_SESSIONS],
      ['REDUCE_FACTOR', ADAPTATION_REDUCE_FACTOR],
      ['MINIMUM_MINUTES', MINIMUM_MINUTES],
      ['ACCESSORY_HINT_EXERCISES', ACCESSORY_HINT_EXERCISES],
    ])('documents %s with its current value', (name, value) => {
      expect(documentsValue(name as string, value as number)).toBe(true);
    });

    it('names every detector', () => {
      for (const detector of ['SKIPPED_TWICE', 'TOO_LONG', 'EXERCISE_SKIPPED', 'DISLIKED']) {
        expect(doc).toContain(detector);
      }
    });

    it('records the two ops a workout proposal may use, and the four it may not', () => {
      expect(flat).toContain('never `move`, `add`, `remove` or');
      expect(doc).toContain('`reduce`');
      expect(doc).toContain('`replace`');
    });

    it('records that the plan changes only on accept', () => {
      expect(doc).toContain('plan_change_proposals');
      expect(flat).toContain('POST /api/proposals/:id/accept');
      expect(doc).toContain('PROPOSAL_EFFECT');
      expect(doc).toContain('routine_id');
    });

    it('documents the cron and its off switch', () => {
      expect(doc).toContain('WORKOUT_ADAPTATION_CRON_DISABLED');
      expect(doc).toContain("'0 4 * * *'");
    });
  });

  describe('media coaching', () => {
    it.each([
      FORM_CHECK_PROMPT_VERSION,
      EQUIPMENT_CHECK_PROMPT_VERSION,
      MEAL_CHECK_PROMPT_VERSION,
    ])('documents the prompt version %s', (version) => {
      expect(doc).toContain(version);
    });

    it('names both redirecting flags', () => {
      for (const flag of REDIRECTING_FLAGS) {
        expect(doc).toContain(flag);
      }
    });

    // Quoted verbatim: a pattern that gained a word and a document that did not
    // is a document that understates what the product refuses to say.
    it('quotes the no-calorie pattern verbatim', () => {
      expect(doc).toContain(CALORIE_PATTERN.source);
      expect(flat).toContain('rejects the whole output');
    });

    it('names the metadata key media summaries are stored under', () => {
      expect(doc).toContain(COACHING_SUMMARY_KEY);
    });
  });

  describe('nutrition and weight', () => {
    it.each([...NUTRITION_BEHAVIOR_KEYS])('names the behaviour %s', (key) => {
      expect(doc).toContain(key);
    });

    it('documents the three default times', () => {
      for (const [slot, time] of Object.entries(BEHAVIOUR_TIMES)) {
        expect(documentsValue(slot, time)).toBe(true);
      }
    });

    it.each([
      ['TREND_WINDOW_DAYS', TREND_WINDOW_DAYS],
      ['MIN_POINTS_FOR_TREND', MIN_POINTS_FOR_TREND],
    ])('documents %s with its current value', (name, value) => {
      expect(documentsValue(name as string, value as number)).toBe(true);
    });

    it('records the no-judgment rule', () => {
      expect(flat).toContain('no field a client could use to judge a day');
      expect(doc).toContain('calorie');
    });
  });

  describe('the audit trail', () => {
    it.each([
      'workout_program:generate',
      'workout_program:approve',
      'workout_adaptation:propose',
      'workout_adaptation:applied',
      'nutrition:commit',
    ])('names the audit action %s', (action) => {
      expect(doc).toContain(action);
    });
  });

  describe('the PRD §106 map', () => {
    it('points at the spec that proves each line', () => {
      expect(doc).toContain('tests/e2e/specs/health.spec.ts');
      expect(doc).toContain('mobile-chromium');
    });

    it('names every fake-server schema the suite depends on', () => {
      for (const schema of [
        'workout_program',
        'form_check',
        'equipment_check',
        'meal_check',
        'progression_explanation',
      ]) {
        expect(doc).toContain(schema);
      }
    });
  });

  describe('the rules a later epic must not quietly break', () => {
    it.each([
      'onDelete: Restrict',
      '@@unique([sessionId, exerciseId, setNumber])',
      'never identifies',
      'outside `Layout`',
      'Two sessions, not one',
      '404, never a 403',
    ])('records %s', (phrase) => {
      expect(flat.toLowerCase()).toContain(phrase.toLowerCase());
    });
  });

  describe('the links the epic promised', () => {
    it.each([
      'domain-model.md',
      'today-and-nba.md',
      'coach-and-memory.md',
      'weekly-review.md',
      'family-domain.md',
      'ai-gateway.md',
    ])('links to %s', (name) => {
      expect(doc).toContain(name);
    });

    it.each([
      ['CLAUDE.md', resolve(REPO, 'CLAUDE.md')],
      ['docs/API.md', resolve(REPO, 'docs', 'API.md')],
      ['docs/TESTING.md', resolve(REPO, 'docs', 'TESTING.md')],
    ])('is linked from %s', (_name, path) => {
      expect(readFileSync(path, 'utf8')).toContain('docs/specs/health-domain.md');
    });
  });
});
