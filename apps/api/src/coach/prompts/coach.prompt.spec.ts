import { SAFETY_CONSERVATIVE_INSTRUCTIONS } from '../safety/safety-copy';
import type { SafetyDecision } from '../safety/safety.types';
import {
  COACH_PROMPT_VERSION,
  STYLE_BLOCKS,
  buildCoachInstructions,
} from './coach.prompt';

describe('buildCoachInstructions (#70)', () => {
  it('is versioned', () => {
    // PRD §117. This constant is what makes "did the coach get worse after we
    // changed the prompt?" answerable.
    expect(COACH_PROMPT_VERSION).toBe('coach.v1');
  });

  it.each(['GENTLE', 'BALANCED', 'DIRECT'])('uses the %s tone block', (style) => {
    const instructions = buildCoachInstructions({ style });

    expect(instructions).toContain(STYLE_BLOCKS[style]);
    for (const other of Object.keys(STYLE_BLOCKS).filter((s) => s !== style)) {
      expect(instructions).not.toContain(STYLE_BLOCKS[other]);
    }
  });

  it('falls back to BALANCED for an unknown style', () => {
    expect(buildCoachInstructions({ style: 'BRUTAL' })).toContain(
      STYLE_BLOCKS.BALANCED,
    );
  });

  it('never lets DIRECT mean guilt or disappointment', () => {
    // PRD §129. "Be direct" and "use disappointment" are different
    // instructions, and a model given only the first sometimes reaches for the
    // second — so the prompt has to rule it out where the tone is set.
    const direct = buildCoachInstructions({ style: 'DIRECT' });

    expect(direct).toContain('never means guilt, blame or expressing disappointment');
    expect(direct).toContain('NEVER USE: guilt, shame, disappointment');
  });

  it('forbids inventing state and forbids changing the plan, in every style', () => {
    for (const style of Object.keys(STYLE_BLOCKS)) {
      const instructions = buildCoachInstructions({ style });

      expect(instructions).toContain('the only true record of this user');
      expect(instructions).toContain('must appear in the CONTEXT block');
      expect(instructions).toContain('A plan change is a "proposal"');
      expect(instructions).toContain('therapist, doctor or clinician');
    }
  });

  it('says reasoning_summary is not chain of thought', () => {
    // PRD §16/§88: the summary is shown, the working never is.
    expect(buildCoachInstructions({ style: 'BALANCED' })).toContain(
      'not your working, not a chain of thought',
    );
  });

  it('appends the conservative block only when safety asked for it', () => {
    const conservative: SafetyDecision = {
      decision: 'conservative',
      category: 'injury',
      source: 'model',
    };
    const allow: SafetyDecision = {
      decision: 'allow',
      category: 'none',
      source: 'precheck',
    };

    expect(buildCoachInstructions({ style: 'BALANCED', safety: conservative })).toContain(
      SAFETY_CONSERVATIVE_INSTRUCTIONS,
    );
    expect(buildCoachInstructions({ style: 'BALANCED', safety: allow })).not.toContain(
      SAFETY_CONSERVATIVE_INSTRUCTIONS,
    );
    expect(buildCoachInstructions({ style: 'BALANCED' })).not.toContain(
      SAFETY_CONSERVATIVE_INSTRUCTIONS,
    );
  });
});
