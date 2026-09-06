import { Test, TestingModule } from '@nestjs/testing';
import type { Commitment } from '@prisma/client';

import { CandidateLoaderService, type TodayCandidates } from './nba/candidate-loader.service';
import { MomentumService } from '../progress/momentum/momentum.service';
import { UserProfileService } from '../user-profile/user-profile.service';
import { AvoidanceService } from '../work/avoidance/avoidance.service';
import { versionsOf } from '../commitments/commitment-card.mapper';
import { TodayService } from './today.service';
import { todayResponseSchema } from './today.schema';
import type { Domain, DomainModeValue } from './nba/nba-scorer';

const NOW = new Date('2026-03-02T09:00:00.000Z');

function row(over: Partial<Commitment> = {}): Commitment {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    domain: 'WORK',
    title: 'Draft the proposal storyline',
    outcomeId: null,
    planVersionId: null,
    routineId: null,
    scheduledStart: NOW,
    scheduledEnd: null,
    importance: 5,
    commitmentType: null,
    fullVersion: null,
    shortVersion: null,
    minimumVersion: null,
    fullMinutes: 25,
    shortMinutes: null,
    minimumMinutes: null,
    status: 'PLANNED',
    rescheduleCount: 0,
    rescheduledFromId: null,
    skipReason: null,
    skipNote: null,
    userConfirmed: false,
    startedAt: null,
    completedAt: null,
    activeSince: null,
    activeSeconds: 0,
    timerMinutes: null,
    versionUsed: null,
    minutesSpent: null,
    steps: null,
    decomposedFromId: null,
    workoutTemplateId: null,
    ritualId: null,
    familyMemberId: null,
    workMilestoneId: null,
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    ...over,
  } as Commitment;
}

function loaded(over: Partial<TodayCandidates> = {}): TodayCandidates {
  const rows = over.rows ?? [row()];
  const domainModes: Record<Domain, DomainModeValue> = over.domainModes ?? {
    WORK: 'GROW',
    FAMILY: 'GROW',
    HEALTH: 'GROW',
  };

  return {
    dateLocal: '2026-03-02',
    timeZone: 'UTC',
    dayStart: new Date('2026-03-02T00:00:00.000Z'),
    dayEnd: new Date('2026-03-03T00:00:00.000Z'),
    context: {
      now: NOW,
      checkIn: null,
      domainModes,
      completedTodayByDomain: { WORK: 0, FAMILY: 0, HEALTH: 0 },
      availableMinutesRemaining: 600,
      startedCommitmentId: null,
      ...over.context,
    },
    candidates: rows
      .filter((r) => domainModes[r.domain as Domain] !== 'PAUSE')
      .filter((r) => ['PLANNED', 'READY', 'STARTED'].includes(r.status))
      .map((r) => ({
        id: r.id,
        domain: r.domain as Domain,
        importance: r.importance,
        scheduledStart: r.scheduledStart,
        scheduledEnd: r.scheduledEnd,
        status: r.status as 'PLANNED' | 'READY' | 'STARTED',
        rescheduleCount: r.rescheduleCount,
        planId: null,
        planIsActive: false,
        outcomeTargetDate: null,
        versions: versionsOf(r),
        createdAt: r.createdAt,
      })),
    rows,
    domainModes,
    outcomeById: new Map(),
    daysSinceLastEvidence: null,
    hasAnyEvidence: false,
    completionsLast7Days: 0,
    missesLast7Days: 0,
    routineFailuresLast14Days: new Map(),
    ...over,
  } as TodayCandidates;
}

describe('TodayService (#38)', () => {
  let service: TodayService;
  let loader: { load: jest.Mock };
  let momentum: { summary: jest.Mock };
  let profiles: { find: jest.Mock };
  let avoidance: { assessMany: jest.Mock };

  beforeEach(async () => {
    loader = { load: jest.fn() };
    momentum = {
      summary: jest.fn().mockResolvedValue({
        WORK: { state: 'STEADY', headline: '5 of 6 planned work actions completed' },
        FAMILY: { state: 'INSUFFICIENT_DATA', headline: null },
        HEALTH: { state: 'BUILDING', headline: '2 of 3 planned workouts completed' },
      }),
    };

    profiles = { find: jest.fn().mockResolvedValue(null) };
    // No ladder reading by default: every existing case in this file predates
    // E07-03 and asserts the behaviour of a commitment nobody is avoiding.
    avoidance = { assessMany: jest.fn().mockResolvedValue(new Map()) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TodayService,
        { provide: CandidateLoaderService, useValue: loader },
        { provide: MomentumService, useValue: momentum },
        { provide: UserProfileService, useValue: profiles },
        { provide: AvoidanceService, useValue: avoidance },
      ],
    }).compile();

    service = module.get(TodayService);
  });

  describe('momentum (#98)', () => {
    it('carries all three domains, so the day screen never has to ask twice', async () => {
      loader.load.mockResolvedValue(loaded());

      const result = await service.getToday('u1', NOW);

      expect(Object.keys(result.momentum).sort()).toEqual(['FAMILY', 'HEALTH', 'WORK']);
      expect(result.momentum.HEALTH.state).toBe('BUILDING');
    });

    it('still returns the day when momentum throws — Progress is secondary here', async () => {
      loader.load.mockResolvedValue(loaded());
      momentum.summary.mockRejectedValue(new Error('window load failed'));

      const result = await service.getToday('u1', NOW);

      expect(todayResponseSchema.safeParse(result).success).toBe(true);
      expect(result.momentum.WORK).toEqual({ state: 'INSUFFICIENT_DATA', headline: null });
      expect(result.nextBestAction).not.toBeNull();
    });
  });

  it('returns a body that satisfies the published schema', async () => {
    loader.load.mockResolvedValue(loaded());

    const result = await service.getToday('u1', NOW);

    expect(todayResponseSchema.safeParse(result).success).toBe(true);
  });

  it('is reproducible: two calls with the same data recommend the same thing', async () => {
    loader.load.mockResolvedValue(loaded({ rows: [row(), row({ id: 'b', importance: 5 })] }));

    const first = await service.getToday('u1', NOW);
    const second = await service.getToday('u1', NOW);

    expect(first.nextBestAction).toEqual(second.nextBestAction);
  });

  describe('empty day', () => {
    it('has no next best action, and says so plainly', async () => {
      loader.load.mockResolvedValue(loaded({ rows: [], candidates: [] }));

      const result = await service.getToday('u1', NOW);

      expect(result.nextBestAction).toBeNull();
      expect(result.stateLine).toBe('Nothing scheduled today.');
      expect(result.domains).toHaveLength(3);
    });
  });

  describe('domains', () => {
    it('always returns three, in canonical order, including the empty ones', async () => {
      loader.load.mockResolvedValue(loaded());

      const result = await service.getToday('u1', NOW);

      expect(result.domains.map((d) => d.domain)).toEqual(['WORK', 'FAMILY', 'HEALTH']);
      expect(result.domains[1].commitments).toEqual([]);
    });

    // A domain that vanishes because the user paused it looks like data loss.
    it('keeps a PAUSED domain as a card while excluding it from the recommendation', async () => {
      loader.load.mockResolvedValue(
        loaded({
          rows: [row({ id: 'h', domain: 'HEALTH', importance: 5 })],
          domainModes: { WORK: 'GROW', FAMILY: 'GROW', HEALTH: 'PAUSE' },
        }),
      );

      const result = await service.getToday('u1', NOW);

      const health = result.domains.find((d) => d.domain === 'HEALTH')!;
      expect(health.mode).toBe('PAUSE');
      expect(health.commitments).toHaveLength(1);
      expect(result.nextBestAction).toBeNull();
    });

    it('reports GROW for a domain with no stored mode', async () => {
      loader.load.mockResolvedValue(loaded());

      const result = await service.getToday('u1', NOW);

      expect(result.domains.every((d) => d.mode === 'GROW')).toBe(true);
    });
  });

  describe('the started pre-rule', () => {
    // Ranking a started commitment against the rest would let the engine tell a
    // user to abandon what they are doing.
    it('makes a STARTED commitment the next best action, in ACT mode', async () => {
      const started = row({
        id: 'started-id',
        status: 'STARTED',
        startedAt: NOW,
        activeSince: NOW,
        timerMinutes: 25,
      });

      loader.load.mockResolvedValue(
        loaded({
          rows: [started, row({ id: 'other', importance: 5, domain: 'FAMILY' })],
          context: {
            now: NOW,
            checkIn: null,
            domainModes: { WORK: 'GROW', FAMILY: 'GROW', HEALTH: 'GROW' },
            completedTodayByDomain: { WORK: 0, FAMILY: 0, HEALTH: 0 },
            availableMinutesRemaining: 600,
            startedCommitmentId: 'started-id',
          },
        }),
      );

      const result = await service.getToday('u1', NOW);

      expect(result.nextBestAction?.commitmentId).toBe('started-id');
      expect(result.nextBestAction?.interventionMode).toBe('ACT');
      expect(result.nextBestAction?.rationale).toBe('You already started this — continue.');
      // Confidence is still defined from the full ranking.
      expect(result.nextBestAction?.confidence).toBeGreaterThan(0);
    });

    it('counts down the remaining minutes of the running timer', async () => {
      const started = row({
        id: 'started-id',
        status: 'STARTED',
        startedAt: new Date('2026-03-02T08:50:00.000Z'),
        activeSince: new Date('2026-03-02T08:50:00.000Z'),
        timerMinutes: 25,
      });

      loader.load.mockResolvedValue(
        loaded({
          rows: [started],
          context: {
            now: NOW,
            checkIn: null,
            domainModes: { WORK: 'GROW', FAMILY: 'GROW', HEALTH: 'GROW' },
            completedTodayByDomain: { WORK: 0, FAMILY: 0, HEALTH: 0 },
            availableMinutesRemaining: 600,
            startedCommitmentId: 'started-id',
          },
        }),
      );

      const result = await service.getToday('u1', NOW);

      expect(result.nextBestAction?.durationMinutes).toBe(15);
    });
  });

  describe('check-in', () => {
    it('echoes the stated feeling and sizes the action to the minimum on low energy', async () => {
      loader.load.mockResolvedValue(
        loaded({
          rows: [
            row({
              minimumVersion: 'Open the doc and write one sentence',
              minimumMinutes: 5,
              shortVersion: 'Write the decision statement',
              shortMinutes: 10,
            }),
          ],
          context: {
            now: NOW,
            checkIn: 'LOW_ENERGY',
            domainModes: { WORK: 'GROW', FAMILY: 'GROW', HEALTH: 'GROW' },
            completedTodayByDomain: { WORK: 0, FAMILY: 0, HEALTH: 0 },
            availableMinutesRemaining: 600,
            startedCommitmentId: null,
          },
        }),
      );

      const result = await service.getToday('u1', NOW);

      expect(result.checkIn).toEqual({ feel: 'LOW_ENERGY' });
      expect(result.nextBestAction?.version).toBe('minimum');
      expect(result.nextBestAction?.durationMinutes).toBe(5);
      expect(result.nextBestAction?.interventionMode).toBe('RECONNECT');
    });

    it('is null when the user has not checked in', async () => {
      loader.load.mockResolvedValue(loaded());

      expect((await service.getToday('u1', NOW)).checkIn).toBeNull();
    });
  });

  describe('comeback (#112)', () => {
    it('is null for a user with no open loop — Today shows no backlog', async () => {
      loader.load.mockResolvedValue(loaded());

      expect((await service.getToday('u1', NOW)).comeback).toBeNull();
    });

    it('is a pointer while a loop is open, never a list of what was missed', async () => {
      loader.load.mockResolvedValue(loaded());
      profiles.find.mockResolvedValue({
        comebackState: 'OFFERED',
        comebackCommitmentId: '33333333-3333-4333-8333-333333333333',
        comebackOfferedAt: new Date('2026-03-02T04:00:00.000Z'),
      });

      const result = await service.getToday('u1', NOW);

      expect(todayResponseSchema.safeParse(result).success).toBe(true);
      expect(result.comeback).toEqual({
        state: 'OFFERED',
        restartCommitmentId: '33333333-3333-4333-8333-333333333333',
        offeredAt: '2026-03-02T04:00:00.000Z',
      });
      expect(Object.keys(result.comeback!)).toHaveLength(3);
    });
  });

  describe('the intervention ladder (#116)', () => {
    const assessment = {
      level: 3,
      interventionType: 'FRICTION_DIAGNOSIS',
      signals: ['RESCHEDULED_TWICE'],
      rationale: 'This has been moved 2 times. Worth asking what is making it hard to start.',
      suggestedAction: 'FRICTION_QUESTION',
    };

    it('carries the assessment on a WORK card and null on the others', async () => {
      const work = row({ id: '33333333-3333-4333-8333-333333333333', rescheduleCount: 2 });
      const family = row({ id: '44444444-4444-4444-8444-444444444444', domain: 'FAMILY' });

      loader.load.mockResolvedValue(loaded({ rows: [work, family] }));
      avoidance.assessMany.mockResolvedValue(new Map([[work.id, assessment]]));

      const result = await service.getToday('u1', NOW);

      const workCard = result.domains.find((d) => d.domain === 'WORK')?.commitments[0];
      const familyCard = result.domains.find((d) => d.domain === 'FAMILY')?.commitments[0];

      expect(workCard?.avoidance).toEqual(assessment);
      expect(familyCard?.avoidance).toBeNull();
    });

    it('drives the next best action into DIAGNOSE and quotes the rationale', async () => {
      const work = row({ rescheduleCount: 2 });

      loader.load.mockResolvedValue(loaded({ rows: [work] }));
      avoidance.assessMany.mockResolvedValue(new Map([[work.id, assessment]]));

      const result = await service.getToday('u1', NOW);

      expect(result.nextBestAction?.interventionMode).toBe('DIAGNOSE');
      expect(result.nextBestAction?.rationale).toContain('moved 2 times');
    });

    it('still returns the day when the assessment throws', async () => {
      loader.load.mockResolvedValue(loaded());
      avoidance.assessMany.mockRejectedValue(new Error('database on fire'));

      const result = await service.getToday('u1', NOW);

      expect(result.domains[0].commitments[0].avoidance).toBeNull();
      expect(todayResponseSchema.safeParse(result).success).toBe(true);
    });
  });

  describe('the fields later epics own', () => {
    it('leaves coachInsight null — the sentence is a separate request', async () => {
      loader.load.mockResolvedValue(loaded());

      const result = await service.getToday('u1', NOW);

      expect(result.coachInsight).toBeNull();
    });
  });

  describe('greeting and state line', () => {
    it('follows the user’s own timezone', async () => {
      loader.load.mockResolvedValue(loaded({ timeZone: 'America/Costa_Rica' }));

      // 09:00 UTC is 03:00 in Costa Rica.
      expect((await service.getToday('u1', NOW)).greeting).toBe('evening');
    });

    it('names a domain in maintenance mode', async () => {
      loader.load.mockResolvedValue(
        loaded({ domainModes: { WORK: 'GROW', FAMILY: 'GROW', HEALTH: 'MAINTAIN' } }),
      );

      const result = await service.getToday('u1', NOW);

      expect(result.stateLine).toBe('1 commitment today. Health is in maintenance mode this week.');
    });
  });
});
