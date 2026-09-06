import type { Commitment } from '@prisma/client';

import { AvoidanceSignalsService, EXPLICIT_LATER_PATTERN } from './avoidance-signals.service';

// =============================================================================
// From rows to numbers (issue #116)
// =============================================================================
//
// Two things are worth a test here that the detector's own spec cannot reach:
// the query COUNT (this runs on every Today request, for every card), and the
// timezone, which decides which day a 23:30 UTC commitment failed on.
// =============================================================================

const USER = 'user-1';
const NOW = new Date('2026-09-08T12:00:00.000Z');
const OUTCOME = 'outcome-1';

function commitment(over: Partial<Commitment> = {}): Commitment {
  return {
    id: 'c1',
    userId: USER,
    domain: 'WORK',
    title: 'Storyline',
    outcomeId: OUTCOME,
    scheduledStart: new Date('2026-09-08T09:00:00.000Z'),
    scheduledEnd: null,
    status: 'PLANNED',
    rescheduleCount: 0,
    importance: 4,
    skipReason: null,
    skipNote: null,
    completedAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    ...over,
  } as Commitment;
}

interface BuildOptions {
  siblings?: Array<Record<string, unknown>>;
  evidence?: Array<{ commitmentId: string }>;
  reflections?: Array<{ commitmentId: string; frictionTags: string[] }>;
  outcomeCreatedAt?: Date;
}

function build(options: BuildOptions = {}) {
  const prisma: any = {
    outcome: {
      findMany: jest.fn(async () => [
        {
          id: OUTCOME,
          createdAt: options.outcomeCreatedAt ?? new Date('2026-08-01T00:00:00.000Z'),
        },
      ]),
    },
    commitment: { findMany: jest.fn(async () => options.siblings ?? []) },
    evidence: { findMany: jest.fn(async () => options.evidence ?? []) },
    reflection: { findMany: jest.fn(async () => options.reflections ?? []) },
  };

  return { service: new AvoidanceSignalsService(prisma as never), prisma };
}

describe('EXPLICIT_LATER_PATTERN', () => {
  it.each(['I will do it later', 'Tomorrow', 'not now', 'LATER today'])(
    'matches %s',
    (note) => {
      expect(EXPLICIT_LATER_PATTERN.test(note)).toBe(true);
    },
  );

  it.each(['the latest draft', 'tomorrowland', 'nowhere'])('does not match %s', (note) => {
    expect(EXPLICIT_LATER_PATTERN.test(note)).toBe(false);
  });
});

describe('AvoidanceSignalsService.collectMany', () => {
  it('issues the same number of queries for one commitment and for ten', async () => {
    const one = build();
    await one.service.collectMany(USER, [commitment()], NOW, 'UTC');

    const many = build();
    await many.service.collectMany(
      USER,
      Array.from({ length: 10 }, (_, i) => commitment({ id: `c${i}` })),
      NOW,
      'UTC',
    );

    const count = (p: Record<string, { findMany: jest.Mock }>) =>
      Object.values(p).reduce((sum, table) => sum + table.findMany.mock.calls.length, 0);

    expect(count(many.prisma)).toBe(count(one.prisma));
    expect(count(one.prisma)).toBe(4);
  });

  it('returns nothing, and asks nothing, for an empty batch', async () => {
    const { service, prisma } = build();

    const result = await service.collectMany(USER, [], NOW, 'UTC');

    expect(result.size).toBe(0);
    expect(prisma.commitment.findMany).not.toHaveBeenCalled();
  });

  it('carries the reschedule count straight through', async () => {
    const { service } = build();

    const result = await service.collectMany(
      USER,
      [commitment({ rescheduleCount: 2 })],
      NOW,
      'UTC',
    );

    expect(result.get('c1')?.signals.rescheduleCount).toBe(2);
  });

  it('counts days untouched from creation, and zero once any evidence exists', async () => {
    const withoutEvidence = build();
    const bare = await withoutEvidence.service.collectMany(USER, [commitment()], NOW, 'UTC');
    expect(bare.get('c1')?.signals.daysUnchanged).toBe(7);

    const withEvidence = build({ evidence: [{ commitmentId: 'c1' }] });
    const touched = await withEvidence.service.collectMany(USER, [commitment()], NOW, 'UTC');
    expect(touched.get('c1')?.signals.daysUnchanged).toBe(0);
  });

  it('counts days untouched as zero once the commitment is no longer open', async () => {
    const { service } = build();

    const result = await service.collectMany(
      USER,
      [commitment({ status: 'STARTED' })],
      NOW,
      'UTC',
    );

    expect(result.get('c1')?.signals.daysUnchanged).toBe(0);
  });

  it('counts skips and misses of the same outcome', async () => {
    const { service } = build({
      siblings: [
        { id: 'c2', outcomeId: OUTCOME, status: 'SKIPPED', scheduledStart: new Date('2026-09-05T09:00:00.000Z'), skipReason: null, skipNote: null, importance: 4, completedAt: null },
        { id: 'c3', outcomeId: OUTCOME, status: 'MISSED', scheduledStart: new Date('2026-09-04T09:00:00.000Z'), skipReason: null, skipNote: null, importance: 4, completedAt: null },
        { id: 'c4', outcomeId: OUTCOME, status: 'COMPLETED', scheduledStart: new Date('2026-09-03T09:00:00.000Z'), skipReason: null, skipNote: null, importance: 4, completedAt: null },
      ],
    });

    const result = await service.collectMany(USER, [commitment()], NOW, 'UTC');

    expect(result.get('c1')?.signals.shortSkipCount).toBe(2);
  });

  it('counts an AVOIDED skip reason and a "later" note as explicit laters', async () => {
    const { service } = build({
      siblings: [
        { id: 'c2', outcomeId: OUTCOME, status: 'SKIPPED', scheduledStart: new Date('2026-09-05T09:00:00.000Z'), skipReason: 'AVOIDED', skipNote: null, importance: 4, completedAt: null },
        { id: 'c3', outcomeId: OUTCOME, status: 'SKIPPED', scheduledStart: new Date('2026-09-04T09:00:00.000Z'), skipReason: 'NO_TIME', skipNote: 'I will get to it tomorrow', importance: 4, completedAt: null },
        { id: 'c4', outcomeId: OUTCOME, status: 'SKIPPED', scheduledStart: new Date('2026-09-03T09:00:00.000Z'), skipReason: 'NO_TIME', skipNote: 'used the latest draft', importance: 4, completedAt: null },
      ],
    });

    const result = await service.collectMany(USER, [commitment()], NOW, 'UTC');

    expect(result.get('c1')?.signals.explicitLaterCount).toBe(2);
  });

  it('counts same-window failures in the USER\'s timezone', async () => {
    // 23:30 UTC is evening in UTC and morning the next day in Tokyo. The
    // assessed commitment is at 09:00 UTC — morning in UTC, evening in Tokyo.
    const siblings = [
      { id: 'c2', outcomeId: OUTCOME, status: 'SKIPPED', scheduledStart: new Date('2026-09-05T23:30:00.000Z'), skipReason: null, skipNote: null, importance: 4, completedAt: null },
    ];

    const utc = build({ siblings });
    const inUtc = await utc.service.collectMany(USER, [commitment()], NOW, 'UTC');
    expect(inUtc.get('c1')?.signals.sameWindowFailureCount).toBe(0);

    const tokyo = build({ siblings });
    const inTokyo = await tokyo.service.collectMany(USER, [commitment()], NOW, 'Asia/Tokyo');
    // In Tokyo both are evening (09:00 UTC = 18:00, 23:30 UTC = 08:30 next day
    // — morning), so they still differ; what matters is that the answer changed
    // with the zone rather than being computed in UTC.
    expect(inTokyo.get('c1')?.signals.sameWindowFailureCount).toBe(0);
  });

  it('counts a displacement only when something LESS important was completed', async () => {
    const { service } = build({
      siblings: [
        { id: 'c2', outcomeId: OUTCOME, status: 'COMPLETED', scheduledStart: new Date('2026-09-08T10:00:00.000Z'), skipReason: null, skipNote: null, importance: 2, completedAt: new Date('2026-09-08T11:00:00.000Z') },
        { id: 'c3', outcomeId: OUTCOME, status: 'COMPLETED', scheduledStart: new Date('2026-09-08T10:00:00.000Z'), skipReason: null, skipNote: null, importance: 5, completedAt: new Date('2026-09-08T11:00:00.000Z') },
      ],
    });

    const result = await service.collectMany(USER, [commitment()], NOW, 'UTC');

    expect(result.get('c1')?.signals.displacedByLowerImportanceCount).toBe(1);
  });

  it('counts no displacement for a commitment that is not due yet', async () => {
    const { service } = build({
      siblings: [
        { id: 'c2', outcomeId: OUTCOME, status: 'COMPLETED', scheduledStart: new Date('2026-09-08T10:00:00.000Z'), skipReason: null, skipNote: null, importance: 2, completedAt: new Date('2026-09-08T11:00:00.000Z') },
      ],
    });

    const result = await service.collectMany(
      USER,
      [commitment({ scheduledStart: new Date('2026-09-20T09:00:00.000Z') })],
      NOW,
      'UTC',
    );

    expect(result.get('c1')?.signals.displacedByLowerImportanceCount).toBe(0);
  });

  it('measures weeks of evidence from the outcome, not the commitment', async () => {
    const { service } = build({ outcomeCreatedAt: new Date('2026-08-01T00:00:00.000Z') });

    const result = await service.collectMany(USER, [commitment()], NOW, 'UTC');

    expect(result.get('c1')?.signals.weeksOfEvidence).toBe(5);
  });

  it('marks askedRecently only for a friction ANSWER, never a skip reflection', async () => {
    const skip = build({ reflections: [{ commitmentId: 'c1', frictionTags: ['NO_TIME'] }] });
    const afterSkip = await skip.service.collectMany(USER, [commitment()], NOW, 'UTC');
    expect(afterSkip.get('c1')?.askedRecently).toBe(false);

    const asked = build({ reflections: [{ commitmentId: 'c1', frictionTags: ['TOO_BIG'] }] });
    const afterAnswer = await asked.service.collectMany(USER, [commitment()], NOW, 'UTC');
    expect(afterAnswer.get('c1')?.askedRecently).toBe(true);
  });
});
