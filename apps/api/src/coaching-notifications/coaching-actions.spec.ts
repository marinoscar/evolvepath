import {
  actionsFor,
  actionsForStoredRow,
  parseCoachingLink,
  primaryLink,
  startLabel,
  startLink,
  todayLink,
} from './coaching-actions';

const C = '11111111-1111-4111-8111-111111111111';
const N = '22222222-2222-4222-8222-222222222222';

const labels = (key: string, payload: unknown) =>
  actionsFor(key, payload).map((a) => `${a.action}:${a.label}`);

describe('coaching actions (#54)', () => {
  describe('todayLink', () => {
    it('is the deep-link contract E05-04 already honours', () => {
      expect(todayLink(C, 'start', N)).toBe(
        `/today?commitment=${C}&action=start&n=${N}`,
      );
    });

    it('percent-encodes anything that would break out of the query', () => {
      expect(todayLink('a b&x=1', 'skip', N)).toContain('commitment=a+b%26x%3D1');
    });

    it('is root-relative, so sanitizeLink has nothing to reject', () => {
      expect(todayLink(C, 'move', N).startsWith('/')).toBe(true);
      expect(todayLink(C, 'move', N).startsWith('//')).toBe(false);
    });
  });

  describe('startLink', () => {
    it('points at E05-05’s execution screen, carrying the attribution', () => {
      expect(startLink(C, N)).toBe(`/start/${C}?n=${N}`);
    });
  });

  describe('startLabel', () => {
    it('names the activity for HEALTH rather than the clock', () => {
      expect(startLabel('HEALTH', 38)).toBe('Start workout');
    });

    it('names the minutes elsewhere', () => {
      expect(startLabel('WORK', 25)).toBe('Start 25 min');
    });

    // A stored inbox row genuinely does not know its domain — the table holds
    // rendered text and no payload — so this is the honest answer, not a bug.
    it('falls back to a bare Start when the domain is unknown', () => {
      expect(startLabel(null, null)).toBe('Start');
    });
  });

  describe('actionsFor', () => {
    it('N1 offers start, move, skip', () => {
      expect(
        labels('coach.commitment_upcoming', {
          sentInteractionId: N,
          commitmentId: C,
          domain: 'HEALTH',
          startMinutes: 38,
        }),
      ).toEqual(['start:Start workout', 'move:Move', 'skip:Skip today']);
    });

    it('N2 links straight at the timer, with no hop through Today', () => {
      const actions = actionsFor('coach.start_cue', {
        sentInteractionId: N,
        commitmentId: C,
        domain: 'WORK',
        startMinutes: 25,
      });

      expect(actions[0]).toEqual({
        action: 'start',
        label: 'Start 25 min',
        link: `/start/${C}?n=${N}`,
      });
      expect(actions.map((a) => a.action)).toEqual(['start', 'short', 'move']);
    });

    // The whole point of a rescue is a number small enough to argue with, so it
    // always states the minutes even in HEALTH, where N1 would say "workout".
    it('N3 always names the minimum minutes', () => {
      expect(
        labels('coach.rescue', {
          sentInteractionId: N,
          commitmentId: C,
          domain: 'HEALTH',
          minimumMinutes: 10,
        }),
      ).toEqual(['start:Start 10 min', 'skip:Skip today']);
    });

    it('N4 puts the short version first, because that is the offer', () => {
      const actions = actionsFor('coach.fallback_offer', {
        sentInteractionId: N,
        commitmentId: C,
        domain: 'HEALTH',
        fullMinutes: 38,
        shortMinutes: 20,
      });

      expect(actions.map((a) => a.action)).toEqual(['short', 'start', 'skip']);
      expect(actions[0].link).toBe(`/today?commitment=${C}&action=short&n=${N}`);
    });

    it('N5 uses the family vocabulary, verbatim from PRD §63', () => {
      expect(
        labels('coach.family_presence', {
          sentInteractionId: N,
          commitmentId: C,
          commitmentTitle: 'Phone-free dinner',
          minutesUntil: 15,
        }),
      ).toEqual(["in:I'm in", 'move:Move it', 'skip:Skip today']);
    });

    it.each(['coach.recovery', 'coach.evidence', 'coach.weekly_review_ready', 'coach.plan_issue'])(
      '%s offers no buttons — none of them asks for a decision made unseen',
      (key) => {
        expect(actionsFor(key, { sentInteractionId: N, proposalId: C })).toEqual([]);
      },
    );

    it('returns nothing for a non-coaching event', () => {
      expect(actionsFor('user.welcome', { sentInteractionId: N })).toEqual([]);
      expect(actionsFor('security.role_changed', { sentInteractionId: N })).toEqual([]);
    });

    // Called from three places with three different ideas of how complete a
    // payload is; a throw would fail a whole delivery over a missing button.
    it('never throws on a payload it cannot read', () => {
      expect(actionsFor('coach.commitment_upcoming', null)).toEqual([]);
      expect(actionsFor('coach.commitment_upcoming', {})).toEqual([]);
      expect(actionsFor('coach.commitment_upcoming', { sentInteractionId: N })).toEqual([]);
    });
  });

  describe('primaryLink', () => {
    it('is the first button when there is one', () => {
      expect(
        primaryLink('coach.family_presence', {
          sentInteractionId: N,
          commitmentId: C,
        }),
      ).toBe(`/today?commitment=${C}&action=in&n=${N}`);
    });

    it.each([
      ['coach.recovery', {}, `/comeback?n=${N}`],
      ['coach.evidence', {}, `/progress?n=${N}`],
      ['coach.weekly_review_ready', {}, `/progress/week?n=${N}`],
      ['coach.plan_issue', { proposalId: C }, `/coach?proposal=${C}&n=${N}`],
    ])('%s taps through to %s', (key, extra, expected) => {
      expect(primaryLink(key, { sentInteractionId: N, ...(extra as object) })).toBe(
        expected,
      );
    });

    it('is undefined for a non-coaching event', () => {
      expect(primaryLink('user.welcome', { sentInteractionId: N })).toBeUndefined();
    });
  });

  describe('parseCoachingLink', () => {
    it('round-trips every link actionsFor emits', () => {
      const payloads: [string, Record<string, unknown>][] = [
        ['coach.commitment_upcoming', { domain: 'HEALTH', startMinutes: 38 }],
        ['coach.start_cue', { domain: 'WORK', startMinutes: 25 }],
        ['coach.rescue', { domain: 'WORK', minimumMinutes: 10 }],
        ['coach.fallback_offer', { domain: 'HEALTH', fullMinutes: 38, shortMinutes: 20 }],
        ['coach.family_presence', {}],
      ];

      for (const [key, extra] of payloads) {
        for (const action of actionsFor(key, {
          sentInteractionId: N,
          commitmentId: C,
          ...extra,
        })) {
          expect(parseCoachingLink(action.link)).toEqual({
            commitmentId: C,
            sentInteractionId: N,
          });
        }
      }
    });

    it('reads the commitment out of a /start path', () => {
      expect(parseCoachingLink(`/start/${C}?n=${N}`).commitmentId).toBe(C);
    });

    it('refuses anything that is not root-relative', () => {
      expect(parseCoachingLink('https://evil.test/today?commitment=x')).toEqual({
        commitmentId: null,
        sentInteractionId: null,
      });
      expect(parseCoachingLink('//evil.test/today')).toEqual({
        commitmentId: null,
        sentInteractionId: null,
      });
    });

    it('tolerates a null link', () => {
      expect(parseCoachingLink(null)).toEqual({
        commitmentId: null,
        sentInteractionId: null,
      });
    });
  });

  describe('actionsForStoredRow', () => {
    it('rebuilds the buttons from a stored link alone', () => {
      const stored = actionsForStoredRow(
        'coach.family_presence',
        `/today?commitment=${C}&action=in&n=${N}`,
      );

      expect(stored.map((a) => a.action)).toEqual(['in', 'move', 'skip']);
      expect(stored[0].link).toBe(`/today?commitment=${C}&action=in&n=${N}`);
    });

    // The documented, deliberate degradation: the row has no domain to read.
    it('degrades a start label to the generic form', () => {
      const live = actionsFor('coach.commitment_upcoming', {
        sentInteractionId: N,
        commitmentId: C,
        domain: 'HEALTH',
        startMinutes: 38,
      });
      const stored = actionsForStoredRow(
        'coach.commitment_upcoming',
        `/today?commitment=${C}&action=start&n=${N}`,
      );

      expect(live[0].label).toBe('Start workout');
      expect(stored[0].label).toBe('Start');
      expect(stored[0].link).toBe(live[0].link);
    });

    it('returns nothing for a foundation event’s row', () => {
      expect(actionsForStoredRow('security.role_changed', '/settings')).toEqual([]);
    });

    it('returns nothing when the link carries no attribution', () => {
      expect(actionsForStoredRow('coach.family_presence', '/today')).toEqual([]);
    });
  });
});
