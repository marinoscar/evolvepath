// =============================================================================
// One-time re-encryption migration: secret-cipher label v1 -> v2 (issue #8)
// =============================================================================
//
// secret-cipher.ts's SUBKEY_LABEL_PREFIX moved from
// 'enterpriseappbase:secret-cipher:v1:' to 'evolvepath:secret-cipher:v2:'.
// Because deriveKey(purpose) = HMAC-SHA256(masterKey, LABEL_PREFIX + purpose),
// that change alone makes every ciphertext written under the old label
// permanently undecryptable. This script re-encrypts every affected row:
// decrypt under the OLD label, re-encrypt under the CURRENT label (via the
// live, exported `encryptSecret`), write the new ciphertext back.
//
// The only table this touches is `credentials` (Prisma model `Credential`,
// apps/api/prisma/schema.prisma), the sole caller of `encryptSecret` in this
// codebase (apps/api/src/credentials/credentials.service.ts). If a second
// consumer of secret-cipher.ts is ever added, this script needs a matching
// second migration pass for its table.
//
// Run with:
//   npm run migrate:secret-cipher --workspace=api
//   npm run migrate:secret-cipher --workspace=api -- --dry-run
//
// Operational order (see docs/runbooks/rotate-secrets-encryption-key.md):
//   1. Deploy the code containing both the new SUBKEY_LABEL_PREFIX and this
//      script.
//   2. Before (or immediately after, in a short maintenance window) any
//      process attempts to decrypt an existing secret under the new label,
//      run this script once (no --dry-run).
//   3. Confirm `--dry-run` reports 0 rows still on the old label afterward.
//
// THIS SCRIPT MUST NOT LOG plaintext secret values, key material (master key
// or any derived sub-key), or raw ciphertext payloads — the same discipline
// secret-cipher.ts's own header enforces. Only row ids, `purpose`, `name`,
// and pass/fail outcomes may ever appear in output.
//
// WHY THE OLD LABEL LIVES ONLY HERE: secret-cipher.ts's own comment on
// SUBKEY_LABEL_PREFIX says the string "must only move together with a
// re-encryption migration" — this script IS that migration, and it is the
// one place in the whole codebase allowed to know what the label used to be.
// Production code (secret-cipher.ts) carries only the CURRENT label.
// =============================================================================

import { createDecipheriv, createHmac } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { buildDatabaseUrl } from '../src/common/database-url';
import {
  assertEncryptionKeyConfigured,
  decryptSecret,
  encryptSecret,
} from '../src/common/crypto/secret-cipher';

/** Hardcoded, standalone copy — see the file header for why this belongs ONLY here. */
const OLD_SUBKEY_LABEL_PREFIX = 'enterpriseappbase:secret-cipher:v1:';

/** Mirrors secret-cipher.ts's payload layout: [iv:12][authTag:16][ciphertext]. */
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// ---------------------------------------------------------------------------
// Old-label crypto primitives (deliberately re-implemented, not imported)
// ---------------------------------------------------------------------------
//
// secret-cipher.ts exports only encrypt/decrypt UNDER ITS CURRENT LABEL — by
// design, there is no way to ask it "decrypt under a different, older label".
// So this script carries its own minimal derive+decrypt pair, scoped to the
// old label alone, used only to read a legacy row's plaintext into memory
// just long enough to hand it to the real, current `encryptSecret`.

/** Reproduces secret-cipher.ts's `deriveKey`, but against the OLD label. */
function deriveOldKey(masterKey: Buffer, purpose: string): Buffer {
  return createHmac('sha256', masterKey)
    .update(`${OLD_SUBKEY_LABEL_PREFIX}${purpose}`)
    .digest();
}

/**
 * Reproduces secret-cipher.ts's `decryptSecret`, parameterized by an
 * explicit key instead of the module's own (current-label) derived one.
 *
 * @throws if the payload is too short or authentication fails (tampered,
 *         wrong key, or simply not a v1 payload — e.g. already migrated).
 */
function decryptWithKey(payload: string, key: Buffer): string {
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error(
      `Malformed encrypted payload: expected at least ${
        IV_LENGTH + AUTH_TAG_LENGTH
      } bytes, got ${buf.length}.`,
    );
  }

  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv('aes-256-gcm', key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    'utf8',
  );
}

/**
 * The master key bytes, for deriving the OLD-label sub-key ourselves.
 *
 * `assertEncryptionKeyConfigured()` runs the module's own validation first
 * (present, valid base64, decodes to exactly 32 bytes) and throws the same
 * operator-facing error `encryptSecret`/`decryptSecret` would. Once that has
 * passed, decoding here is guaranteed to reproduce the exact same bytes
 * secret-cipher.ts's own `getMasterKey()` cached internally, since both are
 * pure functions of the same trimmed env var string.
 */
function getMasterKeyBytes(): Buffer {
  assertEncryptionKeyConfigured();
  return Buffer.from(process.env.SECRETS_ENCRYPTION_KEY!.trim(), 'base64');
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export type RowOutcome =
  | 'migrated'
  | 'already-migrated'
  | 'would-migrate'
  | 'failed';

export interface RowResult {
  id: string;
  purpose: string;
  name: string;
  outcome: RowOutcome;
  /** Present only when outcome === 'failed'. Never contains secret/key material. */
  error?: string;
}

export interface MigrationSummary {
  /** Total credential rows examined. */
  found: number;
  /** Rows re-encrypted under the new label this run (0 for --dry-run). */
  migrated: number;
  /** Rows that already decrypt under the current label — nothing to do. */
  alreadyMigrated: number;
  /** --dry-run only: rows that WOULD be migrated by a real run. */
  wouldMigrate: number;
  /** Rows that decrypted under neither the old nor the new label. */
  failed: number;
  results: RowResult[];
}

export interface MigrateOptions {
  /** Report what would happen without writing anything. Default: false. */
  dryRun?: boolean;
  /**
   * Inject a PrismaClient (e.g. a test's own connection). When omitted, this
   * function creates and disconnects its own, exactly like the CLI entry
   * point does.
   */
  prisma?: PrismaClient;
}

/**
 * Re-encrypt every `credential` row still under the old (v1) secret-cipher
 * label so it decrypts under the current (v2) one.
 *
 * Each row is handled independently: one row's failure is recorded and does
 * not stop, corrupt, or skip any other row (see the per-row try/catch below).
 * A real (non-dry-run) migration re-reads and updates each row inside its own
 * `$transaction`, so a crash mid-run can never leave a row half-written.
 */
export async function migrateSecretCipherLabel(
  options: MigrateOptions = {},
): Promise<MigrationSummary> {
  const dryRun = options.dryRun ?? false;
  const ownsClient = options.prisma === undefined;
  const prisma =
    options.prisma ??
    new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });

  const masterKey = getMasterKeyBytes();

  const rows = await prisma.credential.findMany({
    select: { id: true, purpose: true, name: true, secret: true },
    orderBy: { id: 'asc' },
  });

  const summary: MigrationSummary = {
    found: rows.length,
    migrated: 0,
    alreadyMigrated: 0,
    wouldMigrate: 0,
    failed: 0,
    results: [],
  };

  for (const row of rows) {
    const outcome = await migrateOneRow(prisma, masterKey, row, dryRun);
    summary.results.push(outcome);

    switch (outcome.outcome) {
      case 'migrated':
        summary.migrated++;
        break;
      case 'already-migrated':
        summary.alreadyMigrated++;
        break;
      case 'would-migrate':
        summary.wouldMigrate++;
        break;
      case 'failed':
        summary.failed++;
        break;
    }
  }

  if (ownsClient) {
    await prisma.$disconnect();
  }

  return summary;
}

/**
 * Handle exactly one row. Never throws — every failure is captured into the
 * returned `RowResult` so the caller's loop is guaranteed to visit every row
 * regardless of what happened to the previous one.
 */
async function migrateOneRow(
  prisma: PrismaClient,
  masterKey: Buffer,
  row: { id: string; purpose: string; name: string; secret: string },
  dryRun: boolean,
): Promise<RowResult> {
  const identity = { id: row.id, purpose: row.purpose, name: row.name };

  try {
    // Already on the current label? Nothing to do. Checked first so a
    // second run of this script (or a row nobody ever wrote under v1) is a
    // safe no-op rather than a reported failure.
    if (isAlreadyOnCurrentLabel(row.secret, row.purpose)) {
      return { ...identity, outcome: 'already-migrated' };
    }

    const oldKey = deriveOldKey(masterKey, row.purpose);
    const plaintext = decryptWithKey(row.secret, oldKey);

    if (dryRun) {
      return { ...identity, outcome: 'would-migrate' };
    }

    // Re-fetch-and-write inside a transaction: guards against another writer
    // changing this row between our initial findMany and this update, and
    // ensures the read-decrypt-reencrypt-write for THIS row is all-or-nothing.
    await prisma.$transaction(async (tx) => {
      const current = await tx.credential.findUniqueOrThrow({
        where: { id: row.id },
        select: { id: true, purpose: true, secret: true },
      });

      // Re-derive from the freshly-read row rather than trusting the
      // outer-scope `plaintext`/`oldKey`, in case another writer touched this
      // row (unlikely, but the transaction exists precisely to not assume it
      // can't happen).
      const freshOldKey = deriveOldKey(masterKey, current.purpose);
      const freshPlaintext = decryptWithKey(current.secret, freshOldKey);
      const reencrypted = encryptSecret(freshPlaintext, current.purpose);

      await tx.credential.update({
        where: { id: current.id },
        data: { secret: reencrypted },
      });
    });

    return { ...identity, outcome: 'migrated' };
  } catch (err) {
    return {
      ...identity,
      outcome: 'failed',
      // Length/type-only detail from a caught error, matching secret-cipher.ts's
      // own no-plaintext-in-errors discipline. decryptWithKey/decryptSecret never
      // put plaintext or key material into their thrown messages, so this is safe
      // to surface, but we still never touch `err.stack` or any `cause` chain.
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/** True if `payload` already decrypts under the module's CURRENT label. */
function isAlreadyOnCurrentLabel(payload: string, purpose: string): boolean {
  try {
    decryptSecret(payload, purpose);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function printSummary(summary: MigrationSummary, dryRun: boolean): void {
  const lines = [
    '',
    `Secret-cipher label migration (v1 -> v2)${dryRun ? ' [DRY RUN]' : ''}`,
    `  Rows found:            ${summary.found}`,
    `  Already on new label:  ${summary.alreadyMigrated}`,
    dryRun
      ? `  Would migrate:         ${summary.wouldMigrate}`
      : `  Migrated this run:     ${summary.migrated}`,
    `  Failed:                ${summary.failed}`,
    '',
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));

  if (summary.failed > 0) {
    // eslint-disable-next-line no-console
    console.error('Failures (id / purpose / name / reason):');
    for (const result of summary.results) {
      if (result.outcome === 'failed') {
        // eslint-disable-next-line no-console
        console.error(
          `  - ${result.id} / ${result.purpose} / ${result.name}: ${result.error}`,
        );
      }
    }
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.slice(2).includes('--dry-run');

  const summary = await migrateSecretCipherLabel({ dryRun });
  printSummary(summary, dryRun);

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

// Only run when invoked directly (`npx ts-node .../migrate-secret-cipher-label.ts`
// or the `migrate:secret-cipher` npm script) — not when imported by a test.
if (require.main === module) {
  main().catch((err) => {
    // Top-level failure before/outside the per-row loop (e.g. missing/invalid
    // SECRETS_ENCRYPTION_KEY, or no database connection). `err.message` for a
    // key-config error is operator-facing text with no key material (see
    // secret-cipher.ts's `keyConfigError`); nothing else is printed.
    // eslint-disable-next-line no-console
    console.error(
      `Migration aborted: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
    process.exitCode = 1;
  });
}
