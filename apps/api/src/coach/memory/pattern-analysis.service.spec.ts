import { Test } from '@nestjs/testing';

import { AiGatewayService } from '../../ai/gateway/ai-gateway.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import { PATTERN_ANALYST_PROMPT_VERSION } from '../prompts/pattern-analyst.prompt';
import {
  INSIGHT_TTL_DAYS,
  MIN_SAMPLE,
  PatternAnalysisService,
} from './pattern-analysis.service';

// =============================================================================
// The proposer (issue #78)
// =============================================================================
//
// The two assertions worth having are both about NOT calling the model: below
// the sample threshold, and — through dedupe — about a statement the user has
// already said "don't use this" to. The second one is the one a refactor is
// most likely to break, because re-proposing looks harmless right up until the
// user sees the sentence they dismissed come back.
// =============================================================================

const USER = 'user-1';

const decidedCommitment = (i: number) => ({
  status: i % 3 === 0 ? 'MISSED' : 'COMPLETED',
  domain: 'HEALTH',
  scheduledStart: new Date('2026-09-02T08:00:00.000Z'),
  rescheduleCount: 0,
  versionUsed: 'FULL',
  minutesSpent: null,
  fullMinutes: null,
  skipReason: null,
});

const proposal = (over: Record<string, unknown> = {}) => ({
  category: 'PATTERN',
  statement: 'Morning commitments are more reliable than evening ones.',
  observation: '12 of 15 kept commitments were scheduled before noon.',
  evidenceCount: 15,
  confidence: 0.8,
  ...over,
});

describe('PatternAnalysisService (#78)', () => {
  let service: PatternAnalysisService;
  let prisma: MockPrismaService;
  let invoke: jest.Mock;
  let notify: jest.Mock;

  const withCommitments = (count: number) =>
    prisma.commitment.findMany.mockResolvedValue(
      Array.from({ length: count }, (_, i) => decidedCommitment(i)) as never,
    );

  beforeEach(async () => {
    prisma = createMockPrismaService();
    invoke = jest.fn();
    notify = jest.fn().mockResolvedValue(undefined);

    const module = await Test.createTestingModule({
      providers: [
        PatternAnalysisService,
        { provide: PrismaService, useValue: prisma },
        { provide: AiGatewayService, useValue: { invoke } },
        { provide: NotificationsService, useValue: { notify } },
      ],
    }).compile();

    service = module.get(PatternAnalysisService);

    prisma.userProfile.findUnique.mockResolvedValue({ timezone: 'UTC' } as never);
    prisma.memoryInsight.findMany.mockResolvedValue([] as never);
    prisma.auditEvent.create.mockResolvedValue({} as never);
    prisma.$transaction.mockImplementation(async (ops: unknown) =>
      Promise.all(ops as Promise<unknown>[]),
    );
  });

  it('does not call the model below the sample threshold', async () => {
    withCommitments(MIN_SAMPLE - 1);

    const result = await service.proposeInsights(USER);

    // A week of history cannot support a durable statement about how somebody
    // works, and asking anyway would produce a confident one.
    expect(result).toEqual({ created: [], skipped: 'insufficient_data' });
    expect(invoke).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('calls the pattern_analyst persona with its versioned prompt', async () => {
    withCommitments(20);
    invoke.mockResolvedValue({
      ok: true,
      invocationId: 'inv-1',
      output: { insights: [] },
      usage: {},
      model: 'gpt-5.4',
      latencyMs: 1,
    });

    await service.proposeInsights(USER);

    expect(invoke.mock.calls[0][0]).toMatchObject({
      persona: 'pattern_analyst',
      promptVersion: PATTERN_ANALYST_PROMPT_VERSION,
      schemaName: 'insight_proposal',
    });
  });

  it('sends counts and nothing else', async () => {
    withCommitments(20);
    invoke.mockResolvedValue({
      ok: true,
      invocationId: 'inv-1',
      output: { insights: [] },
      usage: {},
      model: 'gpt-5.4',
      latencyMs: 1,
    });

    await service.proposeInsights(USER);

    const input = JSON.parse(invoke.mock.calls[0][0].input);
    // The persona that writes durable sentences about a person gets the least
    // to work from: an aggregate, plus what the user already has on file.
    expect(Object.keys(input).sort()).toEqual(['existingStatements', 'stats']);
    expect(Object.keys(input.stats).sort()).toEqual([
      'averageDurationGapMinutes',
      'byDomain',
      'byTimeOfDay',
      'byWeekday',
      'fallbackUsage',
      'rescheduleHistogram',
      'sampleSize',
      'skipReasons',
    ]);
  });

  it('degrades to ai_unavailable rather than failing', async () => {
    withCommitments(20);
    invoke.mockResolvedValue({
      ok: false,
      invocationId: 'inv-1',
      error: { code: 'timeout', message: 'slow' },
      model: null,
      latencyMs: 1,
    });

    // A proposer that cannot run is not a broken screen.
    expect(await service.proposeInsights(USER)).toEqual({
      created: [],
      skipped: 'ai_unavailable',
    });
    expect(prisma.memoryInsight.create).not.toHaveBeenCalled();
  });

  describe('creation', () => {
    beforeEach(() => {
      withCommitments(20);
      invoke.mockResolvedValue({
        ok: true,
        invocationId: 'inv-1',
        output: { insights: [proposal()] },
        usage: {},
        model: 'gpt-5.4',
        latencyMs: 1,
      });
      (prisma.memoryInsight.create as unknown as jest.Mock).mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'insight-1',
          evidenceCount: 0,
          confidence: 0,
          userConfirmed: false,
          doNotUse: false,
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        }),
      );
    });

    it('stores AI insights unconfirmed, with a 90-day expiry', async () => {
      const before = Date.now();

      const result = await service.proposeInsights(USER);

      const data = prisma.memoryInsight.create.mock.calls[0][0]!.data as Record<
        string,
        unknown
      >;

      // PRD §10.12: a durable inference needs explicit approval before it
      // becomes a planning assumption, and the assembler's query is what makes
      // "unconfirmed" mean "the coach never sees it".
      expect(data.userConfirmed).toBe(false);
      expect(data.source).toBe('AI');
      expect(data.invocationId).toBe('inv-1');

      const expiry = (data.expiresAt as Date).getTime();
      const expected = before + INSIGHT_TTL_DAYS * 86_400_000;
      expect(Math.abs(expiry - expected)).toBeLessThan(5_000);

      expect(result.created).toHaveLength(1);
      expect(result.skipped).toBeNull();
    });

    it('raises exactly one notification, carrying only the count', async () => {
      await service.proposeInsights(USER);

      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith('memory.insight_proposed', USER, {
        count: 1,
      });
    });

    it('audits the run with a count and no statements', async () => {
      await service.proposeInsights(USER);

      const audit = prisma.auditEvent.create.mock.calls[0][0]!.data;
      expect(audit).toMatchObject({
        action: 'memory_insight:propose',
        meta: { count: 1 },
      });
      expect(JSON.stringify(audit)).not.toContain('Morning commitments');
    });
  });

  describe('dedupe', () => {
    beforeEach(() => {
      withCommitments(20);
      (prisma.memoryInsight.create as unknown as jest.Mock).mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'insight-1',
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: null,
          ...data,
        }),
      );
    });

    it('skips a statement the user already has, whatever the casing', async () => {
      prisma.memoryInsight.findMany.mockResolvedValue([
        {
          category: 'PATTERN',
          statement: 'MORNING COMMITMENTS ARE MORE RELIABLE THAN EVENING ONES.',
        },
      ] as never);
      invoke.mockResolvedValue({
        ok: true,
        invocationId: 'inv-1',
        output: { insights: [proposal()] },
        usage: {},
        model: 'gpt-5.4',
        latencyMs: 1,
      });

      const result = await service.proposeInsights(USER);

      expect(result).toEqual({ created: [], skipped: null });
      expect(prisma.memoryInsight.create).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it('never re-proposes something the user marked do-not-use', async () => {
      // The row is still there — "don't use this" is an answer, and re-asking
      // would be the product ignoring it. (A "forgotten" row is genuinely
      // gone, and may legitimately come back.)
      prisma.memoryInsight.findMany.mockResolvedValue([
        { category: 'PATTERN', statement: proposal().statement },
      ] as never);
      invoke.mockResolvedValue({
        ok: true,
        invocationId: 'inv-1',
        output: { insights: [proposal()] },
        usage: {},
        model: 'gpt-5.4',
        latencyMs: 1,
      });

      await service.proposeInsights(USER);

      const queried = prisma.memoryInsight.findMany.mock.calls[0][0]!.where;
      // No `doNotUse: false` filter here, unlike the assembler's query.
      expect(queried).toEqual({ userId: USER });
      expect(prisma.memoryInsight.create).not.toHaveBeenCalled();
    });

    it('collapses duplicates inside one batch', async () => {
      invoke.mockResolvedValue({
        ok: true,
        invocationId: 'inv-1',
        output: { insights: [proposal(), proposal()] },
        usage: {},
        model: 'gpt-5.4',
        latencyMs: 1,
      });

      await service.proposeInsights(USER);

      expect(prisma.memoryInsight.create).toHaveBeenCalledTimes(1);
    });
  });
});
