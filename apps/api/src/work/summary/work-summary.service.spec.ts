import { BadRequestException } from '@nestjs/common';

import { WorkSummaryService } from './work-summary.service';

// =============================================================================
// The loader around the aggregator (issue #120)
// =============================================================================
//
// The arithmetic has its own spec. What this one proves is the boundary: the
// default week is the user's own Monday, a Tuesday is refused, the query count
// does not grow with the data, and the ladder failing does not take the report
// down with it.
// =============================================================================

const USER = 'user-1';
// A Wednesday, so `weekStartFor` has to walk back to Monday the 9th.
const NOW = new Date('2026-09-11T15:00:00.000Z');

interface BuildOptions {
  profile?: Record<string, unknown> | null;
  commitments?: Array<Record<string, unknown>>;
  assessThrows?: boolean;
}

function build(options: BuildOptions = {}) {
  const prisma: any = {
    commitment: { findMany: jest.fn(async () => options.commitments ?? []) },
    focusSession: { findMany: jest.fn(async () => []) },
    evidence: { findMany: jest.fn(async () => []) },
    outcome: { findMany: jest.fn(async () => []) },
  };

  const profiles = {
    find: jest.fn(async () =>
      options.profile === undefined ? { timezone: 'UTC' } : options.profile,
    ),
  };

  const avoidance = {
    assessMany: jest.fn(async () => {
      if (options.assessThrows) throw new Error('database on fire');

      return new Map([
        [
          'moved',
          {
            level: 4,
            interventionType: 'ENVIRONMENT_CHANGE',
            signals: [],
            rationale: '',
            suggestedAction: 'ENVIRONMENT',
          },
        ],
      ]);
    }),
  };

  return {
    service: new WorkSummaryService(prisma as never, profiles as never, avoidance as never),
    prisma,
    profiles,
    avoidance,
  };
}

describe('WorkSummaryService.getWeek', () => {
  it("defaults to the Monday of the user's current local week", async () => {
    const { service } = build();

    const summary = await service.getWeek(USER, undefined, NOW);

    expect(summary.weekStart).toBe('2026-09-07');
    expect(summary.weekEnd).toBe('2026-09-13');
  });

  it("resolves the default week in the user's own timezone", async () => {
    // 15:00 UTC on Friday is already Saturday in Auckland, but both are still
    // inside the same Monday-start week — what matters is that the zone is read.
    const { service, profiles } = build({ profile: { timezone: 'Pacific/Auckland' } });

    const summary = await service.getWeek(USER, undefined, NOW);

    expect(profiles.find).toHaveBeenCalledWith(USER);
    expect(summary.timezone).toBe('Pacific/Auckland');
  });

  it('falls back to UTC for a user with no profile', async () => {
    const { service } = build({ profile: null });

    expect((await service.getWeek(USER, undefined, NOW)).timezone).toBe('UTC');
  });

  it('refuses a Tuesday', async () => {
    const { service } = build();

    await expect(service.getWeek(USER, '2026-09-08', NOW)).rejects.toMatchObject({
      response: { details: { reason: 'WEEK_START_NOT_MONDAY' } },
    });
  });

  it('refuses an unparsable date', async () => {
    const { service } = build();

    await expect(service.getWeek(USER, '2026-13-45', NOW)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('scopes every query by the caller', async () => {
    const { service, prisma } = build();

    await service.getWeek(USER, undefined, NOW);

    for (const table of ['commitment', 'focusSession', 'evidence', 'outcome'] as const) {
      for (const [args] of prisma[table].findMany.mock.calls) {
        expect((args as { where: { userId: string } }).where.userId).toBe(USER);
      }
    }
  });

  it('issues the same number of queries whatever the data volume', async () => {
    const one = build({ commitments: [row('c1')] });
    await one.service.getWeek(USER, undefined, NOW);

    const many = build({
      commitments: Array.from({ length: 40 }, (_, i) => row(`c${i}`)),
    });
    await many.service.getWeek(USER, undefined, NOW);

    const count = (p: Record<string, { findMany: jest.Mock }>) =>
      Object.values(p).reduce((sum, table) => sum + table.findMany.mock.calls.length, 0);

    expect(count(many.prisma)).toBe(count(one.prisma));
  });

  it('asks for a ladder reading only for the postponed rows', async () => {
    const { service, avoidance, prisma } = build({
      commitments: [row('c1'), row('moved', { rescheduleCount: 2 })],
    });

    await service.getWeek(USER, undefined, NOW);

    expect(avoidance.assessMany).toHaveBeenCalledTimes(1);
    const [lastCall] = prisma.commitment.findMany.mock.calls.slice(-1);
    expect((lastCall[0] as { where: { id: { in: string[] } } }).where.id.in).toEqual(['moved']);
  });

  it('does not ask at all when nothing was postponed', async () => {
    const { service, avoidance } = build({ commitments: [row('c1')] });

    await service.getWeek(USER, undefined, NOW);

    expect(avoidance.assessMany).not.toHaveBeenCalled();
  });

  it('still returns the week when the ladder query fails', async () => {
    const { service } = build({
      commitments: [row('moved', { rescheduleCount: 2 })],
      assessThrows: true,
    });

    const summary = await service.getWeek(USER, undefined, NOW);

    expect(summary.repeatedlyPostponed[0]).toMatchObject({ commitmentId: 'moved', level: 0 });
  });
});

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    domain: 'WORK',
    title: 'Storyline',
    outcomeId: null,
    commitmentType: 'FOCUS_SESSION',
    status: 'PLANNED',
    scheduledStart: new Date('2026-09-08T09:00:00.000Z'),
    scheduledEnd: null,
    startedAt: null,
    rescheduleCount: 0,
    fullMinutes: 25,
    ...over,
  };
}
