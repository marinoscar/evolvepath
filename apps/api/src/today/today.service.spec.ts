import { Test, TestingModule } from '@nestjs/testing';
import type { Commitment } from '@prisma/client';

import { CandidateLoaderService, type TodayCandidates } from './nba/candidate-loader.service';
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
    ritualId: null,
    familyMemberId: null,
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

  beforeEach(async () => {
    loader = { load: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TodayService, { provide: CandidateLoaderService, useValue: loader }],
    }).compile();

    service = module.get(TodayService);
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

  describe('the fields later epics own', () => {
    it('leaves momentum and coachInsight null', async () => {
      loader.load.mockResolvedValue(loaded());

      const result = await service.getToday('u1', NOW);

      expect(result.momentum).toBeNull();
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
