import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { buildDatabaseUrl } from '../../src/common/database-url';

// =============================================================================
// ai_invocations — schema guarantees against a real database (issue #21)
// =============================================================================
//
// Requires a live Postgres reachable via the individual POSTGRES_* env vars
// (loaded from apps/api/.env.test by test/setup.ts) with the schema migrated,
// exactly like test/scripts/migrate-secret-cipher-label.integration.spec.ts.
// That spec is the convention in this repo: DB-backed specs connect for real
// rather than mocking, because the properties under test here — a SET NULL
// foreign key and three Postgres enum types — do not exist anywhere except in
// the database.
//
// WHY THESE THREE ASSERTIONS AND NOTHING ELSE. Everything else about this table
// is exercised by the services that write it (#24, #25, #26). What only the
// database can prove is:
//
//   1. Every nullable column really is nullable — a `test_connection` row for a
//      user key that skipped the generate probe has no model, no tokens and no
//      validation result, and must still insert.
//   2. Deleting a user NULLS the reference instead of deleting the row. This is
//      the one place the schema deliberately departs from the cascade the rest
//      of the product tables use, so it is the one place worth a real DELETE.
//   3. The status enum has exactly the four values the writers switch on. A
//      Prisma-side type check proves the client's view; `pg_enum` proves the
//      database's. They can drift (a hand-applied migration), so both run.
// =============================================================================

describe('ai_invocations (integration, real DB)', () => {
  let prisma: PrismaClient;
  const seededInvocationIds: string[] = [];
  const seededUserIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });
    await prisma.$connect();
  });

  afterAll(async () => {
    if (seededInvocationIds.length > 0) {
      await prisma.aiInvocation.deleteMany({
        where: { id: { in: seededInvocationIds } },
      });
    }
    if (seededUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: seededUserIds } } });
    }
    await prisma.$disconnect();
  });

  it('accepts a row with every nullable column null', async () => {
    const row = await prisma.aiInvocation.create({
      data: {
        operation: 'test_connection',
        keyScope: 'user',
        provider: 'openai',
        status: 'succeeded',
        // The listModels-only probe: no model was named, so nothing about a
        // generation exists to record.
        latencyMs: 0,
      },
    });
    seededInvocationIds.push(row.id);

    expect(row.userId).toBeNull();
    expect(row.persona).toBeNull();
    expect(row.model).toBeNull();
    expect(row.promptVersion).toBeNull();
    expect(row.requestId).toBeNull();
    expect(row.providerRequestId).toBeNull();
    expect(row.errorCode).toBeNull();
    expect(row.errorMessage).toBeNull();
    expect(row.inputTokens).toBeNull();
    expect(row.outputTokens).toBeNull();
    expect(row.cachedInputTokens).toBeNull();
    expect(row.reasoningTokens).toBeNull();
    expect(row.outputValid).toBeNull();
    expect(row.safetyDecision).toBeNull();
    expect(row.input).toBeNull();
    expect(row.output).toBeNull();
    // The two columns that are NOT nullable and have defaults.
    expect(row.latencyMs).toBe(0);
    expect(row.attachmentCount).toBe(0);
  });

  it('survives the deletion of its user with user_id set to NULL', async () => {
    const user = await prisma.user.create({
      data: {
        email: `ai-invocations-${randomBytes(6).toString('hex')}@example.test`,
      },
    });
    seededUserIds.push(user.id);

    const row = await prisma.aiInvocation.create({
      data: {
        operation: 'invoke',
        keyScope: 'user',
        userId: user.id,
        persona: 'coach',
        provider: 'openai',
        model: 'gpt-5.4',
        promptVersion: 'coach.v1',
        status: 'succeeded',
        inputTokens: 42,
        outputTokens: 7,
        latencyMs: 123,
        outputValid: true,
      },
    });
    seededInvocationIds.push(row.id);

    await prisma.user.delete({ where: { id: user.id } });
    seededUserIds.splice(seededUserIds.indexOf(user.id), 1);

    const after = await prisma.aiInvocation.findUnique({
      where: { id: row.id },
    });

    // The cost record outlives the account. Deleted, not orphaned-and-erased.
    expect(after).not.toBeNull();
    expect(after?.userId).toBeNull();
    expect(after?.persona).toBe('coach');
    expect(after?.model).toBe('gpt-5.4');
    expect(after?.inputTokens).toBe(42);
  });

  it('declares exactly the enum values the writers switch on', async () => {
    // Prisma's view. A value added or renamed in schema.prisma without a
    // matching writer update breaks compilation here, not at runtime.
    const statuses: Array<'succeeded' | 'failed' | 'invalid_output' | 'refused'> =
      ['succeeded', 'failed', 'invalid_output', 'refused'];
    const operations: Array<'invoke' | 'test_connection'> = [
      'invoke',
      'test_connection',
    ];
    const scopes: Array<'user' | 'platform'> = ['user', 'platform'];

    // The database's view. These can drift from the client's if a migration is
    // ever hand-applied, which is precisely why both are asserted.
    const rows = await prisma.$queryRaw<Array<{ label: string }>>`
      SELECT e.enumlabel AS label
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'ai_invocation_status'
      ORDER BY e.enumsortorder
    `;

    expect(rows.map((r) => r.label)).toEqual(statuses);
    expect(operations).toHaveLength(2);
    expect(scopes).toHaveLength(2);
  });
});
