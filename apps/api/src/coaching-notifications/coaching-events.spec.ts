import {
  NOTIFICATION_EVENTS,
  findEvent,
} from '../notifications/notification-events';
import {
  COACHING_CATEGORY,
  COACHING_EVENT_KEYS,
  COACHING_PAYLOAD_SCHEMAS,
  COPY_TITLE_MAX,
  categoryFor,
  coachingCopySchema,
  isCoachingEvent,
} from './coaching-events';

const uuid = '11111111-1111-4111-8111-111111111111';

describe('coaching events (#54)', () => {
  // The whole point of the two-file split: this list DERIVES from the registry.
  // Asserting both directions is what stops it from quietly becoming a second
  // event list that the preferences page has never heard of.
  describe('agreement with the registry', () => {
    it('registers every key it declares', () => {
      for (const key of COACHING_EVENT_KEYS) {
        expect(findEvent(key)).toBeDefined();
      }
    });

    it('declares every coach.* key the registry holds', () => {
      const registered = NOTIFICATION_EVENTS.map((event) => event.key).filter((key) =>
        key.startsWith('coach.'),
      );

      expect(registered.sort()).toEqual([...COACHING_EVENT_KEYS].sort());
    });

    it('has one payload schema per key', () => {
      expect(Object.keys(COACHING_PAYLOAD_SCHEMAS).sort()).toEqual(
        [...COACHING_EVENT_KEYS].sort(),
      );
    });

    it('maps every key to a distinct PRD category', () => {
      const categories = Object.values(COACHING_CATEGORY);

      expect(new Set(categories).size).toBe(COACHING_EVENT_KEYS.length);
      expect(categories).toContain('N1');
      expect(categories).toContain('N9');
    });
  });

  describe('registry entries', () => {
    const coaching = () =>
      NOTIFICATION_EVENTS.filter((event) => event.key.startsWith('coach.'));

    it('has nine of them', () => {
      expect(coaching()).toHaveLength(9);
    });

    it('keeps the three foundation events first', () => {
      const firstCoachingIndex = NOTIFICATION_EVENTS.findIndex((event) =>
        event.key.startsWith('coach.'),
      );

      expect(firstCoachingIndex).toBe(3);
    });

    // PRD §59's first input is permission. A coaching message a user cannot
    // switch off is the one that gets the whole app muted at the OS level.
    it('makes none of them mandatory', () => {
      expect(coaching().every((event) => event.mandatory !== true)).toBe(true);
    });

    it('turns all of them on by default', () => {
      expect(coaching().every((event) => event.defaultEnabled)).toBe(true);
    });

    it('gives every one of them the browser channel', () => {
      expect(coaching().every((event) => event.channels.includes('browser'))).toBe(true);
    });

    // Only the weekly review survives being read an hour late.
    it('gives only the weekly review an email channel', () => {
      const withEmail = coaching()
        .filter((event) => event.channels.includes('email'))
        .map((event) => event.key);

      expect(withEmail).toEqual(['coach.weekly_review_ready']);
    });

    it('writes a user-facing description for each', () => {
      for (const event of coaching()) {
        expect(event.description.length).toBeGreaterThan(20);
        expect(event.description).toMatch(/\.$/);
      }
    });
  });

  describe('isCoachingEvent', () => {
    it('recognises the nine', () => {
      expect(isCoachingEvent('coach.rescue')).toBe(true);
    });

    it('rejects a foundation event', () => {
      expect(isCoachingEvent('security.role_changed')).toBe(false);
    });

    // A `coach.` prefix is not enough — the key has to be one this file knows.
    it('rejects an unregistered coach.* key', () => {
      expect(isCoachingEvent('coach.invented')).toBe(false);
      expect(categoryFor('coach.invented')).toBeNull();
    });
  });

  describe('payload schemas', () => {
    const minimal: Record<string, Record<string, unknown>> = {
      'coach.commitment_upcoming': {
        commitmentId: uuid,
        domain: 'HEALTH',
        commitmentTitle: 'Upper A',
        scheduledStart: '2026-09-08T15:00:00.000Z',
        minutesUntil: 20,
        startMinutes: 38,
      },
      'coach.start_cue': {
        commitmentId: uuid,
        domain: 'WORK',
        commitmentTitle: 'Draft the storyline',
        startMinutes: 25,
      },
      'coach.rescue': {
        commitmentId: uuid,
        domain: 'WORK',
        commitmentTitle: 'Draft the storyline',
        rescheduleCount: 3,
        level: 4,
        minimumMinutes: 10,
      },
      'coach.fallback_offer': {
        commitmentId: uuid,
        domain: 'HEALTH',
        commitmentTitle: 'Upper A',
        fullMinutes: 38,
        shortMinutes: 20,
        remainingMinutes: 25,
      },
      'coach.family_presence': {
        commitmentId: uuid,
        commitmentTitle: 'Phone-free dinner',
        minutesUntil: 15,
      },
      'coach.recovery': { comebackId: uuid, daysAway: 4 },
      'coach.evidence': {
        commitmentId: uuid,
        domain: 'HEALTH',
        outcomeTitle: 'Train consistently',
        count: 3,
        windowDays: 8,
        milestone: 'THIRD_IN_8_DAYS',
      },
      'coach.weekly_review_ready': { reviewId: uuid, weekStart: '2026-08-31' },
      'coach.plan_issue': {
        proposalId: uuid,
        planId: uuid,
        summary: 'Three sessions a week is not landing',
        sourceKind: 'PATTERN',
      },
    };

    it.each(COACHING_EVENT_KEYS)('%s accepts a minimal payload', (key) => {
      const result = COACHING_PAYLOAD_SCHEMAS[key].safeParse({
        ...minimal[key],
        sentInteractionId: uuid,
      });

      expect(result.success).toBe(true);
    });

    // Without it there is no way back from a click to the decision that caused
    // it, and PRD §64's "which messages are acted on" is unanswerable.
    it.each(COACHING_EVENT_KEYS)('%s rejects a missing sentInteractionId', (key) => {
      expect(COACHING_PAYLOAD_SCHEMAS[key].safeParse(minimal[key]).success).toBe(false);
    });

    it.each(COACHING_EVENT_KEYS)('%s rejects a non-uuid sentInteractionId', (key) => {
      const result = COACHING_PAYLOAD_SCHEMAS[key].safeParse({
        ...minimal[key],
        sentInteractionId: 'not-a-uuid',
      });

      expect(result.success).toBe(false);
    });

    it('accepts the optional AI copy overlay', () => {
      const result = COACHING_PAYLOAD_SCHEMAS['coach.rescue'].safeParse({
        ...minimal['coach.rescue'],
        sentInteractionId: uuid,
        copy: { title: 'Ten minutes', body: 'That is all.', actionLabel: 'Start 10 min' },
      });

      expect(result.success).toBe(true);
    });

    // The caps are about what an OS notification actually shows, not style.
    it('rejects copy longer than the title cap', () => {
      const result = coachingCopySchema.safeParse({
        title: 'x'.repeat(COPY_TITLE_MAX + 1),
        body: 'Body',
        actionLabel: 'Start',
      });

      expect(result.success).toBe(false);
    });

    it('keeps the family payload to a nickname and nothing more', () => {
      const schema = COACHING_PAYLOAD_SCHEMAS['coach.family_presence'];
      const parsed = schema.parse({
        ...minimal['coach.family_presence'],
        sentInteractionId: uuid,
        familyNickname: 'Mia',
        relationship: 'CHILD',
        birthday: '2018-05-09',
      });

      expect(parsed).not.toHaveProperty('relationship');
      expect(parsed).not.toHaveProperty('birthday');
    });
  });
});
