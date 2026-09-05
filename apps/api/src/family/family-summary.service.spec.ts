import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import type { Commitment, Ritual } from '@prisma/client';

import { AiGatewayService } from '../ai/gateway/ai-gateway.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserProfileService } from '../user-profile/user-profile.service';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { FamilySummaryService } from './family-summary.service';
import { familySummarySchema } from './family-summary.schema';

const USER = 'user-1';
const CR = 'America/Costa_Rica';
const DINNER = '22222222-2222-4222-8222-222222222222';
const WALK = '44444444-4444-4444-8444-444444444444';

/** Wednesday 3 June 2026, mid-morning in Costa Rica. */
const NOW = new Date('2026-06-03T16:00:00.000Z');
/** The Monday of that week. */
const MONDAY = '2026-06-01';

function commitment(over: Partial<Commitment> = {}): Commitment {
  return {
    id: 'c1',
    userId: USER,
    domain: 'FAMILY',
    title: 'Phone-free dinner',
    ritualId: DINNER,
    status: 'PLANNED',
    skipReason: null,
    // 18:30 in Costa Rica.
    scheduledStart: new Date('2026-06-03T00:30:00.000Z'),
    ...over,
  } as Commitment;
}

function ritual(over: Partial<Ritual> = {}): Ritual {
  return {
    id: DINNER,
    userId: USER,
    title: 'Phone-free dinner',
    active: true,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    ...over,
  } as Ritual;
}

describe('FamilySummaryService', () => {
  let service: FamilySummaryService;
  let prisma: MockPrismaService;
  let gateway: { invoke: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    gateway = { invoke: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        FamilySummaryService,
        { provide: PrismaService, useValue: prisma },
        { provide: AiGatewayService, useValue: gateway },
        { provide: UserProfileService, useValue: { find: jest.fn().mockResolvedValue({ timezone: CR }) } },
      ],
    }).compile();

    service = module.get(FamilySummaryService);
    prisma.ritual.findMany.mockResolvedValue([] as never);
    prisma.commitment.findMany.mockResolvedValue([] as never);
    prisma.reflection.findMany.mockResolvedValue([] as never);
  });

  /** Rows for the newest week only; every earlier week comes back empty. */
  const seedNewestWeek = (rows: Commitment[]) => {
    prisma.commitment.findMany.mockResolvedValueOnce(rows as never);
  };

  describe('counts', () => {
    beforeEach(() => {
      prisma.ritual.findMany.mockResolvedValue([
        ritual(),
        ritual({ id: WALK, title: 'Saturday walk' }),
      ] as never);
    });

    it('counts each status into its own bucket and sums the week', async () => {
      seedNewestWeek([
        commitment({ id: 'a', status: 'COMPLETED' }),
        commitment({ id: 'b', status: 'SKIPPED', skipReason: 'LOW_ENERGY' }),
        commitment({ id: 'c', status: 'PLANNED' }),
        commitment({ id: 'd', status: 'PARTIALLY_COMPLETED' }),
        commitment({ id: 'e', status: 'RESCHEDULED' }),
        commitment({ id: 'f', status: 'STARTED' }),
        commitment({ id: 'g', ritualId: null, title: 'Call Dad', status: 'COMPLETED' }),
      ]);

      const summary = await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);
      const week = summary.weeks[0];
      const dinner = week.rituals.find((line) => line.ritualId === DINNER)!;

      expect(dinner).toMatchObject({
        planned: 6,
        kept: 1,
        partial: 1,
        moved: 1,
        skipped: 1,
        missed: 0,
        // PLANNED + STARTED.
        open: 2,
      });
      expect(week.totals).toEqual({
        planned: 7,
        kept: 2,
        partial: 1,
        moved: 1,
        skipped: 1,
        missed: 0,
        open: 2,
      });
    });

    it('groups the ad-hoc commitments under one line', async () => {
      seedNewestWeek([commitment({ id: 'g', ritualId: null, title: 'Call Dad' })]);

      const summary = await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);
      const line = summary.weeks[0].rituals.find((entry) => entry.ritualId === null)!;

      expect(line.title).toBe('Other family commitments');
      expect(line.planned).toBe(1);
    });

    it('never asks the database for cancelled rows', async () => {
      await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);

      expect((prisma.commitment.findMany.mock.calls[0][0] as any).where).toMatchObject({
        domain: 'FAMILY',
        status: { not: 'CANCELLED' },
      });
    });

    it('lists an active ritual with no rows this week at zero', async () => {
      const summary = await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);

      // An every-other-week ritual must not look abandoned in its off week.
      expect(summary.weeks[0].rituals).toHaveLength(2);
      expect(summary.weeks[0].rituals[0]).toMatchObject({ planned: 0, kept: 0 });
    });

    it('does not list a ritual created after the window closed', async () => {
      prisma.ritual.findMany.mockResolvedValue([
        ritual({ createdAt: new Date('2026-07-01T00:00:00.000Z') }),
      ] as never);

      const summary = await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);

      expect(summary.weeks[0].rituals).toEqual([]);
    });

    it('does not list a paused ritual that had no rows', async () => {
      prisma.ritual.findMany.mockResolvedValue([ritual({ active: false })] as never);

      const summary = await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);

      expect(summary.weeks[0].rituals).toEqual([]);
    });

    it('still counts the rows of a paused ritual', async () => {
      prisma.ritual.findMany.mockResolvedValue([ritual({ active: false })] as never);
      seedNewestWeek([commitment({ status: 'COMPLETED' })]);

      const summary = await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);

      expect(summary.weeks[0].rituals[0]).toMatchObject({ title: 'Phone-free dinner', kept: 1 });
    });
  });

  describe('the window', () => {
    it('returns the requested number of weeks, newest first', async () => {
      const summary = await service.getSummary(USER, { weekStart: MONDAY, weeks: 3 }, NOW);

      expect(summary.weeks.map((week) => week.weekStart)).toEqual([
        '2026-06-01',
        '2026-05-25',
        '2026-05-18',
      ]);
    });

    it('defaults to the current local week and four weeks back', async () => {
      const summary = await service.getSummary(USER, {}, NOW);

      expect(summary.weeks).toHaveLength(4);
      expect(summary.weeks[0].weekStart).toBe(MONDAY);
    });

    it('rejects a weekStart that is not a Monday', async () => {
      await expect(
        service.getSummary(USER, { weekStart: '2026-06-02' }, NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('names the reason a client can branch on', async () => {
      await service.getSummary(USER, { weekStart: '2026-06-02' }, NOW).catch((error) => {
        expect((error.getResponse() as any).details).toMatchObject({
          reason: 'WEEK_START_NOT_MONDAY',
        });
      });

      expect.assertions(1);
    });

    // Sunday 23:30 in Costa Rica is Monday 05:30 UTC. Bounding the week in UTC
    // would file it under the following week, where the user did not plan it.
    it('bounds the week in the user’s timezone, not UTC', async () => {
      await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);

      const { scheduledStart } = (prisma.commitment.findMany.mock.calls[0][0] as any).where;
      expect(scheduledStart.gte.toISOString()).toBe('2026-06-01T06:00:00.000Z');
      expect(scheduledStart.lt.toISOString()).toBe('2026-06-08T06:00:00.000Z');
    });

    it('falls back to UTC when the profile has no timezone', async () => {
      const module = await Test.createTestingModule({
        providers: [
          FamilySummaryService,
          { provide: PrismaService, useValue: prisma },
          { provide: AiGatewayService, useValue: gateway },
          { provide: UserProfileService, useValue: { find: jest.fn().mockResolvedValue(null) } },
        ],
      }).compile();

      const summary = await module.get(FamilySummaryService).getSummary(USER, {}, NOW);

      expect(summary.timezone).toBe('UTC');
    });

    it('scopes every query to the caller', async () => {
      await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);

      expect((prisma.commitment.findMany.mock.calls[0][0] as any).where.userId).toBe(USER);
      expect((prisma.ritual.findMany.mock.calls[0][0] as any).where).toEqual({ userId: USER });
    });
  });

  describe('the coach note', () => {
    const displacedRows = () => [
      commitment({ id: 'a', status: 'SKIPPED', skipReason: 'UNEXPECTED_CONFLICT' }),
      commitment({ id: 'b', status: 'SKIPPED', skipReason: 'BAD_TIMING' }),
    ];

    it('is null below two displaced commitments, and does not call the coach', async () => {
      seedNewestWeek([commitment({ status: 'SKIPPED', skipReason: 'BAD_TIMING' })]);

      const summary = await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);

      expect(summary.coachNote).toBeNull();
      expect(gateway.invoke).not.toHaveBeenCalled();
    });

    it('ignores a skip whose reason is not a displacement', async () => {
      seedNewestWeek([
        commitment({ id: 'a', status: 'SKIPPED', skipReason: 'LOW_ENERGY' }),
        commitment({ id: 'b', status: 'SKIPPED', skipReason: 'AVOIDED' }),
      ]);

      const summary = await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);

      expect(summary.coachNote).toBeNull();
    });

    it('falls back to the template when the gateway refuses', async () => {
      seedNewestWeek(displacedRows());
      gateway.invoke.mockResolvedValue({ ok: false, invocationId: 'i', error: { code: 'no_user_key' } });

      const summary = await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);

      expect(summary.coachNote).toEqual({
        source: 'template',
        text:
          'Work displaced 2 evening family commitments this week. ' +
          'Do you want to protect those times more aggressively, or is the current trade-off intentional?',
      });
    });

    it('uses a rephrase that keeps the number', async () => {
      seedNewestWeek(displacedRows());
      gateway.invoke.mockResolvedValue({
        ok: true,
        invocationId: 'i',
        output: { text: 'Work took 2 evenings from your family this week. Is that the trade-off you want?' },
        usage: {},
      });

      const summary = await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);

      expect(summary.coachNote).toMatchObject({ source: 'ai' });
    });

    // A coach that quietly says "three" when the answer is two is worse than
    // no coach.
    it('discards a rephrase that changed the number', async () => {
      seedNewestWeek(displacedRows());
      gateway.invoke.mockResolvedValue({
        ok: true,
        invocationId: 'i',
        output: { text: 'Work took 5 evenings from your family. Is that intentional?' },
        usage: {},
      });

      const summary = await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);

      expect(summary.coachNote).toMatchObject({ source: 'template' });
    });

    it('discards a rephrase that rates the relationship', async () => {
      seedNewestWeek(displacedRows());
      gateway.invoke.mockResolvedValue({
        ok: true,
        invocationId: 'i',
        output: { text: 'Your family score dropped after 2 missed evenings. Intentional?' },
        usage: {},
      });

      const summary = await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);

      expect(summary.coachNote).toMatchObject({ source: 'template' });
    });

    it('reuses a rephrase for the same numbers instead of asking twice', async () => {
      gateway.invoke.mockResolvedValue({
        ok: true,
        invocationId: 'i',
        output: { text: 'Work took 2 evenings from your family this week. Intentional?' },
        usage: {},
      });

      prisma.commitment.findMany.mockResolvedValue(displacedRows() as never);
      await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);
      await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);

      expect(gateway.invoke).toHaveBeenCalledTimes(1);
    });

    // The cache is keyed on the COUNTS, so a skip that changes them is a miss.
    it('asks again once the numbers change', async () => {
      gateway.invoke.mockResolvedValue({
        ok: true,
        invocationId: 'i',
        output: { text: 'Work took 2 or 3 evenings from your family. Intentional?' },
        usage: {},
      });

      prisma.commitment.findMany.mockResolvedValue(displacedRows() as never);
      await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);

      prisma.commitment.findMany.mockResolvedValue([
        ...displacedRows(),
        commitment({ id: 'c', status: 'SKIPPED', skipReason: 'TOO_MUCH' }),
      ] as never);
      await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);

      expect(gateway.invoke).toHaveBeenCalledTimes(2);
    });

    // A move with no stated reason is not evidence that work displaced
    // anything; counting it would inflate the one number this sentence rests on.
    it('counts a moved commitment only when a reflection says why', async () => {
      prisma.commitment.findMany.mockResolvedValue([
        commitment({ id: 'a', status: 'SKIPPED', skipReason: 'UNEXPECTED_CONFLICT' }),
        commitment({ id: 'b', status: 'RESCHEDULED' }),
      ] as never);

      let summary = await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);
      expect(summary.coachNote).toBeNull();

      prisma.reflection.findMany.mockResolvedValue([
        { relatedId: 'b', frictionTags: ['BAD_TIMING'] },
      ] as never);
      gateway.invoke.mockResolvedValue({ ok: false, invocationId: 'i', error: { code: 'x' } });

      summary = await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);
      expect(summary.coachNote?.text).toContain('displaced 2');
    });

    it('drops "evening" when a displaced commitment was not one', async () => {
      prisma.commitment.findMany.mockResolvedValue([
        commitment({ id: 'a', status: 'SKIPPED', skipReason: 'UNEXPECTED_CONFLICT' }),
        commitment({
          id: 'b',
          status: 'SKIPPED',
          skipReason: 'BAD_TIMING',
          // 10:00 in Costa Rica.
          scheduledStart: new Date('2026-06-06T16:00:00.000Z'),
        }),
      ] as never);
      gateway.invoke.mockResolvedValue({ ok: false, invocationId: 'i', error: { code: 'x' } });

      const summary = await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);

      expect(summary.coachNote?.text).toContain('Work displaced 2 family commitments this week.');
    });
  });

  describe('the payload', () => {
    it('validates against the published schema', async () => {
      prisma.ritual.findMany.mockResolvedValue([ritual()] as never);
      seedNewestWeek([commitment({ status: 'COMPLETED' })]);

      const summary = await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);

      expect(familySummarySchema.safeParse(summary).success).toBe(true);
    });

    // VISION §12: no relationship score, and no ratio that would become one.
    it('contains no score, quality or rating anywhere', async () => {
      prisma.ritual.findMany.mockResolvedValue([ritual()] as never);
      seedNewestWeek([commitment({ status: 'COMPLETED' })]);

      const summary = await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);

      expect(JSON.stringify(summary)).not.toMatch(/score|quality|rating|grade/i);
    });

    it('offers no derived ratio for the reader to mistake for a verdict', async () => {
      prisma.ritual.findMany.mockResolvedValue([ritual()] as never);
      seedNewestWeek([commitment({ status: 'COMPLETED' })]);

      const summary = await service.getSummary(USER, { weekStart: MONDAY, weeks: 1 }, NOW);
      const keys = Object.keys(summary.weeks[0].rituals[0]);

      expect(keys).toEqual([
        'ritualId',
        'title',
        'planned',
        'kept',
        'partial',
        'moved',
        'skipped',
        'missed',
        'open',
      ]);
    });
  });
});
