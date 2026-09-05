import {
  COACHING_EVENT_KEYS,
  COPY_ACTION_LABEL_MAX,
  COPY_BODY_MAX,
  COPY_TITLE_MAX,
  coachingCopySchema,
} from '../coaching-events';
import { BANNED_PHRASES, findBannedPhrases } from './banned-phrases';
import { DEFAULT_COPY, defaultCopyFor, ordinal, truncate } from './copy-templates';

const N = '22222222-2222-4222-8222-222222222222';
const C = '11111111-1111-4111-8111-111111111111';

/** A realistic worst case: the longest title a user might plausibly type. */
const LONG_TITLE =
  'Deep work block on the Q4 data platform migration storyline and stakeholder map';

const PAYLOADS: Record<string, Record<string, unknown>> = {
  'coach.commitment_upcoming': {
    commitmentId: C,
    domain: 'HEALTH',
    commitmentTitle: 'Upper A',
    scheduledStart: '2026-09-08T15:00:00.000Z',
    minutesUntil: 20,
    startMinutes: 38,
  },
  'coach.start_cue': {
    commitmentId: C,
    domain: 'WORK',
    commitmentTitle: 'Draft the storyline',
    startMinutes: 25,
  },
  'coach.rescue': {
    commitmentId: C,
    domain: 'WORK',
    commitmentTitle: 'Draft the storyline',
    rescheduleCount: 3,
    level: 4,
    minimumMinutes: 10,
  },
  'coach.fallback_offer': {
    commitmentId: C,
    domain: 'HEALTH',
    commitmentTitle: 'Upper A',
    fullMinutes: 38,
    shortMinutes: 20,
    remainingMinutes: 25,
  },
  'coach.family_presence': {
    commitmentId: C,
    commitmentTitle: 'Phone-free dinner',
    minutesUntil: 15,
  },
  'coach.recovery': { comebackId: C, daysAway: 4 },
  'coach.evidence': {
    commitmentId: C,
    domain: 'HEALTH',
    outcomeTitle: 'Train consistently',
    count: 3,
    windowDays: 8,
    milestone: 'THIRD_IN_8_DAYS',
  },
  'coach.weekly_review_ready': { reviewId: C, weekStart: '2026-08-31' },
  'coach.plan_issue': {
    proposalId: C,
    planId: C,
    summary: 'Three sessions a week is not landing on Tuesdays or Thursdays this month',
    sourceKind: 'PATTERN',
  },
};

/** The same payload with every free-text field pushed to a realistic maximum. */
const LONG_PAYLOADS: Record<string, Record<string, unknown>> = Object.fromEntries(
  Object.entries(PAYLOADS).map(([key, payload]) => [
    key,
    {
      ...payload,
      ...(payload.commitmentTitle ? { commitmentTitle: LONG_TITLE } : {}),
      ...(payload.outcomeTitle ? { outcomeTitle: LONG_TITLE } : {}),
      ...(payload.summary ? { summary: LONG_TITLE } : {}),
      purpose: LONG_TITLE,
      firstStep: LONG_TITLE,
    },
  ]),
);

const withN = (payload: Record<string, unknown>) => ({ ...payload, sentInteractionId: N });

describe('default coaching copy (#54)', () => {
  it('has one template per registered category', () => {
    expect(Object.keys(DEFAULT_COPY).sort()).toEqual([...COACHING_EVENT_KEYS].sort());
  });

  it.each(COACHING_EVENT_KEYS)('%s produces copy within the caps', (key) => {
    const copy = defaultCopyFor(key, withN(PAYLOADS[key]));

    expect(copy.title.length).toBeLessThanOrEqual(COPY_TITLE_MAX);
    expect(copy.body.length).toBeLessThanOrEqual(COPY_BODY_MAX);
    expect(copy.actionLabel.length).toBeLessThanOrEqual(COPY_ACTION_LABEL_MAX);
    expect(coachingCopySchema.safeParse(copy).success).toBe(true);
  });

  // The realistic failure: not a template that is too long, but one whose
  // interpolated title is. A truncated sentence is still readable; an elided
  // one that the OS cuts mid-word is not.
  it.each(COACHING_EVENT_KEYS)('%s stays within the caps for a very long title', (key) => {
    const copy = defaultCopyFor(key, withN(LONG_PAYLOADS[key]));

    expect(copy.title.length).toBeLessThanOrEqual(COPY_TITLE_MAX);
    expect(copy.body.length).toBeLessThanOrEqual(COPY_BODY_MAX);
  });

  // PRD §129 / VISION §12. This is the test that matters most in this file: the
  // deterministic copy ships on EVERY provider outage, so a shaming template
  // would reach users silently and forever.
  it.each(COACHING_EVENT_KEYS)('%s uses none of the banned vocabulary', (key) => {
    for (const payload of [PAYLOADS[key], LONG_PAYLOADS[key]]) {
      const copy = defaultCopyFor(key, withN(payload));

      expect(findBannedPhrases(copy.title)).toEqual([]);
      expect(findBannedPhrases(copy.body)).toEqual([]);
      expect(findBannedPhrases(copy.actionLabel)).toEqual([]);
    }
  });

  it('is honest about what it interpolates', () => {
    for (const key of COACHING_EVENT_KEYS) {
      const copy = defaultCopyFor(key, withN(PAYLOADS[key]));

      expect(`${copy.title} ${copy.body}`).not.toContain('undefined');
      expect(`${copy.title} ${copy.body}`).not.toContain('NaN');
      expect(`${copy.title} ${copy.body}`).not.toContain('[object Object]');
    }
  });

  describe('the individual templates', () => {
    it('N1 states the wait and the size', () => {
      const copy = defaultCopyFor('coach.commitment_upcoming', withN(PAYLOADS['coach.commitment_upcoming']));

      expect(copy.title).toBe('Upper A starts in 20 minutes');
      expect(copy.body).toContain('38 min');
      expect(copy.actionLabel).toBe('Start workout');
    });

    // The barrier at the moment of starting is "what do I do first", not "how
    // long", so the step wins over the duration whenever there is one.
    it('N2 prefers the first step over the duration', () => {
      const withStep = defaultCopyFor(
        'coach.start_cue',
        withN({ ...PAYLOADS['coach.start_cue'], firstStep: 'Open the doc' }),
      );
      const without = defaultCopyFor('coach.start_cue', withN(PAYLOADS['coach.start_cue']));

      expect(withStep.body).toBe('First step: Open the doc');
      expect(without.body).toBe('25 minutes. Tap to begin.');
    });

    // "This has moved 3 times" and "you have moved this 3 times" are the same
    // number and a different message.
    it('N3 states the count as a fact about the commitment, not the person', () => {
      const copy = defaultCopyFor('coach.rescue', withN(PAYLOADS['coach.rescue']));

      expect(copy.title).toBe('This has moved 3 times');
      expect(copy.title.toLowerCase()).not.toContain('you');
      expect(copy.body).toContain('10 minutes');
    });

    it('N4 names both sizes so the trade is visible', () => {
      const copy = defaultCopyFor('coach.fallback_offer', withN(PAYLOADS['coach.fallback_offer']));

      expect(copy.title).toContain('38');
      expect(copy.body).toContain('20-minute');
    });

    it('N5 quotes the user’s own reason back when there is one', () => {
      const copy = defaultCopyFor(
        'coach.family_presence',
        withN({ ...PAYLOADS['coach.family_presence'], purpose: 'Mia talks at dinner' }),
      );

      expect(copy.body).toBe('You said this matters: Mia talks at dinner');
    });

    // PRD §108: comeback copy without shame. The payload knows how many days
    // were missed; the copy deliberately does not say.
    it('N6 never counts the days away', () => {
      const copy = defaultCopyFor(
        'coach.recovery',
        withN({ ...PAYLOADS['coach.recovery'], daysAway: 11 }),
      );

      expect(copy.title).toBe('No catching up');
      expect(`${copy.title} ${copy.body}`).not.toContain('11');
      expect(`${copy.title} ${copy.body}`).not.toMatch(/\d/);
    });

    it('N7 counts the sessions, ordinally', () => {
      const copy = defaultCopyFor('coach.evidence', withN(PAYLOADS['coach.evidence']));

      expect(copy.title).toBe('3rd Train consistently session in 8 days');
    });

    it('N9 leads with the proposal’s own summary', () => {
      const copy = defaultCopyFor('coach.plan_issue', withN(PAYLOADS['coach.plan_issue']));

      expect(copy.title.startsWith('Three sessions a week is not landing')).toBe(true);
    });
  });
});

describe('banned phrases (#54)', () => {
  it('finds a phrase regardless of case', () => {
    expect(findBannedPhrases('You PROMISED me')).toEqual(['promised']);
  });

  it('reports every phrase it finds, so a log can name them', () => {
    expect(findBannedPhrases('shame and guilt')).toEqual(['shame', 'guilt']);
  });

  it('leaves clean copy alone', () => {
    expect(findBannedPhrases('One useful action today is enough to restart.')).toEqual([]);
  });

  it('covers the PRD §129 vocabulary', () => {
    for (const phrase of ['disappoint', 'promised', 'let down', 'last chance', 'shame', 'guilt', 'miss you']) {
      expect(BANNED_PHRASES).toContain(phrase);
    }
  });
});

describe('helpers', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [102, '102nd'],
    [111, '111th'],
  ])('ordinal(%i) is %s', (value, expected) => {
    expect(ordinal(value)).toBe(expected);
  });

  it('truncate leaves short strings alone', () => {
    expect(truncate('short', 10)).toBe('short');
  });

  it('truncate marks what it cut', () => {
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
    expect(truncate('abcdefghij', 5)).toHaveLength(5);
  });
});
