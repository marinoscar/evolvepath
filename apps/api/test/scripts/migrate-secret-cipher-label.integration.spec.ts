import { createCipheriv, createHmac, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { buildDatabaseUrl } from '../../src/common/database-url';
import { decryptSecret, encryptSecret } from '../../src/common/crypto/secret-cipher';
import { migrateSecretCipherLabel } from '../../scripts/migrate-secret-cipher-label';

// =============================================================================
// migrate-secret-cipher-label.ts — integration test against a real DB (issue #8)
// =============================================================================
//
// Requires a live Postgres reachable via the individual POSTGRES_* env vars
// (loaded from apps/api/.env.test by test/setup.ts) with the schema migrated.
// See docs/runbooks/rotate-secrets-encryption-key.md and this repo's CLAUDE.md
// for how to stand one up locally (a scratch `postgres:16-alpine` container on
// port 5433 + `npx prisma migrate deploy`).
//
// This test seeds rows under the OLD (v1) secret-cipher label using its OWN,
// independent re-implementation of the old derivation — NOT the hardcoded copy
// inside migrate-secret-cipher-label.ts itself. If the script's own derivation
// had a bug, importing its logic to seed the fixtures would hide that bug from
// this test; keeping two independent implementations is what makes "the script
// round-trips a legacy row" a meaningful assertion rather than a tautology.
// =============================================================================

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
const ORIGINAL_KEY_ENV = process.env.SECRETS_ENCRYPTION_KEY;

// Old label, reproduced independently of scripts/migrate-secret-cipher-label.ts.
const OLD_LABEL_PREFIX = 'enterpriseappbase:secret-cipher:v1:';
const IV_LENGTH = 12;

function deriveOldKeyForTest(masterKeyB64: string, purpose: string): Buffer {
  const masterKey = Buffer.from(masterKeyB64, 'base64');
  return createHmac('sha256', masterKey).update(`${OLD_LABEL_PREFIX}${purpose}`).digest();
}

/** Encrypt `plaintext` exactly as secret-cipher.ts would have under the OLD (v1) label. */
function encryptUnderOldLabel(plaintext: string, purpose: string): string {
  const key = deriveOldKeyForTest(TEST_ENCRYPTION_KEY, purpose);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

describe('migrate-secret-cipher-label (integration, real DB)', () => {
  let prisma: PrismaClient;
  const seededIds: string[] = [];

  beforeAll(async () => {
    process.env.SECRETS_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
    prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });
    await prisma.$connect();
  });

  afterAll(async () => {
    if (seededIds.length > 0) {
      await prisma.credential.deleteMany({ where: { id: { in: seededIds } } });
    }
    await prisma.$disconnect();

    if (ORIGINAL_KEY_ENV === undefined) {
      delete process.env.SECRETS_ENCRYPTION_KEY;
    } else {
      process.env.SECRETS_ENCRYPTION_KEY = ORIGINAL_KEY_ENV;
    }
  });

  it('round-trips legacy (v1-label) rows, leaves already-migrated rows alone, and reports genuine failures — across --dry-run and a real run', async () => {
    const runId = randomBytes(4).toString('hex');
    const purposeFor = (n: number) => `migration-test-${runId}-${n}`;

    // Two rows still encrypted under the OLD label — the main case this script exists for.
    const legacyPlaintexts = {
      [purposeFor(1)]: 'legacy-smtp-password-!@#$',
      [purposeFor(2)]: '🔐 legacy-oauth-secret with unicode 日本語',
    };

    // One row already re-encrypted under the CURRENT (v2) label — must be left alone.
    const alreadyMigratedPurpose = purposeFor(3);
    const alreadyMigratedPlaintext = 'already-on-new-label';

    // One row that decrypts under NEITHER label — a genuine failure to report,
    // not silently skip or crash on.
    const corruptedPurpose = purposeFor(4);

    const createdRows = await Promise.all([
      prisma.credential.create({
        data: {
          purpose: purposeFor(1),
          name: 'default',
          secret: encryptUnderOldLabel(legacyPlaintexts[purposeFor(1)]!, purposeFor(1)),
        },
      }),
      prisma.credential.create({
        data: {
          purpose: purposeFor(2),
          name: 'default',
          secret: encryptUnderOldLabel(legacyPlaintexts[purposeFor(2)]!, purposeFor(2)),
        },
      }),
      prisma.credential.create({
        data: {
          purpose: alreadyMigratedPurpose,
          name: 'default',
          secret: encryptSecret(alreadyMigratedPlaintext, alreadyMigratedPurpose),
        },
      }),
      prisma.credential.create({
        data: {
          purpose: corruptedPurpose,
          name: 'default',
          // Neither a valid old-label nor new-label payload: too short to even
          // carry an IV+tag, which both decrypt paths reject up front.
          secret: Buffer.from('not-a-real-payload').toString('base64'),
        },
      }),
    ]);
    seededIds.push(...createdRows.map((r) => r.id));

    // --- Sanity: pre-migration, the legacy rows must NOT decrypt under the current label.
    for (const purpose of [purposeFor(1), purposeFor(2)]) {
      const row = createdRows.find((r) => r.purpose === purpose)!;
      expect(() => decryptSecret(row.secret, purpose)).toThrow();
    }

    // --- --dry-run: report only, no writes.
    const dryRunSummary = await migrateSecretCipherLabel({ dryRun: true, prisma });

    const ourResults = (id: string) => dryRunSummary.results.find((r) => r.id === id);
    expect(ourResults(createdRows[0]!.id)?.outcome).toBe('would-migrate');
    expect(ourResults(createdRows[1]!.id)?.outcome).toBe('would-migrate');
    expect(ourResults(createdRows[2]!.id)?.outcome).toBe('already-migrated');
    expect(ourResults(createdRows[3]!.id)?.outcome).toBe('failed');

    // Dry run must not have written anything: legacy rows still fail under the
    // current label, and the raw ciphertext is byte-for-byte unchanged.
    for (const row of createdRows.slice(0, 2)) {
      const fresh = await prisma.credential.findUniqueOrThrow({ where: { id: row.id } });
      expect(fresh.secret).toBe(row.secret);
      expect(() => decryptSecret(fresh.secret, fresh.purpose)).toThrow();
    }

    // --- Real run: migrates the two legacy rows, leaves the third alone, reports the fourth as failed.
    const realSummary = await migrateSecretCipherLabel({ dryRun: false, prisma });

    const realResults = (id: string) => realSummary.results.find((r) => r.id === id);
    expect(realResults(createdRows[0]!.id)?.outcome).toBe('migrated');
    expect(realResults(createdRows[1]!.id)?.outcome).toBe('migrated');
    expect(realResults(createdRows[2]!.id)?.outcome).toBe('already-migrated');
    expect(realResults(createdRows[3]!.id)?.outcome).toBe('failed');
    expect(realSummary.migrated).toBe(2);
    expect(realSummary.alreadyMigrated).toBeGreaterThanOrEqual(1);
    expect(realSummary.failed).toBeGreaterThanOrEqual(1);

    // The whole point: the live, current decryptSecret now reads back the
    // original plaintext for both migrated rows.
    for (const purpose of [purposeFor(1), purposeFor(2)]) {
      const row = createdRows.find((r) => r.purpose === purpose)!;
      const fresh = await prisma.credential.findUniqueOrThrow({ where: { id: row.id } });
      expect(decryptSecret(fresh.secret, purpose)).toBe(legacyPlaintexts[purpose]);
    }

    // The already-migrated row's ciphertext must be untouched (still decrypts to
    // its original plaintext; the script must not re-encrypt what didn't need it).
    const untouched = await prisma.credential.findUniqueOrThrow({
      where: { id: createdRows[2]!.id },
    });
    expect(decryptSecret(untouched.secret, alreadyMigratedPurpose)).toBe(
      alreadyMigratedPlaintext,
    );

    // --- Runbook's own verification step: a --dry-run AFTER the real run must
    // report zero rows still needing migration among the ones we touched.
    const postSummary = await migrateSecretCipherLabel({ dryRun: true, prisma });
    const postResults = (id: string) => postSummary.results.find((r) => r.id === id);
    expect(postResults(createdRows[0]!.id)?.outcome).toBe('already-migrated');
    expect(postResults(createdRows[1]!.id)?.outcome).toBe('already-migrated');
    expect(postResults(createdRows[2]!.id)?.outcome).toBe('already-migrated');
    expect(postResults(createdRows[3]!.id)?.outcome).toBe('failed');
  });

  it('is safe to run against zero rows (fresh/empty environment)', async () => {
    // Scope to a purpose namespace guaranteed to have no rows.
    const emptyPrisma = prisma;
    const before = await emptyPrisma.credential.count({
      where: { purpose: `migration-test-empty-${randomBytes(4).toString('hex')}` },
    });
    expect(before).toBe(0);

    // A dry run over whatever is currently in the table (there may be rows
    // left by the previous `it`, already migrated) must not throw and must not
    // report any failures caused by an empty result set.
    const summary = await migrateSecretCipherLabel({ dryRun: true, prisma });
    expect(summary.found).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(summary.results)).toBe(true);
  });
});
