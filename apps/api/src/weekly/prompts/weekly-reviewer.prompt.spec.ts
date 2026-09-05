import {
  buildWeeklyReviewerInstructions,
  REVIEW_STYLE_BLOCKS,
  WEEKLY_REVIEWER_PROMPT_VERSION,
} from './weekly-reviewer.prompt';

describe('the weekly reviewer prompt', () => {
  it('is versioned, and the version is what the telemetry row records', () => {
    expect(WEEKLY_REVIEWER_PROMPT_VERSION).toBe('weekly_reviewer.v1');
  });

  it('separates observation, inference and recommendation (PRD §14.4)', () => {
    const instructions = buildWeeklyReviewerInstructions({ style: 'BALANCED' });

    expect(instructions).toContain('observation');
    expect(instructions).toContain('inference');
    expect(instructions).toContain('recommendation');
    expect(instructions).toContain('confidence');
  });

  it('names all six outputs', () => {
    const instructions = buildWeeklyReviewerInstructions({ style: 'BALANCED' });

    for (const output of [
      'whatWorked',
      'whatDidNot',
      'patterns',
      'proposedChanges',
      'keepUnchanged',
      'doNotAddYet',
    ]) {
      expect(instructions).toContain(output);
    }
  });

  it('caps the proposals and asks for reduction before addition (PRD §51)', () => {
    const instructions = buildWeeklyReviewerInstructions({ style: 'BALANCED' });

    expect(instructions).toContain('AT MOST TWO CHANGES');
    expect(instructions).toContain('REDUCE OR MOVE BEFORE YOU ADD');
  });

  it('forbids the plan being changed rather than proposed (PRD §15)', () => {
    expect(buildWeeklyReviewerInstructions({ style: 'DIRECT' })).toContain(
      'You do not change the plan',
    );
  });

  it('states the anti-shame rules as prohibitions, not as tone', () => {
    // "Be encouraging" and "never use guilt" are different instructions, and a
    // model asked only for the first will sometimes reach for the second.
    const instructions = buildWeeklyReviewerInstructions({ style: 'DIRECT' });

    expect(instructions).toContain('NEVER USE: guilt, shame');
    expect(instructions).toContain('A FAILED PLAN IS INFORMATION');
  });

  it.each(Object.keys(REVIEW_STYLE_BLOCKS))('carries the %s tone block', (style) => {
    expect(buildWeeklyReviewerInstructions({ style })).toContain(REVIEW_STYLE_BLOCKS[style]);
  });

  it('falls back to BALANCED for an unknown style rather than dropping tone', () => {
    expect(buildWeeklyReviewerInstructions({ style: 'SARCASTIC' })).toContain(
      REVIEW_STYLE_BLOCKS.BALANCED,
    );
  });

  it('tells the reviewer that an unfinished week is not a thin one', () => {
    expect(buildWeeklyReviewerInstructions({ style: 'BALANCED' })).toContain(
      'coverage.partial',
    );
  });
});
