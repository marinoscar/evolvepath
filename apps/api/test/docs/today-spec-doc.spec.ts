import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { INTERVENTION_MODES } from '../../src/today/nba/intervention-mode';
import {
  CHALLENGE_PLAN_FAILURES,
  DIAGNOSE_RESCHEDULES,
  RECOVER_DAYS,
  REINFORCE_COMPLETIONS,
} from '../../src/today/nba/intervention-mode';
import {
  CONFLICT_PENALTY,
  CONTEXTUAL_FIT_WEIGHT,
  DOMAIN_BALANCE_WEIGHT,
  EFFORT_MISMATCH_PENALTY,
  FATIGUE_PENALTY,
  IMPORTANCE_WEIGHT,
  PLAN_RELEVANCE_WEIGHT,
  REPEATED_AVOIDANCE_WEIGHT,
  URGENCY_WEIGHT,
} from '../../src/today/nba/nba-scorer';
import { COMMITMENT_ACTIONS } from '../../src/commitments/commitment-actions';
import { MAX_CLOCK_SKEW_SECONDS_DOC } from './today-spec-constants';

// =============================================================================
// docs/specs/today-and-nba.md against the code it documents (issue #55)
// =============================================================================
//
// The same bargain `domain-model.md` has: E07, E10, E11 and E12 will read this
// document, believe it, and ship against it — so a stale one is worse than none.
//
// It asserts the DIRECTION THAT ACTUALLY FIRES: every constant the code exports
// appears in the document with its current VALUE. Changing a weight from 30 to
// 40 and leaving the table alone is the realistic mistake, and a
// document-mentions-the-name check would sail straight past it.
// =============================================================================

const DOC_PATH = resolve(
  __dirname, '..', '..', '..', '..', 'docs', 'specs', 'today-and-nba.md',
);

const doc = readFileSync(DOC_PATH, 'utf8');

/** `| \`NAME\` | 30 |` — the weight table's own shape. */
function documentsConstant(name: string, value: number): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const magnitude = Math.abs(value);
  // Penalties are written with a leading minus in the table; weights are not.
  return new RegExp(`\`${escaped}\`[^|]*\\|\\s*−?-?${magnitude}\\s*\\|`).test(doc);
}

describe('docs/specs/today-and-nba.md', () => {
  it('exists and is substantial enough to be the contract it claims to be', () => {
    expect(doc.length).toBeGreaterThan(8000);
    expect(doc).toContain('# Today and the next best action');
  });

  describe('the scoring weights', () => {
    it.each([
      ['IMPORTANCE_WEIGHT', IMPORTANCE_WEIGHT],
      ['URGENCY_WEIGHT', URGENCY_WEIGHT],
      ['REPEATED_AVOIDANCE_WEIGHT', REPEATED_AVOIDANCE_WEIGHT],
      ['PLAN_RELEVANCE_WEIGHT', PLAN_RELEVANCE_WEIGHT],
      ['DOMAIN_BALANCE_WEIGHT', DOMAIN_BALANCE_WEIGHT],
      ['CONTEXTUAL_FIT_WEIGHT', CONTEXTUAL_FIT_WEIGHT],
      ['EFFORT_MISMATCH_PENALTY', EFFORT_MISMATCH_PENALTY],
      ['CONFLICT_PENALTY', CONFLICT_PENALTY],
      ['FATIGUE_PENALTY', FATIGUE_PENALTY],
    ])('documents %s with its current value', (name, value) => {
      expect(documentsConstant(name, value as number)).toBe(true);
    });
  });

  describe('the intervention modes', () => {
    it.each(INTERVENTION_MODES)('documents the mode %s', (mode) => {
      expect(doc).toContain(`\`${mode}\``);
    });

    it.each([
      ['RECOVER_DAYS', RECOVER_DAYS],
      ['CHALLENGE_PLAN_FAILURES', CHALLENGE_PLAN_FAILURES],
      ['DIAGNOSE_RESCHEDULES', DIAGNOSE_RESCHEDULES],
      ['REINFORCE_COMPLETIONS', REINFORCE_COMPLETIONS],
    ])('documents %s with its current value', (name, value) => {
      expect(doc).toContain(`${name} = ${value}`);
    });

    // Order IS the design: every rule can be true at once, and the winner
    // decides what the product says to someone having a hard week.
    it('presents the modes in resolution order', () => {
      const order = [
        'RECOVER',
        'CHALLENGE_PLAN',
        'DIAGNOSE',
        'REDUCE',
        'RECONNECT',
        'CLARIFY',
        'REINFORCE',
        'ACT',
      ];
      const table = doc.slice(doc.indexOf('## 6. Intervention mode'));
      const positions = order.map((mode) => table.indexOf(`| \`${mode}\``));

      expect(positions.every((position) => position >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    });
  });

  describe('the commitment actions', () => {
    it.each(COMMITMENT_ACTIONS)('documents the action %s', (action) => {
      expect(doc).toContain(`\`${action}\``);
    });

    it('gives each one its audit action', () => {
      for (const action of ['start', 'pause', 'continue', 'complete', 'partial', 'fallback']) {
        expect(doc).toContain(`commitment:${action}`);
      }
      expect(doc).toContain('commitment:decompose_apply');
    });
  });

  it('records the decisions a later epic must not quietly reverse', () => {
    // Each is a rule stated in prose that a reader could reasonably decide to
    // "simplify" — and each has a test somewhere that would then fail
    // mysteriously rather than in the place the decision was made.
    expect(doc).toContain('Elapsed is never stored');
    expect(doc).toContain('no `PAUSED` status');
    expect(doc).toContain('never 403');
    expect(doc).toContain('A size the user never declared is never offered');
    expect(doc).toContain('The count travels with the intention, not the row');
    expect(doc).toContain('one field');
    expect(doc).toContain('date_local` is **text**');
  });

  it('states the clock-skew guard the client applies', () => {
    expect(doc).toContain(`**${MAX_CLOCK_SKEW_SECONDS_DOC} seconds**`);
  });

  it('carries the deep-link contract E12 will build on', () => {
    expect(doc).toContain('?commitment=<uuid>&action=<verb>');
    expect(doc).toContain("replace: true");
  });

  it('lists what each later epic reads from here', () => {
    for (const epic of ['E07', 'E10', 'E11', 'E12']) {
      expect(doc).toContain(epic);
    }
  });

  it('keeps its rejected alternatives, which are the expensive part to rediscover', () => {
    expect(doc).toContain('## 14. Rejected alternatives');
    expect(doc).toContain('Rescheduling in place');
    expect(doc).toContain('An AI-ranked next best action');
  });
});
