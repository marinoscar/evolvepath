import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { buildDatabaseUrl } from '../../src/common/database-url';
import { AiInvocationLogService } from '../../src/ai/gateway/ai-invocation-log.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import type { SafetyDecision } from '../../src/coach/safety/safety.types';

// =============================================================================
// `ai_invocations.safety_decision` against a real database (issue #82)
// =============================================================================
//
// PRD §88 asks for the safety decision to be logged. The unit spec proves the
// service passes the object along; only a real database proves the COLUMN can
// hold it — which is the thing that changed in this issue. It started as
// `text`, and a `SafetyDecision` written to a text column would either fail or,
// worse, land as "[object Object]" and answer every future audit query with
// null.
// =============================================================================

describe('ai_invocations.safety_decision (integration, real DB)', () => {
  let prisma: PrismaClient;
  let service: AiInvocationLogService;
  const seededIds: string[] = [];

  const decision: SafetyDecision = {
    decision: 'conservative',
    category: 'injury',
    userFacingNote: "I've kept this cautious.",
    source: 'model',
    matchedRule: 'injury.hurts',
    promptVersion: 'safety.v1',
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });
    await prisma.$connect();
    service = new AiInvocationLogService(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    if (seededIds.length > 0) {
      await prisma.aiInvocation.deleteMany({ where: { id: { in: seededIds } } });
    }
    await prisma.$disconnect();
  });

  const record = (over: Record<string, unknown> = {}) => {
    const invocationId = randomBytes(16).toString('hex').replace(
      /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
      '$1-$2-$3-$4-$5',
    );
    seededIds.push(invocationId);

    return {
      invocationId,
      operation: 'invoke' as const,
      keyScope: 'user' as const,
      userId: null,
      persona: 'coach',
      provider: 'openai',
      model: 'gpt-5.4',
      promptVersion: 'coach.v1',
      requestId: null,
      providerRequestId: null,
      status: 'succeeded' as const,
      errorCode: null,
      errorMessage: null,
      inputTokens: 1,
      outputTokens: 2,
      cachedInputTokens: null,
      reasoningTokens: null,
      latencyMs: 10,
      outputValid: true,
      attachmentCount: 0,
      input: null,
      output: null,
      ...over,
    };
  };

  it('persists a SafetyDecision and reads its keys back', async () => {
    const row = record({ safetyDecision: decision });
    await service.record(row);

    const stored = await prisma.aiInvocation.findUnique({
      where: { id: row.invocationId },
    });

    expect(stored?.safetyDecision).toEqual(decision);
  });

  it('is queryable by key, which is the point of the jsonb column', async () => {
    const row = record({ safetyDecision: decision });
    await service.record(row);

    // The epic's manual verification runs exactly this shape of query. A text
    // column would make `->>` an error rather than an answer.
    const [found] = await prisma.$queryRawUnsafe<
      Array<{ decision: string; source: string }>
    >(
      `select safety_decision->>'decision' as decision,
              safety_decision->>'source'   as source
         from ai_invocations where id = $1::uuid`,
      row.invocationId,
    );

    expect(found).toEqual({ decision: 'conservative', source: 'model' });
  });

  it('leaves the column null when no decision governed the call', async () => {
    const row = record();
    await service.record(row);

    const stored = await prisma.aiInvocation.findUnique({
      where: { id: row.invocationId },
    });

    // Null means "nothing evaluated this", which is a different fact from
    // "evaluated and allowed" — the audit needs to tell them apart.
    expect(stored?.safetyDecision).toBeNull();
  });
});
