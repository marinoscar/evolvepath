import { INTERVENTION_MODES } from './intervention-mode';
import { rationaleFor, stateLineFor, type RationaleFacts } from './rationale-templates';

const facts = (over: Partial<RationaleFacts> = {}): RationaleFacts => ({
  title: 'Draft the storyline',
  minutes: 25,
  domain: 'WORK',
  rescheduleCount: 0,
  whyItMatters: null,
  availableMinutesRemaining: 600,
  ...over,
});

describe('rationaleFor (#38)', () => {
  it('produces a non-empty sentence for every mode', () => {
    for (const mode of INTERVENTION_MODES) {
      const sentence = rationaleFor(mode, facts());

      expect(sentence.length).toBeGreaterThan(10);
      expect(sentence.trim()).toBe(sentence);
    }
  });

  it('names how many times a repeatedly-moved commitment has moved', () => {
    expect(rationaleFor('DIAGNOSE', facts({ rescheduleCount: 3 }))).toContain('3 times');
  });

  it('quotes the user back to themselves when they gave us something to quote', () => {
    expect(
      rationaleFor('RECONNECT', facts({ whyItMatters: 'Free my evenings', minutes: 5 })),
    ).toContain('Free my evenings');
  });

  // A template with an empty quotation reads as a bug.
  it('does not leave an empty quotation when there is no motive', () => {
    const sentence = rationaleFor('RECONNECT', facts({ whyItMatters: null }));

    expect(sentence).not.toContain('“”');
    expect(sentence).toContain('25-minute');
  });

  it('states the size it is recommending', () => {
    expect(rationaleFor('ACT', facts({ minutes: 5 }))).toContain('5 minutes');
  });
});

describe('stateLineFor (#38)', () => {
  it('counts plainly, in singular and plural', () => {
    expect(stateLineFor({ commitmentCount: 0, pausedDomains: [], maintainDomains: [] })).toBe(
      'Nothing scheduled today.',
    );
    expect(stateLineFor({ commitmentCount: 1, pausedDomains: [], maintainDomains: [] })).toBe(
      '1 commitment today.',
    );
    expect(stateLineFor({ commitmentCount: 3, pausedDomains: [], maintainDomains: [] })).toBe(
      '3 commitments today.',
    );
  });

  it('names a paused domain and a maintenance domain', () => {
    expect(
      stateLineFor({
        commitmentCount: 2,
        pausedDomains: ['HEALTH'],
        maintainDomains: ['FAMILY'],
      }),
    ).toBe('2 commitments today. Health is paused. Family is in maintenance mode this week.');
  });

  it('joins two domains with "and"', () => {
    expect(
      stateLineFor({
        commitmentCount: 1,
        pausedDomains: ['WORK', 'HEALTH'],
        maintainDomains: [],
      }),
    ).toContain('Work and Health are paused.');
  });
});
