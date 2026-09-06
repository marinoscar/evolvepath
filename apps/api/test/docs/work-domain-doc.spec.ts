import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ASKED_RECENTLY_DAYS,
  SKIP_WINDOW_DAYS,
  WINDOW_FAILURE_DAYS,
} from '../../src/work/avoidance/avoidance-signals.service';
import {
  INTERVENTION_TYPE_BY_LEVEL,
  WEEKS_FOR_PLAN_CHALLENGE,
} from '../../src/work/avoidance/avoidance-detector';
import { FRICTION_ANSWERS } from '../../src/work/avoidance/friction-answers';
import {
  MAX_RECOMMENDED_MINUTES,
  MAX_INTERVENTION_HISTORY,
} from '../../src/work/avoidance/friction.service';
import {
  DEFAULT_AVAILABLE_MINUTES_PER_DAY,
  DEFAULT_HORIZON_DAYS,
  MAX_SESSIONS_PER_DAY,
} from '../../src/work/planning/work-session-plan.guardrails';
import {
  TEMPLATE_DEFAULT_SESSIONS,
  TEMPLATE_MAX_SESSIONS,
  TEMPLATE_MAX_SESSION_MINUTES,
  TEMPLATE_SESSION_TIME,
} from '../../src/work/planning/work-session-templates';
import {
  WORK_SESSION_PLAN_PROMPT_VERSION,
  WORK_SESSION_PLAN_SCHEMA_NAME,
} from '../../src/work/planning/work-session-plan.schema';
import { FRICTION_PROMPT_VERSION } from '../../src/work/avoidance/friction.instructions';
import {
  MAX_DISTRACTION_NOTES,
  MAX_LIST_DAYS,
} from '../../src/work/focus/focus-session.service';
import {
  MIN_PLANNED_FOR_WINDOW_VERDICT,
  REPEATEDLY_POSTPONED_RESCHEDULES,
} from '../../src/work/summary/work-summary.aggregator';
import { LOOKAROUND_DAYS } from '../../src/work/summary/work-summary.service';
import { PROTECTED_RESCHEDULE_WINDOW_MS } from '../../src/commitments/actions/commitment-actions.service';

// =============================================================================
// docs/specs/work-domain.md against the code it documents (issue #122)
// =============================================================================
//
// The spec is what E10's weekly review and E12's notifications will read,
// believe, and ship against, which makes a stale one worse than none. Nothing
// but a test keeps prose in step with a constant.
//
// IT ASSERTS THE VALUE, NOT THE NAME. A document that names
// `MAX_SESSIONS_PER_DAY` and says "three" is exactly as wrong as one that has
// forgotten the constant exists — and the value moving is the realistic change.
// =============================================================================

const DOC_PATH = resolve(__dirname, '..', '..', '..', '..', 'docs', 'specs', 'work-domain.md');
const doc = readFileSync(DOC_PATH, 'utf8');

describe('docs/specs/work-domain.md', () => {
  it('exists and is substantial enough to be the contract it claims to be', () => {
    expect(doc.length).toBeGreaterThan(8000);
    expect(doc).toContain('# The Work domain: focus sessions and anti-procrastination');
  });

  describe('the planning constants', () => {
    it.each([
      ['DEFAULT_HORIZON_DAYS', DEFAULT_HORIZON_DAYS],
      ['MAX_SESSIONS_PER_DAY', MAX_SESSIONS_PER_DAY],
      ['DEFAULT_AVAILABLE_MINUTES_PER_DAY', DEFAULT_AVAILABLE_MINUTES_PER_DAY],
      ['TEMPLATE_MAX_SESSIONS', TEMPLATE_MAX_SESSIONS],
      ['TEMPLATE_DEFAULT_SESSIONS', TEMPLATE_DEFAULT_SESSIONS],
      ['TEMPLATE_MAX_SESSION_MINUTES', TEMPLATE_MAX_SESSION_MINUTES],
    ])('documents %s with its current value', (name, value) => {
      // The NAME and the VALUE on one line. A document that names the constant
      // and gives the wrong number is exactly as wrong as one that forgot it.
      expect(doc).toMatch(new RegExp(`${name}[^\\n]*\\b${value}\\b`));
    });

    it('quotes the template session time', () => {
      expect(doc).toContain(`\`'${TEMPLATE_SESSION_TIME}'\``);
    });

    it('names the schema and the prompt version the planner is called with', () => {
      expect(doc).toContain(WORK_SESSION_PLAN_SCHEMA_NAME);
      expect(doc).toContain(WORK_SESSION_PLAN_PROMPT_VERSION);
    });
  });

  describe('the ladder', () => {
    it.each(INTERVENTION_TYPE_BY_LEVEL.map((name, level) => [level, name] as const))(
      'documents level %i as %s',
      (_level, name) => {
        expect(doc).toContain(`\`${name}\``);
      },
    );

    it.each([
      ['RESCHEDULED_TWICE', 2],
      ['UNCHANGED_3_DAYS', 3],
      ['SHORT_SKIPS', 2],
      ['DISPLACED_BY_LOWER_IMPORTANCE', 2],
      ['SAME_WINDOW_FAILURES', 3],
    ])('documents the %s threshold as %i', (signal, threshold) => {
      expect(doc).toContain(`\`${signal}\``);
      expect(doc).toMatch(new RegExp(`\`${signal}\`[\\s\\S]{0,120}${threshold}`));
    });

    it.each([
      ['WEEKS_FOR_PLAN_CHALLENGE', WEEKS_FOR_PLAN_CHALLENGE],
      ['SKIP_WINDOW_DAYS', SKIP_WINDOW_DAYS],
      ['WINDOW_FAILURE_DAYS', WINDOW_FAILURE_DAYS],
      ['ASKED_RECENTLY_DAYS', ASKED_RECENTLY_DAYS],
    ])('documents %s with its current value', (name, value) => {
      expect(doc).toMatch(new RegExp(`${name}[^\\n]*${value}`));
    });

    // PRD §25's rule, and the reason every other rung is defensible.
    it('says out loud that one occurrence is never avoidance', () => {
      expect(doc).toMatch(/single reschedule[\s\S]{0,140}level 0/i);
    });
  });

  describe('the friction answers', () => {
    it.each(FRICTION_ANSWERS.map((rule) => [rule.key, rule] as const))(
      'documents %s with its label, intervention and obstacle',
      (_key, rule) => {
        expect(doc).toContain(`\`${rule.key}\``);
        expect(doc).toContain(rule.label);
        expect(doc).toContain(`\`${rule.interventionType}\``);
        expect(doc).toContain(`\`${rule.obstacleType}\``);
      },
    );

    it.each([
      ['MAX_RECOMMENDED_MINUTES', MAX_RECOMMENDED_MINUTES],
      ['MAX_INTERVENTION_HISTORY', MAX_INTERVENTION_HISTORY],
    ])('documents %s with its current value', (name, value) => {
      expect(doc).toMatch(new RegExp(`${name}[^\\n]*${value}|${value}[^\\n]*${name}`));
    });

    it('names the friction prompt version', () => {
      expect(doc).toContain(FRICTION_PROMPT_VERSION);
    });

    it('documents the protected-reschedule window in hours', () => {
      const hours = PROTECTED_RESCHEDULE_WINDOW_MS / 3_600_000;

      expect(doc).toContain('PROTECTED_RESCHEDULE_WINDOW_MS');
      expect(doc).toMatch(new RegExp(`\\(${hours} hours\\)`));
    });
  });

  describe('the focus session and summary constants', () => {
    it.each([
      ['MAX_DISTRACTION_NOTES', MAX_DISTRACTION_NOTES],
      ['MAX_LIST_DAYS', MAX_LIST_DAYS],
      ['MIN_PLANNED_FOR_WINDOW_VERDICT', MIN_PLANNED_FOR_WINDOW_VERDICT],
      ['REPEATEDLY_POSTPONED_RESCHEDULES', REPEATEDLY_POSTPONED_RESCHEDULES],
      ['LOOKAROUND_DAYS', LOOKAROUND_DAYS],
    ])('documents %s with its current value', (name, value) => {
      expect(doc).toMatch(new RegExp(`${name}[^\\n]*${value}|${value}[^\\n]*${name}`));
    });
  });

  describe('the promises that are not constants', () => {
    it.each([
      ['start is recorded separately from completion', /separately from completion/i],
      ['`abandoned` still writes evidence', /abandoned[\s\S]{0,200}evidence/i],
      ['nothing is stored when a model plan breaks a guardrail', /NOTHING IS STORED/],
      ['the coach is overruled rather than corrected', /discarded[\s\S]{0,120}template/i],
      ['safety runs before the model', /Safety runs before the model/i],
      ['rates are null rather than zero', /Rates are `null`, not `0`/],
      ['there is no stored level column', /no stored `avoidanceLevel` column/i],
    ])('states that %s', (_label, pattern) => {
      expect(doc).toMatch(pattern);
    });
  });
});
