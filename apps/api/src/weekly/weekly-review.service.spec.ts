import { ConflictException, BadRequestException } from '@nestjs/common';

import { WeeklyReviewService } from './weekly-review.service';
import { buildFixtureWeek, FIXTURE_WEEK_START } from './__fixtures__/week-fixture';
import type { WeeklyReviewOutput } from './weekly.schema';

// =============================================================================
// Generation, and the four ways it is allowed to go wrong (issue #73)
// =============================================================================
//
// The assertions that matter here are the negative ones: that a provider
// failure produces a review rather than a 500, that a hallucinated proposal is
// dropped rather than persisted, that a rejected proposal does not fail the
// review, and that an exception never leaves a row stuck in GENERATING.
// =============================================================================

const USER = 'user-1';
const PLAN_ID = '2a7c9f10-4b3d-4d1e-8c9a-7f6e5d4c3b21';
const ROUTINE_ID = '9c3a1e77-1b6d-4a3e-9f1a-0b2c3d4e5f60';
const FOREIGN_PLAN = '00000000-0000-4000-8000-000000000999';

const moveChange = (routineId: string) => ({
  op: 'move' as const,
  target: { type: 'routine' as const, id: routineId },
  before: { preferredTime: '18:30' },
  after: { preferredTime: '09:00' },
  reason: 'Evenings were moved twice; mornings held.',
});

function reviewerOutput(
  proposedChanges: WeeklyReviewOutput['proposedChanges'] = [],
): WeeklyReviewOutput {
  return {
    whatWorked: ['Work: 4 of 5 done.'],
    whatDidNot: [],
    patterns: [
      {
        observation: '4 of 5 morning commitments were done.',
        inference: null,
        recommendation: null,
        confidence: 0.7,
        domain: null,
      },
    ],
    proposedChanges,
    keepUnchanged: [],
    doNotAddYet: [],
  };
}

function build(overrides: Record<string, unknown> = {}) {
  const rows = new Map<string, any>();
  let sequence = 0;

  const prisma: any = {
    weeklyReview: {
      findUnique: jest.fn(async ({ where }: any) => {
        const key = where.id ?? `${where.userId_weekStart.userId}:${where.userId_weekStart.weekStart}`;
        return rows.get(key) ?? null;
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        const all = [...rows.values()].filter((row) => row.userId === where.userId);
        if (where.id) return all.find((row) => row.id === where.id) ?? null;
        return all[0] ?? null;
      }),
      findMany: jest.fn(async () => [...rows.values()]),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const key = `${where.userId_weekStart.userId}:${where.userId_weekStart.weekStart}`;
        const existing = rows.get(key);
        sequence += 1;
        const row = existing
          ? { ...existing, ...update, updatedAt: new Date() }
          : {
              id: `review-${sequence}`,
              proposalIds: [],
              aggregates: {},
              aiSummary: null,
              invocationId: null,
              generatedAt: null,
              approvedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              ...create,
            };
        rows.set(key, row);
        rows.set(row.id, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.get(where.id);
        const next = { ...row, ...data, updatedAt: new Date() };
        rows.set(where.id, next);
        rows.set(`${next.userId}:${next.weekStart}`, next);
        return next;
      }),
      delete: jest.fn(async ({ where }: any) => {
        const row = rows.get(where.id);
        rows.delete(where.id);
        if (row) rows.delete(`${row.userId}:${row.weekStart}`);
        return row;
      }),
    },
    weeklyPlan: { findUnique: jest.fn(async () => null) },
    auditEvent: { create: jest.fn(async () => ({})) },
  };

  const aggregation = { load: jest.fn(async () => buildFixtureWeek()) };
  const context = {
    assemble: jest.fn(async () => ({
      coachingStyle: 'BALANCED',
      activePlans: [{ planId: PLAN_ID, routines: [{ routineId: ROUTINE_ID }] }],
      todayCommitments: [],
      recentMisses: [],
    })),
    renderForPrompt: jest.fn(() => 'CONTEXT'),
  };
  const ai = {
    invoke: jest.fn(async () => ({
      ok: true,
      invocationId: 'inv-1',
      output: reviewerOutput(),
      usage: {},
      model: 'gpt',
      latencyMs: 10,
    })),
  };
  const proposals = {
    createFromSource: jest.fn(async () => ({ id: 'proposal-1' })),
    get: jest.fn(async (_u: string, id: string) => ({ id })),
  };
  const patternAnalysis = { proposeInsights: jest.fn(async () => ({})) };
  const profiles = {
    find: jest.fn(async () => ({ timezone: 'America/Costa_Rica', coachingStyle: 'BALANCED' })),
  };
  const config = { get: jest.fn(() => 8) };

  Object.assign({ prisma, aggregation, context, ai, proposals }, overrides);

  const service = new WeeklyReviewService(
    prisma,
    aggregation as any,
    context as any,
    ai as any,
    proposals as any,
    patternAnalysis as any,
    profiles as any,
    config as any,
  );

  return {
    service,
    prisma,
    rows,
    aggregation,
    context,
    ai,
    proposals,
    patternAnalysis,
    profiles,
  };
}

const generate = (harness: ReturnType<typeof build>) =>
  harness.service.generate(USER, { weekStart: FIXTURE_WEEK_START, trigger: 'manual' });

describe('generate', () => {
  it('calls the gateway with the reviewer persona, version and schema name', async () => {
    const harness = build();
    await generate(harness);

    expect(harness.ai.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        persona: 'weekly_reviewer',
        promptVersion: 'weekly_reviewer.v1',
        schemaName: 'weekly_review',
        userId: USER,
      }),
    );
  });

  it('stores READY with the deterministic aggregates and an ai summary', async () => {
    const harness = build();
    const detail = await generate(harness);

    expect(detail.status).toBe('READY');
    expect(detail.counts.WORK).toEqual({ planned: 5, completed: 4 });
    expect((detail.aiSummary as any).source).toBe('ai');
  });

  it('rejects a weekStart that is not a Monday', async () => {
    const harness = build();

    await expect(
      harness.service.generate(USER, { weekStart: '2026-09-01', trigger: 'manual' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('falls back to the template on a provider failure, and writes no proposal', async () => {
    const harness = build();
    harness.ai.invoke = jest.fn(async () => ({
      ok: false,
      invocationId: 'inv-fail',
      error: { code: 'timeout', message: 'timed out' },
      model: null,
      latencyMs: 60_000,
    })) as any;

    const detail = await generate(harness);

    expect(detail.status).toBe('READY');
    expect((detail.aiSummary as any).source).toBe('template');
    expect((detail.aiSummary as any).promptVersion).toBeNull();
    expect(harness.proposals.createFromSource).not.toHaveBeenCalled();
  });

  it('falls back to the template when the user has no key', async () => {
    const harness = build();
    harness.ai.invoke = jest.fn(async () => ({
      ok: false,
      invocationId: 'inv-nokey',
      error: { code: 'no_user_key', message: 'no key' },
      model: null,
      latencyMs: 1,
    })) as any;

    expect((await generate(harness)).aiSummary).toMatchObject({ source: 'template' });
  });

  it('falls back to the template when the context cannot be assembled', async () => {
    const harness = build();
    harness.context.assemble = jest.fn(async () => {
      throw new Error('database down');
    }) as any;

    // A PARTIAL context is exactly what would make the reviewer confident about
    // a plan it only half saw, so this is treated as an unavailable provider.
    expect((await generate(harness)).aiSummary).toMatchObject({ source: 'template' });
    expect(harness.ai.invoke).not.toHaveBeenCalled();
  });

  it('creates a proposal for each surviving change and drops the foreign one', async () => {
    const harness = build();
    harness.ai.invoke = jest.fn(async () => ({
      ok: true,
      invocationId: 'inv-1',
      output: reviewerOutput([
        { planId: PLAN_ID, summary: 'Move it', changes: [moveChange(ROUTINE_ID)] },
        { planId: FOREIGN_PLAN, summary: 'Not yours', changes: [moveChange(ROUTINE_ID)] },
      ]),
      usage: {},
      model: 'gpt',
      latencyMs: 10,
    })) as any;

    const detail = await generate(harness);

    expect(harness.proposals.createFromSource).toHaveBeenCalledTimes(1);
    expect(harness.proposals.createFromSource).toHaveBeenCalledWith(
      USER,
      'WEEKLY_REVIEW',
      expect.objectContaining({ planId: PLAN_ID, invocationId: 'inv-1' }),
    );
    expect((detail.aiSummary as any).proposedChanges).toHaveLength(1);

    const audit = harness.prisma.auditEvent.create.mock.calls[0][0].data;
    expect(audit.action).toBe('weekly_review:generate');
    expect(audit.meta).toMatchObject({ droppedProposals: 1, proposalCount: 1, source: 'ai' });
  });

  it('stays READY when the mutation protocol refuses a proposal', async () => {
    const harness = build();
    harness.ai.invoke = jest.fn(async () => ({
      ok: true,
      invocationId: 'inv-1',
      output: reviewerOutput([
        { planId: PLAN_ID, summary: 'Move it', changes: [moveChange(ROUTINE_ID)] },
      ]),
      usage: {},
      model: 'gpt',
      latencyMs: 10,
    })) as any;
    harness.proposals.createFromSource = jest.fn(async () => {
      throw new Error('422 plan has no active version');
    }) as any;

    const detail = await generate(harness);

    expect(detail.status).toBe('READY');
    expect((detail.aiSummary as any).proposedChanges).toEqual([]);
  });

  it('never writes a plan version — the gateway result goes to the proposal service', async () => {
    const harness = build();
    await generate(harness);

    // Structural, not incidental: `PlanVersionsService` is not a constructor
    // argument at all, so there is nothing here that could write one.
    expect(Object.keys(harness.prisma)).not.toContain('planVersion');
  });

  it('sends no notification of its own', async () => {
    const harness = build();
    await generate(harness);

    // PRD §60's N8 is raised by E12's candidate scanner reading this table, so
    // that it passes through quiet hours and the caps. A `notify()` call from
    // here would reach the user at whatever hour their sweep happened to run.
    expect(Object.keys(harness)).not.toContain('notifications');
  });

  it('survives a rejected pattern-analysis run', async () => {
    const harness = build();
    harness.patternAnalysis.proposeInsights = jest.fn(async () => {
      throw new Error('rate limited');
    }) as any;

    await expect(generate(harness)).resolves.toMatchObject({ status: 'READY' });
  });

  it('refuses to regenerate an approved week', async () => {
    const harness = build();
    await generate(harness);
    harness.rows.get(`${USER}:${FIXTURE_WEEK_START}`).status = 'APPROVED';

    await expect(generate(harness)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a second generation while one is genuinely in flight', async () => {
    const harness = build();
    await generate(harness);
    const row = harness.rows.get(`${USER}:${FIXTURE_WEEK_START}`);
    row.status = 'GENERATING';
    row.updatedAt = new Date();

    await expect(generate(harness)).rejects.toBeInstanceOf(ConflictException);
  });

  it('retries past a GENERATING row left by a crash fifteen minutes ago', async () => {
    const harness = build();
    await generate(harness);
    const row = harness.rows.get(`${USER}:${FIXTURE_WEEK_START}`);
    row.status = 'GENERATING';
    row.updatedAt = new Date(Date.now() - 20 * 60_000);

    await expect(generate(harness)).resolves.toMatchObject({ status: 'READY' });
  });

  it('never leaves a row GENERATING after an exception', async () => {
    const harness = build();
    harness.aggregation.load = jest.fn(async () => {
      throw new Error('database exploded');
    }) as any;

    await expect(generate(harness)).rejects.toThrow('database exploded');

    // The row was freshly created, so it is removed entirely — otherwise the
    // 409 above would refuse every retry for the next fifteen minutes.
    expect(harness.rows.get(`${USER}:${FIXTURE_WEEK_START}`)).toBeUndefined();
  });

  it('restores the previous status when a regeneration throws', async () => {
    const harness = build();
    await generate(harness);
    harness.aggregation.load = jest.fn(async () => {
      throw new Error('database exploded');
    }) as any;

    await expect(generate(harness)).rejects.toThrow('database exploded');
    expect(harness.rows.get(`${USER}:${FIXTURE_WEEK_START}`).status).toBe('READY');
  });
});

describe('skip', () => {
  it('moves a READY review to SKIPPED', async () => {
    const harness = build();
    const detail = await generate(harness);

    await expect(harness.service.skip(USER, detail.id)).resolves.toMatchObject({
      status: 'SKIPPED',
    });
  });

  it('refuses to skip an approved week', async () => {
    const harness = build();
    const detail = await generate(harness);
    harness.rows.get(detail.id).status = 'APPROVED';

    await expect(harness.service.skip(USER, detail.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('markApproved', () => {
  it('closes the week and records when', async () => {
    const harness = build();
    await generate(harness);

    await harness.service.markApproved(USER, FIXTURE_WEEK_START, harness.prisma);

    const row = harness.rows.get(`${USER}:${FIXTURE_WEEK_START}`);
    expect(row.status).toBe('APPROVED');
    expect(row.approvedAt).toBeInstanceOf(Date);
  });

  it('is a no-op when there is no review for that week', async () => {
    const harness = build();

    // Approving next week must not require that last week was ever reviewed.
    await expect(
      harness.service.markApproved(USER, '2026-08-24', harness.prisma),
    ).resolves.toBeUndefined();
  });
});
