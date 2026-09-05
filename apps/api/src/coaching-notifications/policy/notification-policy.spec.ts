import type { NotificationSuppressReason } from '@prisma/client';

import { decide, type PolicyInput, type PolicyHistory } from './notification-policy';
import { NOTIFICATION_POLICY_DEFAULTS } from './notification-policy.schema';

const CR = 'America/Costa_Rica';
const COMMITMENT_ID = '11111111-1111-4111-8111-111111111111';

/** Noon in Costa Rica — outside every quiet window used below unless stated. */
const NOON = new Date('2026-09-08T18:00:00.000Z');

const history = (over: Partial<PolicyHistory> = {}): PolicyHistory => ({
  sentToday: 0,
  sentThisWeek: 0,
  sentForCommitment: 0,
  consecutiveIgnored: 0,
  lastActionedAt: null,
  ...over,
});

const input = (
  over: Partial<PolicyInput & { history: PolicyHistory }> = {},
): PolicyInput & { history: PolicyHistory } => ({
  now: NOON,
  candidate: {
    eventKey: 'coach.commitment_upcoming',
    category: 'N1',
    dueAt: new Date('2026-09-08T18:20:00.000Z'),
    commitment: {
      id: COMMITMENT_ID,
      domain: 'HEALTH',
      status: 'PLANNED',
      scheduledStart: new Date('2026-09-08T18:20:00.000Z'),
      skippedToday: false,
    },
  },
  policy: {
    ...NOTIFICATION_POLICY_DEFAULTS,
    mutedCategories: [],
    timezone: CR,
    quietHours: null,
  },
  enabledChannels: ['browser'],
  domainMode: 'GROW',
  history: history(),
  ...over,
});

const reasonOf = (
  over: Parameters<typeof input>[0] = {},
): NotificationSuppressReason | 'SENT' => {
  const decision = decide(input(over));
  return decision.send ? 'SENT' : decision.reason;
};

describe('decide (#59)', () => {
  it('sends when nothing is in the way', () => {
    const decision = decide(input());

    expect(decision.send).toBe(true);
    expect(decision.category).toBe('N1');
    expect(decision.scheduledFor).toEqual(new Date('2026-09-08T18:20:00.000Z'));
  });

  it('is a pure function of its inputs', () => {
    const args = input();

    expect(decide(args)).toEqual(decide(args));
  });

  // ---------------------------------------------------------------------------

  describe('MUTED — consent, which nothing below may override', () => {
    it('suppresses when there is nowhere to send it', () => {
      expect(reasonOf({ enabledChannels: [] })).toBe('MUTED');
    });

    it('suppresses a category the user muted', () => {
      expect(
        reasonOf({
          policy: {
            ...input().policy,
            mutedCategories: ['coach.commitment_upcoming'],
          },
        }),
      ).toBe('MUTED');
    });

    it('does not suppress a different muted category', () => {
      expect(
        reasonOf({
          policy: { ...input().policy, mutedCategories: ['coach.rescue'] },
        }),
      ).toBe('SENT');
    });

    // The order is what the metrics mean: "we suppressed 400 for quiet hours"
    // is only useful if those 400 would otherwise have been sent.
    it('outranks every other reason', () => {
      expect(
        reasonOf({
          enabledChannels: [],
          domainMode: 'PAUSE',
          policy: {
            ...input().policy,
            quietHours: { start: '00:00', end: '23:59' },
            dailyCap: 0,
          },
          history: history({ sentToday: 99, sentThisWeek: 99 }),
        }),
      ).toBe('MUTED');
    });
  });

  describe('DOMAIN_PAUSED', () => {
    it('suppresses a commitment in a paused domain', () => {
      expect(reasonOf({ domainMode: 'PAUSE' })).toBe('DOMAIN_PAUSED');
    });

    it.each(['GROW', 'MAINTAIN', 'RECOVER'] as const)('sends in %s', (mode) => {
      expect(reasonOf({ domainMode: mode })).toBe('SENT');
    });

    it('sends when the domain has no mode row at all', () => {
      expect(reasonOf({ domainMode: null })).toBe('SENT');
    });

    // Recovery IS the path out of a pause — suppressing it would mean a user
    // who paused everything can never be offered a way back.
    it('exempts the recovery message', () => {
      expect(
        reasonOf({
          domainMode: 'PAUSE',
          candidate: {
            eventKey: 'coach.recovery',
            category: 'N6',
            dueAt: NOON,
            commitment: input().candidate.commitment,
          },
        }),
      ).toBe('SENT');
    });

    it('exempts the weekly review, which has no domain to pause', () => {
      expect(
        reasonOf({
          domainMode: 'PAUSE',
          candidate: {
            eventKey: 'coach.weekly_review_ready',
            category: 'N8',
            dueAt: NOON,
            commitment: input().candidate.commitment,
          },
        }),
      ).toBe('SENT');
    });

    it('ignores the mode entirely for a candidate with no commitment', () => {
      expect(
        reasonOf({
          domainMode: 'PAUSE',
          candidate: {
            eventKey: 'coach.plan_issue',
            category: 'N9',
            dueAt: NOON,
          },
        }),
      ).toBe('SENT');
    });
  });

  describe('ALREADY_DONE', () => {
    it.each(['COMPLETED', 'PARTIALLY_COMPLETED', 'CANCELLED', 'MISSED'] as const)(
      'suppresses a %s commitment',
      (status) => {
        expect(
          reasonOf({
            candidate: {
              ...input().candidate,
              commitment: { ...input().candidate.commitment!, status },
            },
          }),
        ).toBe('ALREADY_DONE');
      },
    );

    it.each(['PLANNED', 'READY', 'STARTED', 'RESCHEDULED'] as const)(
      'sends for a %s commitment',
      (status) => {
        expect(
          reasonOf({
            candidate: {
              ...input().candidate,
              commitment: { ...input().candidate.commitment!, status },
            },
          }),
        ).toBe('SENT');
      },
    );
  });

  describe('SKIPPED — PRD §61: a skip is an answer, not a postponement', () => {
    it('suppresses a commitment skipped today', () => {
      expect(
        reasonOf({
          candidate: {
            ...input().candidate,
            commitment: {
              ...input().candidate.commitment!,
              status: 'SKIPPED',
              skippedToday: true,
            },
          },
        }),
      ).toBe('SKIPPED');
    });

    // A row skipped last Tuesday and rescheduled into today is a fresh
    // question; the flag, not the status, is what decides.
    it('sends for a row that was skipped on an earlier day', () => {
      expect(
        reasonOf({
          candidate: {
            ...input().candidate,
            commitment: {
              ...input().candidate.commitment!,
              status: 'RESCHEDULED',
              skippedToday: false,
            },
          },
        }),
      ).toBe('SENT');
    });
  });

  describe('PER_COMMITMENT_MAX', () => {
    it('suppresses once the commitment has had its share', () => {
      expect(reasonOf({ history: history({ sentForCommitment: 2 }) })).toBe(
        'PER_COMMITMENT_MAX',
      );
    });

    it('sends one below the limit', () => {
      expect(reasonOf({ history: history({ sentForCommitment: 1 }) })).toBe('SENT');
    });

    it('suppresses everything when the limit is zero', () => {
      expect(
        reasonOf({ policy: { ...input().policy, perCommitmentMax: 0 } }),
      ).toBe('PER_COMMITMENT_MAX');
    });

    it('does not apply to a candidate with no commitment', () => {
      expect(
        reasonOf({
          candidate: { eventKey: 'coach.recovery', category: 'N6', dueAt: NOON },
          history: history({ sentForCommitment: 99 }),
        }),
      ).toBe('SENT');
    });
  });

  describe('QUIET_HOURS', () => {
    const quiet = { start: '22:00', end: '07:00' };

    it('suppresses at 23:30 in the user’s own zone', () => {
      expect(
        reasonOf({
          now: new Date('2026-09-09T05:30:00.000Z'),
          policy: { ...input().policy, quietHours: quiet },
        }),
      ).toBe('QUIET_HOURS');
    });

    it('suppresses at 06:59, the last quiet minute', () => {
      expect(
        reasonOf({
          now: new Date('2026-09-09T12:59:00.000Z'),
          policy: { ...input().policy, quietHours: quiet },
        }),
      ).toBe('QUIET_HOURS');
    });

    it('sends at 07:00', () => {
      expect(
        reasonOf({
          now: new Date('2026-09-09T13:00:00.000Z'),
          policy: { ...input().policy, quietHours: quiet },
        }),
      ).toBe('SENT');
    });

    // The same instant, a different zone, a different answer.
    it('is evaluated per user, not per server', () => {
      const at = new Date('2026-09-09T05:30:00.000Z'); // 23:30 in CR, 14:30 in Tokyo

      expect(
        reasonOf({ now: at, policy: { ...input().policy, quietHours: quiet } }),
      ).toBe('QUIET_HOURS');
      expect(
        reasonOf({
          now: at,
          policy: { ...input().policy, timezone: 'Asia/Tokyo', quietHours: quiet },
        }),
      ).toBe('SENT');
    });

    it('never suppresses when no window is set', () => {
      expect(
        reasonOf({ now: new Date('2026-09-09T05:30:00.000Z') }),
      ).toBe('SENT');
    });
  });

  describe('WEEKLY_CAP', () => {
    it('suppresses at the weekly limit', () => {
      expect(reasonOf({ history: history({ sentThisWeek: 20 }) })).toBe('WEEKLY_CAP');
    });

    it('sends one below it', () => {
      expect(reasonOf({ history: history({ sentThisWeek: 19 }) })).toBe('SENT');
    });

    // A user who is over for the week is over regardless of what today looks
    // like, so the week is checked before the day.
    it('outranks the daily cap', () => {
      expect(
        reasonOf({ history: history({ sentThisWeek: 20, sentToday: 20 }) }),
      ).toBe('WEEKLY_CAP');
    });
  });

  describe('DAILY_CAP and FATIGUE', () => {
    it('suppresses at the configured daily cap', () => {
      expect(reasonOf({ history: history({ sentToday: 4 }) })).toBe('DAILY_CAP');
    });

    it('sends one below it', () => {
      expect(reasonOf({ history: history({ sentToday: 3 }) })).toBe('SENT');
    });

    it('treats a cap of zero as "never", not as fatigue', () => {
      expect(
        reasonOf({
          policy: { ...input().policy, dailyCap: 0 },
          history: history({ consecutiveIgnored: 9 }),
        }),
      ).toBe('DAILY_CAP');
    });

    // The distinction the metrics need: FATIGUE means "the user's own cap would
    // have allowed this; our reduction did not".
    it('reports FATIGUE when only the reduction stopped it', () => {
      const decision = decide(
        input({ history: history({ consecutiveIgnored: 5, sentToday: 2 }) }),
      );

      expect(decision.send).toBe(false);
      expect(decision.send === false && decision.reason).toBe('FATIGUE');
      expect(decision.effectiveDailyCap).toBe(2);
    });

    it('reports DAILY_CAP when the configured cap was reached anyway', () => {
      expect(
        reasonOf({ history: history({ consecutiveIgnored: 5, sentToday: 4 }) }),
      ).toBe('DAILY_CAP');
    });

    it('does not reduce below the threshold', () => {
      expect(
        reasonOf({ history: history({ consecutiveIgnored: 4, sentToday: 2 }) }),
      ).toBe('SENT');
    });

    // Recovery is one action, not a decay curve — `history()` counts only since
    // the last ACTIONED row.
    it('restores the full cap once the streak is broken', () => {
      const decision = decide(
        input({
          history: history({
            consecutiveIgnored: 0,
            sentToday: 2,
            lastActionedAt: new Date('2026-09-08T17:00:00.000Z'),
          }),
        }),
      );

      expect(decision.send).toBe(true);
      expect(decision.effectiveDailyCap).toBe(4);
    });
  });

  describe('every suppress reason is reachable', () => {
    // The point of this test is completeness, not the individual cases: a
    // reason nothing can produce is a rule nobody is enforcing.
    const REACHED: NotificationSuppressReason[] = [
      'MUTED',
      'DOMAIN_PAUSED',
      'ALREADY_DONE',
      'SKIPPED',
      'PER_COMMITMENT_MAX',
      'QUIET_HOURS',
      'WEEKLY_CAP',
      'DAILY_CAP',
      'FATIGUE',
    ];

    it('covers all nine', () => {
      const produced = new Set<string>([
        reasonOf({ enabledChannels: [] }),
        reasonOf({ domainMode: 'PAUSE' }),
        reasonOf({
          candidate: {
            ...input().candidate,
            commitment: { ...input().candidate.commitment!, status: 'COMPLETED' },
          },
        }),
        reasonOf({
          candidate: {
            ...input().candidate,
            commitment: { ...input().candidate.commitment!, skippedToday: true },
          },
        }),
        reasonOf({ history: history({ sentForCommitment: 2 }) }),
        reasonOf({
          now: new Date('2026-09-09T05:30:00.000Z'),
          policy: { ...input().policy, quietHours: { start: '22:00', end: '07:00' } },
        }),
        reasonOf({ history: history({ sentThisWeek: 20 }) }),
        reasonOf({ history: history({ sentToday: 4 }) }),
        reasonOf({ history: history({ consecutiveIgnored: 5, sentToday: 2 }) }),
      ]);

      expect([...produced].sort()).toEqual([...REACHED].sort());
    });
  });
});
