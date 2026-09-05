import { Test } from '@nestjs/testing';

import {
  createMockPrismaService,
  MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import { PrismaService } from '../../prisma/prisma.service';
import { ContextAssemblerService } from './context-assembler.service';
import { CONTEXT_SCOPES } from './context-scopes';

// =============================================================================
// The assembler's promises (issue #63, epic E06)
// =============================================================================
//
// Two of these tests exist because the promise they check is invisible in
// review: "a `doNotUse` insight is never sent to a model" and "the rendered
// context carries no email address" are both properties of code that is not
// there, and the only way to notice their absence is to assert it.
// =============================================================================

const USER = 'user-1';
/** A Wednesday, 18:00 UTC. */
const NOW = new Date('2026-09-09T18:00:00.000Z');

const insight = (over: Record<string, unknown> = {}) => ({
  category: 'PATTERN',
  statement: 'Morning workouts are more reliable than evening ones.',
  evidenceCount: 4,
  confidence: 0.8,
  userConfirmed: true,
  doNotUse: false,
  expiresAt: null,
  ...over,
});

describe('ContextAssemblerService (#63)', () => {
  let assembler: ContextAssemblerService;
  let prisma: MockPrismaService;

  /** Every section empty unless a test says otherwise. */
  function stubEmpty() {
    prisma.userProfile.findUnique.mockResolvedValue(null as never);
    prisma.bestSelfProfile.findUnique.mockResolvedValue(null as never);
    prisma.domainMode.findMany.mockResolvedValue([] as never);
    prisma.outcome.findMany.mockResolvedValue([] as never);
    prisma.planVersion.findMany.mockResolvedValue([] as never);
    prisma.commitment.findMany.mockResolvedValue([] as never);
    prisma.evidence.findMany.mockResolvedValue([] as never);
    prisma.reflection.findMany.mockResolvedValue([] as never);
    prisma.memoryInsight.findMany.mockResolvedValue([] as never);
    prisma.obstacle.findMany.mockResolvedValue([] as never);
    prisma.notification.count.mockResolvedValue(0 as never);
  }

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const module = await Test.createTestingModule({
      providers: [
        ContextAssemblerService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    assembler = module.get(ContextAssemblerService);
    stubEmpty();
  });

  // ---------------------------------------------------------------------------
  // Memory: the three conditions the user was promised (PRD §85)
  // ---------------------------------------------------------------------------

  describe('memory insights', () => {
    it('asks the database for confirmed, permitted, unexpired rows only', async () => {
      await assembler.assemble(USER, 'coach', NOW);

      const where = prisma.memoryInsight.findMany.mock.calls[0][0]!.where;

      // Asserted on the QUERY, not on the result: a filter applied in
      // JavaScript after the fact would pass a result-shaped test while still
      // pulling forbidden rows into memory and into any future log line.
      expect(where).toEqual({
        userId: USER,
        userConfirmed: true,
        doNotUse: false,
        OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }],
      });
    });

    it.each([
      ['marked do-not-use', { doNotUse: true }],
      ['still unconfirmed', { userConfirmed: false }],
      ['past its expiry', { expiresAt: new Date(NOW.getTime() - 1000) }],
    ])('never renders an insight %s, in any scope', async (_label, over) => {
      // The row comes back from the mock regardless of the `where` clause,
      // which is the point: this asserts the second, redundant filter, so the
      // promise survives someone editing the query.
      prisma.memoryInsight.findMany.mockResolvedValue([
        insight({ statement: 'Forbidden.', ...over }),
      ] as never);

      for (const scope of ['coach', 'planner', 'workout', 'family'] as const) {
        const context = await assembler.assemble(USER, scope, NOW);

        expect(context.memoryInsights).toEqual([]);
        expect(assembler.renderForPrompt(context)).not.toContain('Forbidden.');
      }
    });

    it('keeps an insight whose expiry is still in the future', async () => {
      prisma.memoryInsight.findMany.mockResolvedValue([
        insight({ expiresAt: new Date(NOW.getTime() + 86_400_000) }),
      ] as never);

      const context = await assembler.assemble(USER, 'coach', NOW);

      expect(context.memoryInsights).toHaveLength(1);
      expect(assembler.renderForPrompt(context)).toContain(
        'Morning workouts are more reliable',
      );
    });

    it('filters to the scope categories after the query', async () => {
      prisma.memoryInsight.findMany.mockResolvedValue([
        insight({ category: 'HEALTH', statement: 'Trains before 9am.' }),
        insight({ category: 'WORK', statement: 'Deep work in the morning.' }),
      ] as never);

      const workout = await assembler.assemble(USER, 'workout', NOW);
      const coach = await assembler.assemble(USER, 'coach', NOW);

      expect(workout.memoryInsights.map((i) => i.statement)).toEqual([
        'Trains before 9am.',
      ]);
      // `coach` declares no category filter, so it sees both.
      expect(coach.memoryInsights).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Scope
  // ---------------------------------------------------------------------------

  describe('scoping', () => {
    it('asks the family scope for FAMILY rows and no workout evidence', async () => {
      await assembler.assemble(USER, 'family', NOW);

      const evidenceWhere = prisma.evidence.findMany.mock.calls[0][0]!.where;
      const commitmentWhere = prisma.commitment.findMany.mock.calls[0][0]!.where;

      expect(evidenceWhere).toMatchObject({
        source: { notIn: ['WORKOUT_LOG'] },
      });
      expect(commitmentWhere).toMatchObject({ domain: { in: ['FAMILY'] } });
    });

    it('asks the workout scope for HEALTH plans and WORKOUT_LOG evidence only', async () => {
      const context = await assembler.assemble(USER, 'workout', NOW);

      const evidenceWhere = prisma.evidence.findMany.mock.calls[0][0]!.where;
      const planWhere = prisma.planVersion.findMany.mock.calls[0][0]!.where;

      expect(evidenceWhere).toMatchObject({ source: { in: ['WORKOUT_LOG'] } });
      expect(planWhere).toMatchObject({
        plan: { outcome: { domain: { in: ['HEALTH'] } } },
      });

      // Reflections are not in the workout scope, so they are not queried at
      // all — an empty array here means "never asked", not "asked and empty".
      expect(prisma.reflection.findMany).not.toHaveBeenCalled();
      expect(context.recentReflections).toEqual([]);
      expect(assembler.renderForPrompt(context)).not.toContain(
        'RECENT REFLECTIONS',
      );
    });

    it('gives outcomes to the planner and to nobody else', async () => {
      const planner = await assembler.assemble(USER, 'planner', NOW);
      expect(planner.outcomes).toEqual([]);
      expect(prisma.outcome.findMany).toHaveBeenCalledTimes(1);

      prisma.outcome.findMany.mockClear();

      const coach = await assembler.assemble(USER, 'coach', NOW);
      expect(coach.outcomes).toBeUndefined();
      expect(prisma.outcome.findMany).not.toHaveBeenCalled();
    });

    it('renders exactly the sections its scope declares', async () => {
      for (const scope of ['coach', 'planner', 'workout', 'family'] as const) {
        const context = await assembler.assemble(USER, scope, NOW);
        expect(context.sections).toEqual(CONTEXT_SCOPES[scope].sections);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Defaults
  // ---------------------------------------------------------------------------

  it('defaults to BALANCED and UTC when the user has no profile row', async () => {
    const context = await assembler.assemble(USER, 'coach', NOW);

    expect(context.coachingStyle).toBe('BALANCED');
    expect(context.now.timezone).toBe('UTC');
    expect(context.now.weekday).toBe('Wednesday');
  });

  it('reads the weekday in the user’s own zone, not the server’s', async () => {
    prisma.userProfile.findUnique.mockResolvedValue({
      timezone: 'Pacific/Kiritimati', // UTC+14: already Thursday at 18:00 UTC.
      coachingStyle: 'DIRECT',
    } as never);

    const context = await assembler.assemble(USER, 'coach', NOW);

    expect(context.now.weekday).toBe('Thursday');
    expect(context.coachingStyle).toBe('DIRECT');
  });

  it('falls back to UTC for a timezone the runtime cannot resolve', async () => {
    prisma.userProfile.findUnique.mockResolvedValue({
      timezone: 'Mars/Olympus_Mons',
      coachingStyle: 'GENTLE',
    } as never);

    const context = await assembler.assemble(USER, 'coach', NOW);

    expect(context.now.timezone).toBe('UTC');
  });

  // ---------------------------------------------------------------------------
  // Rendering and budget
  // ---------------------------------------------------------------------------

  describe('renderForPrompt', () => {
    it('is byte-identical across calls for the same rows', async () => {
      prisma.memoryInsight.findMany.mockResolvedValue([insight()] as never);
      prisma.domainMode.findMany.mockResolvedValue([
        { domain: 'HEALTH', mode: 'GROW' },
      ] as never);

      const first = await assembler.assemble(USER, 'coach', NOW);
      const second = await assembler.assemble(USER, 'coach', NOW);

      expect(assembler.renderForPrompt(first)).toBe(
        assembler.renderForPrompt(second),
      );
    });

    it('names the ids a reply is allowed to reference', async () => {
      prisma.planVersion.findMany.mockResolvedValue([
        {
          id: 'version-1',
          version: 1,
          rationale: null,
          expectedWeeklyLoad: 120,
          planId: 'plan-1',
          plan: { outcome: { title: 'Get strong again', domain: 'HEALTH' } },
          routines: [
            {
              id: 'routine-1',
              title: 'Strength workout',
              frequency: 'WEEKLY',
              daysOfWeek: [3],
              preferredTime: '18:30',
              estimatedDurationMin: 40,
              minimumDurationMin: 10,
              fallbackBehavior: null,
              active: true,
            },
          ],
        },
      ] as never);
      prisma.commitment.findMany.mockResolvedValue([
        {
          id: 'commitment-1',
          title: 'Strength workout',
          domain: 'HEALTH',
          status: 'PLANNED',
          scheduledStart: NOW,
          fullMinutes: 40,
          minimumMinutes: 10,
          rescheduleCount: 0,
          skipReason: null,
        },
      ] as never);

      const rendered = assembler.renderForPrompt(
        await assembler.assemble(USER, 'coach', NOW),
      );

      // `coach-output-guard.ts` rejects any id that is not in the context, so a
      // context with no ids makes a proposal and a `Start 10 min` action
      // impossible to produce at all.
      expect(rendered).toContain('planId=plan-1');
      expect(rendered).toContain('routineId=routine-1');
      expect(rendered).toContain('commitmentId=commitment-1');
    });

    it('never carries the user’s email or display name', async () => {
      prisma.bestSelfProfile.findUnique.mockResolvedValue({
        identityStatement: 'Someone who trains three times a week.',
        workIdentity: null,
        familyIdentity: null,
        healthIdentity: null,
        sixMonthVision: null,
        motivations: [],
      } as never);

      const context = await assembler.assemble(USER, 'coach', NOW);
      const rendered = assembler.renderForPrompt(context);

      // The strongest form of this assertion is on the QUERIES: nothing the
      // assembler selects can contain an address or a name, so nothing it
      // renders can either.
      const selects = [
        prisma.userProfile.findUnique.mock.calls[0][0]!.select,
        prisma.bestSelfProfile.findUnique.mock.calls[0][0]!.select,
      ];
      for (const select of selects) {
        expect(Object.keys(select as object)).not.toContain('email');
        expect(Object.keys(select as object)).not.toContain('displayName');
        expect(Object.keys(select as object)).not.toContain('user');
      }

      expect(rendered).not.toMatch(/@/);
    });
  });

  describe('budget', () => {
    /** Enough history to blow a 12 000-character budget. */
    function stubOversizedHistory(counts = { reflections: 200, evidence: 10 }) {
      const reflections = Array.from({ length: counts.reflections }, (_, i) => ({
        relatedType: 'day',
        createdAt: new Date(NOW.getTime() - i * 60_000),
        userText: `Reflection number ${i} with enough text to matter.`,
        frictionTags: ['tired'],
        mood: 3,
        satisfaction: 3,
      }));
      const evidence = Array.from({ length: counts.evidence }, (_, i) => ({
        evidenceType: 'completion',
        source: 'USER_LOG',
        occurredAt: new Date(NOW.getTime() - i * 60_000),
        quantitativeValue: i,
        quantitativeUnit: 'min',
        qualitativeValue: `Evidence number ${i} with enough text to matter.`,
      }));

      prisma.reflection.findMany.mockResolvedValue(reflections as never);
      prisma.evidence.findMany.mockResolvedValue(evidence as never);
      prisma.commitment.findMany.mockResolvedValue([
        {
          id: 'c1',
          title: 'Strength workout',
          domain: 'HEALTH',
          status: 'PLANNED',
          scheduledStart: NOW,
          fullMinutes: 45,
          minimumMinutes: 10,
          rescheduleCount: 0,
          skipReason: null,
        },
      ] as never);
    }

    it('drops the oldest reflections first and reports what it dropped', async () => {
      stubOversizedHistory();

      const context = await assembler.assemble(USER, 'coach', NOW);

      expect(context.budget.usedChars).toBeLessThanOrEqual(12_000);
      expect(context.budget.truncated[0].section).toBe('recentReflections');
      expect(context.budget.truncated[0].dropped).toBeGreaterThan(0);

      // Oldest-first: whatever survives is a prefix of the newest-first list.
      const kept = context.recentReflections.map((r) => r.userText);
      expect(kept.length).toBeGreaterThan(0);
      expect(kept[0]).toBe('Reflection number 0 with enough text to matter.');
      expect(context.recentEvidence).toHaveLength(10);
    });

    it('moves on to evidence once reflections are exhausted', async () => {
      stubOversizedHistory({ reflections: 40, evidence: 200 });

      const context = await assembler.assemble(USER, 'coach', NOW);

      const sections = context.budget.truncated.map((t) => t.section);
      expect(sections).toEqual(['recentReflections', 'recentEvidence']);
      expect(context.recentReflections).toEqual([]);
      expect(context.recentEvidence.length).toBeGreaterThan(0);
      expect(context.recentEvidence[0].qualitativeValue).toBe(
        'Evidence number 0 with enough text to matter.',
      );
    });

    it('never drops Tier 1 sections to make room', async () => {
      stubOversizedHistory();

      const context = await assembler.assemble(USER, 'coach', NOW);

      // The current plan and today's commitments are what the coach is
      // reasoning ABOUT. A reply without them is wrong, not short.
      expect(context.todayCommitments).toHaveLength(1);
      expect(
        context.budget.truncated.map((t) => t.section),
      ).not.toContain('todayCommitments');
      expect(context.budget.truncated.map((t) => t.section)).not.toContain(
        'activePlans',
      );
    });

    it('truncates deterministically', async () => {
      stubOversizedHistory();

      const first = await assembler.assemble(USER, 'coach', NOW);
      const second = await assembler.assemble(USER, 'coach', NOW);

      expect(assembler.renderForPrompt(first)).toBe(
        assembler.renderForPrompt(second),
      );
      expect(first.budget).toEqual(second.budget);
    });

    it('reports the real rendered length', async () => {
      const context = await assembler.assemble(USER, 'coach', NOW);

      expect(context.budget.usedChars).toBe(
        assembler.renderForPrompt(context).length,
      );
      expect(context.budget.limitChars).toBe(12_000);
    });
  });

  it('rejects rather than returning a partial context when a section fails', async () => {
    prisma.evidence.findMany.mockRejectedValue(new Error('db down') as never);

    // PRD §120: the caller treats this as AI-unavailable and falls back. A
    // context with a hole in it would produce confident advice about a week
    // that did not happen.
    await expect(assembler.assemble(USER, 'coach', NOW)).rejects.toThrow(
      'db down',
    );
  });
});
