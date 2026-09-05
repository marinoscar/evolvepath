import { randomBytes, randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { buildDatabaseUrl } from '../../src/common/database-url';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { AiGatewayService } from '../../src/ai/gateway/ai-gateway.service';
import type { NotificationsService } from '../../src/notifications/notifications.service';
import { ContextAssemblerService } from '../../src/coach/context/context-assembler.service';
import { MemoryInsightsService } from '../../src/coach/memory/memory-insights.service';
import { PatternAnalysisService } from '../../src/coach/memory/pattern-analysis.service';

// =============================================================================
// Memory insights against a real database (issue #78, epic E06)
// =============================================================================
//
// THE ASSERTION THIS SUITE EXISTS FOR is the one that spans two services: after
// a user says "don't use this for coaching", the statement is gone from
// `ContextAssemblerService.assemble(userId, 'coach')`. Both halves are the real
// implementation here, because the promise is a property of the pair — a unit
// test of either one would pass while the pair was broken.
// =============================================================================

const hasDatabase = Boolean(process.env.POSTGRES_HOST ?? process.env.DATABASE_URL);
const describeWithDb = hasDatabase ? describe : describe.skip;

describeWithDb('Memory insights (integration, real DB)', () => {
  let prisma: PrismaClient;
  let insights: MemoryInsightsService;
  let analysis: PatternAnalysisService;
  let assembler: ContextAssemblerService;

  const invoke = jest.fn();
  const notify = jest.fn();
  const seededUserIds: string[] = [];

  const STATEMENT = 'Morning commitments are more reliable than evening ones.';

  async function seedUser() {
    const user = await prisma.user.create({
      data: { email: `memory-${randomBytes(6).toString('hex')}@example.test` },
    });
    seededUserIds.push(user.id);
    return user;
  }

  /** Twelve decided commitments — comfortably over MIN_SAMPLE. */
  async function seedHistory(userId: string) {
    for (let i = 0; i < 12; i += 1) {
      await prisma.commitment.create({
        data: {
          userId,
          domain: 'HEALTH',
          title: 'Strength workout',
          scheduledStart: new Date(Date.now() - (i + 1) * 86_400_000),
          status: i % 4 === 0 ? 'MISSED' : 'COMPLETED',
        },
      });
    }
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });
    await prisma.$connect();

    const service = prisma as unknown as PrismaService;
    insights = new MemoryInsightsService(service);
    assembler = new ContextAssemblerService(service);
    analysis = new PatternAnalysisService(
      service,
      { invoke } as unknown as AiGatewayService,
      { notify } as unknown as NotificationsService,
    );
  });

  afterAll(async () => {
    if (seededUserIds.length > 0) {
      await prisma.auditEvent.deleteMany({
        where: { actorUserId: { in: seededUserIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: seededUserIds } } });
    }
    await prisma.$disconnect();
  });

  beforeEach(() => {
    invoke.mockReset();
    notify.mockReset().mockResolvedValue(undefined);
  });

  // ---------------------------------------------------------------------------
  // The user's controls (PRD §85)
  // ---------------------------------------------------------------------------

  it('stores what the user typed as confirmed, at full confidence', async () => {
    const user = await seedUser();

    const created = await insights.create(user.id, {
      category: 'HEALTH',
      statement: STATEMENT,
    });

    expect(created).toMatchObject({
      source: 'USER',
      userConfirmed: true,
      confidence: 1,
      evidenceCount: 0,
      doNotUse: false,
    });
  });

  it('confirms an AI guess and starts using it', async () => {
    const user = await seedUser();
    const row = await prisma.memoryInsight.create({
      data: {
        userId: user.id,
        category: 'PATTERN',
        statement: STATEMENT,
        confidence: 0.8,
        source: 'AI',
      },
    });

    // Unconfirmed means the coach never sees it (PRD §10.12).
    let context = await assembler.assemble(user.id, 'coach');
    expect(assembler.renderForPrompt(context)).not.toContain(STATEMENT);

    await insights.confirm(user.id, row.id);

    context = await assembler.assemble(user.id, 'coach');
    expect(assembler.renderForPrompt(context)).toContain(STATEMENT);
  });

  it('treats an edit as a confirmation', async () => {
    const user = await seedUser();
    const row = await prisma.memoryInsight.create({
      data: {
        userId: user.id,
        category: 'PATTERN',
        statement: STATEMENT,
        confidence: 0.8,
        source: 'AI',
      },
    });

    // "This, but in my words" is agreement. Leaving it unconfirmed would mean
    // the coach still ignored the sentence the user just wrote.
    const edited = await insights.update(user.id, row.id, 'Mornings work best.');

    expect(edited.statement).toBe('Mornings work best.');
    expect(edited.userConfirmed).toBe(true);
  });

  it('removes a do-not-use insight from the coach’s context immediately', async () => {
    const user = await seedUser();
    const row = await prisma.memoryInsight.create({
      data: {
        userId: user.id,
        category: 'PATTERN',
        statement: STATEMENT,
        confidence: 0.9,
        source: 'AI',
        userConfirmed: true,
      },
    });

    expect(assembler.renderForPrompt(await assembler.assemble(user.id, 'coach')))
      .toContain(STATEMENT);

    await insights.setDoNotUse(user.id, row.id, true);

    // The promise this suite exists for. Both halves are the real thing.
    expect(assembler.renderForPrompt(await assembler.assemble(user.id, 'coach')))
      .not.toContain(STATEMENT);

    // Still true, still visible on the settings page — a different question.
    const stored = await prisma.memoryInsight.findUnique({ where: { id: row.id } });
    expect(stored?.userConfirmed).toBe(true);
    expect(stored?.doNotUse).toBe(true);
    expect(await insights.list(user.id, { includeDoNotUse: true })).toHaveLength(1);
    expect(await insights.list(user.id)).toHaveLength(0);
  });

  it('forgets hard, and audits the category only', async () => {
    const user = await seedUser();
    const created = await insights.create(user.id, {
      category: 'HEALTH',
      statement: STATEMENT,
    });

    await insights.remove(user.id, created.id);

    expect(
      await prisma.memoryInsight.findUnique({ where: { id: created.id } }),
    ).toBeNull();

    const audit = await prisma.auditEvent.findFirst({
      where: { actorUserId: user.id, action: 'memory_insight:forget' },
    });

    // PRD §86: the user asked us to forget the sentence. Copying it into an
    // audit table is not forgetting it.
    expect(audit?.meta).toEqual({ category: 'HEALTH' });
    expect(JSON.stringify(audit?.meta)).not.toContain('Morning');
  });

  it('writes an audit row for every control', async () => {
    const user = await seedUser();
    const created = await insights.create(user.id, {
      category: 'PATTERN',
      statement: STATEMENT,
    });

    await insights.update(user.id, created.id, 'Mornings work best.');
    await insights.confirm(user.id, created.id);
    await insights.setDoNotUse(user.id, created.id, true);
    await insights.remove(user.id, created.id);

    const actions = await prisma.auditEvent.findMany({
      where: { actorUserId: user.id },
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    });

    expect(actions.map((a) => a.action)).toEqual([
      'memory_insight:create',
      'memory_insight:edit',
      'memory_insight:confirm',
      'memory_insight:do_not_use',
      'memory_insight:forget',
    ]);
  });

  it("answers 404 for someone else's insight, never 403", async () => {
    const mine = await seedUser();
    const theirs = await seedUser();

    const created = await insights.create(mine.id, {
      category: 'PATTERN',
      statement: STATEMENT,
    });

    for (const call of [
      () => insights.confirm(theirs.id, created.id),
      () => insights.update(theirs.id, created.id, 'mine now'),
      () => insights.setDoNotUse(theirs.id, created.id, true),
      () => insights.remove(theirs.id, created.id),
    ]) {
      await expect(call()).rejects.toThrow(NotFoundException);
    }
  });

  // ---------------------------------------------------------------------------
  // The proposer
  // ---------------------------------------------------------------------------

  describe('propose', () => {
    it('skips without a model call when there is too little history', async () => {
      const user = await seedUser();

      expect(await analysis.proposeInsights(user.id)).toEqual({
        created: [],
        skipped: 'insufficient_data',
      });
      expect(invoke).not.toHaveBeenCalled();
    });

    it('creates unconfirmed insights the coach cannot yet see', async () => {
      const user = await seedUser();
      await seedHistory(user.id);

      invoke.mockResolvedValue({
        ok: true,
        invocationId: randomUUID(),
        output: {
          insights: [
            {
              category: 'PATTERN',
              statement: STATEMENT,
              observation: '9 of 12 kept commitments were before noon.',
              evidenceCount: 12,
              confidence: 0.75,
            },
          ],
        },
        usage: {},
        model: 'gpt-5.4',
        latencyMs: 1,
      });

      const result = await analysis.proposeInsights(user.id);

      expect(result.created).toHaveLength(1);
      expect(result.created[0].userConfirmed).toBe(false);
      expect(result.created[0].expiresAt).not.toBeNull();

      // Proposed, not adopted: the coach still knows nothing about it.
      const context = await assembler.assemble(user.id, 'coach');
      expect(assembler.renderForPrompt(context)).not.toContain(STATEMENT);

      expect(notify).toHaveBeenCalledWith('memory.insight_proposed', user.id, {
        count: 1,
      });
    });

    it('never re-proposes something the user excluded', async () => {
      const user = await seedUser();
      await seedHistory(user.id);
      await prisma.memoryInsight.create({
        data: {
          userId: user.id,
          category: 'PATTERN',
          statement: STATEMENT,
          confidence: 0.8,
          source: 'AI',
          doNotUse: true,
        },
      });

      invoke.mockResolvedValue({
        ok: true,
        invocationId: randomUUID(),
        output: {
          insights: [
            {
              category: 'PATTERN',
              statement: STATEMENT.toUpperCase(),
              observation: 'x',
              evidenceCount: 12,
              confidence: 0.75,
            },
          ],
        },
        usage: {},
        model: 'gpt-5.4',
        latencyMs: 1,
      });

      const result = await analysis.proposeInsights(user.id);

      // "Don't use this" is an answer. Re-asking would be the product ignoring
      // it — and casing must not be a way around that.
      expect(result.created).toEqual([]);
      expect(
        await prisma.memoryInsight.count({ where: { userId: user.id } }),
      ).toBe(1);
      expect(notify).not.toHaveBeenCalled();
    });

    it('degrades rather than failing when the provider is down', async () => {
      const user = await seedUser();
      await seedHistory(user.id);
      invoke.mockResolvedValue({
        ok: false,
        invocationId: randomUUID(),
        error: { code: 'timeout', message: 'slow' },
        model: null,
        latencyMs: 1,
      });

      expect(await analysis.proposeInsights(user.id)).toEqual({
        created: [],
        skipped: 'ai_unavailable',
      });
    });
  });
});
