import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

import type { RequestUser } from '../auth/interfaces/authenticated-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { UserAiKeyService } from '../ai/user-key/user-ai-key.service';
import { ObjectsService } from '../storage/objects/objects.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AccountDataResetEmailData } from '../email/templates/account-data-reset.email';
import {
  ACCOUNT_RESET_PHRASES,
  ACCOUNT_RESET_TABLES,
  CUSTOM_EXERCISES_TABLE,
  MEDIA_ATTACHMENTS_TABLE,
  STORAGE_OBJECTS_TABLE,
  type AccountResetScope,
} from './account-reset.constants';
import type { AccountDataSummary } from './dto/account-data-summary.dto';
import type { AccountResetResult } from './dto/account-reset-result.dto';

/**
 * The narrow slice of a Prisma model delegate `ACCOUNT_RESET_TABLES` needs: a
 * per-user `count` and a per-user `deleteMany`.
 *
 * Every entry in that constant names a model that satisfies this — each has a
 * real, indexed `userId` column — so this interface is a STRUCTURAL PROMISE
 * about that constant's contents rather than a separate thing that could drift
 * from it. If a future entry named a model with no `userId`, the
 * `deleteMany({ where: { userId } })` below would fail to compile, which is why
 * this stays a real interface instead of `unknown`.
 */
interface UserScopedDelegate {
  count(args: { where: { userId: string } }): Promise<number>;
  deleteMany(args: { where: { userId: string } }): Promise<{ count: number }>;
}

/**
 * Resolve one `ACCOUNT_RESET_TABLES` entry's Prisma accessor off whichever
 * client is calling — `this.prisma` for a read-only `count` (`summarize`), or
 * the interactive transaction's `tx` for a `deleteMany` (`reset`).
 *
 * `client: unknown` DELIBERATELY, rather than `PrismaService |
 * Prisma.TransactionClient`. Prisma's generated interactive-transaction
 * parameter has no exported standalone type this module can name without
 * reaching into generated internals, and typing this on `PrismaService` alone
 * would refuse the `tx` client `reset` has to pass. The real type safety is
 * `UserScopedDelegate` on the RETURN side: every caller already knows, from the
 * constant it is iterating, that `entry.model` names a real model with a
 * `userId` column, and this cast is where that knowledge is spent.
 */
function delegateFor(client: unknown, model: string): UserScopedDelegate {
  return (client as Record<string, UserScopedDelegate>)[model];
}

// =============================================================================
// AccountResetService — self-service account data reset (epic #220)
// =============================================================================
//
// The "Danger zone" backend: a read-only preview of what a reset would touch
// (`summarize`) and the destructive action itself (`reset`). Both act on ONE
// user's rows and take that user from the caller — see `account.controller.ts`'s
// header for the "no route accepts a user id" discipline this module shares
// with every other caller-scoped surface in this API.
//
// -----------------------------------------------------------------------------
// THIS IS NOT ACCOUNT DELETION
// -----------------------------------------------------------------------------
//
// The `users` row survives every scope this service offers, and so does the
// caller's ability to keep using the app immediately afterwards. `data_and_key`
// erases the stored OpenAI key too, but the account, its OAuth identity, its
// roles and its sign-in are untouched. That is a deliberately NARROWER promise
// than "delete my account", and it is why the following are conspicuously
// absent from `ACCOUNT_RESET_TABLES`. Each is an argument, not an oversight:
//
//   - `refresh_tokens` — SESSION state, not data. This feature is scoped to
//     what a user has BUILT: outcomes, plans, commitments, evidence, coach
//     history. Deleting these would silently sign the caller — and every other
//     device they are signed in on — out as a SIDE EFFECT of a data reset.
//     That is a materially different, separately named action this codebase
//     already has (`POST /api/auth/logout-all`), and not one a caller asked for
//     by typing "DELETE MY DATA". Someone finishing a reset should land back in
//     the app, not on the sign-in screen.
//
//   - `push_subscriptions` — a DEVICE registration, not data. Re-granting a
//     browser notification permission is a prompt this application cannot
//     re-issue if the user refuses it, so dropping the registration risks
//     costing them notifications permanently in exchange for nothing they
//     asked for.
//
//   - `audit_events` — the OPERATOR'S record, not the user's own data. THIS
//     VERY METHOD writes an `account:reset` row to that table as its own
//     accountability record (step 5 below); a reset able to prune it would let
//     a caller destroy the evidence that a destructive action ever happened,
//     which defeats the reason the table exists. It would also erase every
//     OTHER admin action ever taken on this account — role changes,
//     deactivations — which belong to the administrators who performed them and
//     to nobody's self-service delete button.
//
//   - `ai_invocations` — its own schema comment settles this: "SetNull, not
//     Cascade. See the header: a deleted account must not erase the cost
//     record." A reset KEEPS the account, so it is strictly weaker than the
//     deletion that comment is written about, and has less claim on those rows
//     than the case already ruled out.
//
//   - `notification_deliveries` — likewise, from its own schema comment: a
//     PII purge of these rows is "a deliberate, targeted scrub ... not
//     something an ON DELETE clause should do silently and irreversibly as a
//     side effect of an unrelated user-deletion path elsewhere in the app."
//     This method is exactly the "elsewhere in the app" that comment warns off.
//
//   - `allowed_emails` — the account's access itself, which survives.
//
//   - Catalog `exercises` (`scope = 'catalog'`) — shared content with no owner.
//     Only the caller's own `isCustom` rows go.
//
// `personal_access_tokens` and `device_codes` DO go, and the distinction from
// `refresh_tokens` above is deliberate rather than inconsistent: a PAT is a
// long-lived credential the user deliberately minted and would otherwise still
// be able to read a freshly rebuilt account with, and a pending device code
// could mint a fresh one moments after the wipe. Neither is the login the
// caller is currently holding.
// =============================================================================

@Injectable()
export class AccountResetService {
  private readonly logger = new Logger(AccountResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userAiKeys: UserAiKeyService,
    private readonly objects: ObjectsService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * What a reset would touch, without touching anything.
   *
   * One `count({ where: { userId } })` per `ACCOUNT_RESET_TABLES` entry, run in
   * parallel, plus the custom-exercise, storage-object and media-attachment
   * counts — keyed exactly the way `reset`'s own result is keyed, so the
   * "Danger zone" screen and the confirmation that follows read one shape.
   *
   * `coach_messages`, `set_logs`, `workout_templates`,
   * `workout_template_exercises` and `storage_object_chunks` are NOT counted,
   * matching `ACCOUNT_RESET_TABLES`' own omission of them: each cascades from a
   * parent already counted here, so counting them separately would either
   * double-count the same deletions from the reader's point of view or ask them
   * to mentally subtract rows nobody mentioned.
   */
  async summarize(userId: string): Promise<AccountDataSummary> {
    const counts: Record<string, number> = {};

    await Promise.all([
      ...ACCOUNT_RESET_TABLES.map(async (entry) => {
        counts[entry.table] = await delegateFor(this.prisma, entry.model).count({
          where: { userId },
        });
      }),
      (async () => {
        counts[CUSTOM_EXERCISES_TABLE] = await this.prisma.exercise.count({
          where: { createdByUserId: userId, isCustom: true },
        });
      })(),
      (async () => {
        counts[STORAGE_OBJECTS_TABLE] = await this.prisma.storageObject.count({
          where: { uploadedById: userId },
        });
      })(),
      (async () => {
        counts[MEDIA_ATTACHMENTS_TABLE] =
          await this.prisma.mediaAttachment.count({ where: { userId } });
      })(),
    ]);

    return { counts, phrases: ACCOUNT_RESET_PHRASES };
  }

  /**
   * Erase this user's own data — and, on `scope: 'data_and_key'`, their own
   * stored OpenAI key too. Irreversible.
   *
   * Six steps, in this exact order, and the order is the load-bearing part:
   *
   *   1. Verify the confirmation phrase. Nothing below runs on a mismatch.
   *   2. Delete storage objects — network I/O, outside any transaction.
   *   3. Delete every `ACCOUNT_RESET_TABLES` row, in one DB transaction.
   *   4. On `data_and_key`, purge the caller's stored OpenAI key.
   *   5. Write the audit event — AFTER destruction, not before or during.
   *   6. Notify the caller by email.
   */
  async reset(
    user: RequestUser,
    scope: AccountResetScope,
    confirmationPhrase: string,
  ): Promise<AccountResetResult> {
    const userId = user.id;

    // -------------------------------------------------------------------------
    // 1. THE PHRASE IS CHECKED FIRST, BEFORE A SINGLE ROW IS TOUCHED
    // -------------------------------------------------------------------------
    //
    // See `ACCOUNT_RESET_PHRASES`' own comment for why this is verified
    // server-side at all rather than left to a disabled button. `.trim()` only
    // — never case-insensitive, never fuzzy — because the whole point of a
    // typed phrase is that it proves the caller read and reproduced the exact
    // word "DELETE", and a comparison that forgave a wrong case would prove
    // something weaker than that.
    //
    // This runs before anything else and unconditionally: on a mismatch no
    // transaction is opened, no object is touched, and the method throws.
    const expectedPhrase = ACCOUNT_RESET_PHRASES[scope];
    if (confirmationPhrase.trim() !== expectedPhrase) {
      throw new BadRequestException(
        `The confirmation phrase did not match. Type "${expectedPhrase}" exactly to continue.`,
      );
    }

    // -------------------------------------------------------------------------
    // 2. STORAGE OBJECTS FIRST, OUTSIDE ANY TRANSACTION
    // -------------------------------------------------------------------------
    //
    // Deleting a blob is a call to the storage provider — real network I/O with
    // its own latency and its own failure modes, and a Postgres transaction
    // must not wrap around either. Holding a transaction open across a round
    // trip holds row locks for as long as that call takes, which would turn
    // "the reset is a little slow" into "the reset is blocking every reader of
    // thirty tables for however long the provider takes to time out".
    //
    // `ObjectsService.delete` IS REUSED rather than a direct
    // `prisma.storageObject.deleteMany`, deliberately: it is what actually
    // removes the bytes from the provider, finds and deletes derived children
    // (video frames, the normalised AI variant — located by
    // `metadata.derivedFrom`, which has no foreign key), and lets
    // `storage_object_chunks` and `media_attachments` cascade. A raw
    // `deleteMany` here would delete the METADATA and leave every uploaded file
    // behind forever: unreachable, still stored, and still counted against
    // `STORAGE_USER_QUOTA_BYTES`.
    //
    // It is called with the caller's OWN `RequestUser`, so it takes the
    // ordinary self-delete path that method already serves rather than any
    // cross-user override. That is why this method takes a `RequestUser` and
    // not a bare id.
    const ownedObjects = await this.prisma.storageObject.findMany({
      where: { uploadedById: userId },
      select: { id: true },
    });

    let storageObjectsDeleted = 0;
    for (const { id } of ownedObjects) {
      await this.objects.delete(id, user);
      storageObjectsDeleted += 1;
    }

    // -------------------------------------------------------------------------
    // 3. ONE INTERACTIVE TRANSACTION, EVERY OTHER TABLE
    // -------------------------------------------------------------------------
    //
    // `ACCOUNT_RESET_TABLES`' own header is the reference for WHY this specific
    // order — the `SetNull` argument and the `Restrict` argument, which fail
    // differently — rather than restating it here.
    //
    // `{ timeout: 30_000 }`: the DEFAULT interactive-transaction timeout (5s)
    // is sized for ordinary request handlers, not for a caller with a year of
    // history across thirty-one tables. 30 seconds is generous headroom for the
    // slowest realistic account without leaving a runaway transaction open
    // indefinitely if something is genuinely wrong.
    const deleted: Record<string, number> = {
      [STORAGE_OBJECTS_TABLE]: storageObjectsDeleted,
    };

    await this.prisma.$transaction(
      async (tx) => {
        for (const entry of ACCOUNT_RESET_TABLES) {
          const result = await delegateFor(tx, entry.model).deleteMany({
            where: { userId },
          });
          deleted[entry.table] = result.count;

          // The custom-exercise delete is positioned by the constant, not by
          // this loop: it must run after `workout_programs` and
          // `workout_sessions` (whose cascades clear the `Restrict` references
          // from `workout_template_exercises` and `set_logs`) and it cannot
          // ride the generic delegate above, because its ownership column is
          // `createdByUserId` rather than `userId` and its catalog rows belong
          // to nobody. Running it right after `outcomes` satisfies both.
          if (entry.table === 'outcomes') {
            const exercises = await tx.exercise.deleteMany({
              where: { createdByUserId: userId, isCustom: true },
            });
            deleted[CUSTOM_EXERCISES_TABLE] = exercises.count;
          }
        }
      },
      { timeout: 30_000 },
    );

    // `media_attachments` is reported from the storage sweep rather than
    // counted again here: every attachment row cascades from the
    // `storage_objects` row `ObjectsService.delete` already removed, so a
    // second count at this point is always zero and would read as "nothing was
    // deleted" for something that was.
    deleted[MEDIA_ATTACHMENTS_TABLE] = storageObjectsDeleted;

    // `user_profiles` and `user_settings` are deliberately not recreated here.
    // Both are lazily recreated at their defaults the next time they are read,
    // so deleting the row already IS the reset for each; writing a fresh
    // default row back would be redundant work racing whichever read happens
    // first.

    // -------------------------------------------------------------------------
    // 4. THE OPENAI KEY, ONLY ON `data_and_key`
    // -------------------------------------------------------------------------
    //
    // The credential lives at `(purpose 'ai:openai:user', name <userId>)` in
    // `credentials`, a table with NO foreign key to `users` at all — so no
    // cascade anywhere can reach it and step 3 above cannot have touched it.
    //
    // `UserAiKeyService.deleteForUser` is reused rather than a second
    // `deleteSecret` call from here: that address is that service's to know,
    // not this one's to duplicate. Its own comment already says it "exists from
    // day one ... a future hard-delete of an account will not cascade to the
    // key, and must call this" — this is that caller, arriving for a reset
    // rather than a deletion. The mechanics are identical either way: the row
    // lives at the same address and "gone" means the same thing whether the
    // account survives the call or not. It is idempotent and writes its own
    // `ai_user_key:delete` audit row.
    let aiKeyRemoved = false;
    if (scope === 'data_and_key') {
      await this.userAiKeys.deleteForUser(userId);
      aiKeyRemoved = true;
    }

    // -------------------------------------------------------------------------
    // 5. AUDIT AFTER THE DESTRUCTION COMPLETES, NOT BEFORE OR DURING
    // -------------------------------------------------------------------------
    //
    // Writing the audit row first would risk a row asserting that rows were
    // deleted moments before the transaction that deletes them runs — so a
    // crash in between would leave a lie in `audit_events`. Writing it last
    // means the row is only ever written for destruction that genuinely already
    // happened. An unaudited deletion is a smaller problem than an audit trail
    // that claims a reset which only half-happened.
    //
    // NOT inside the `$transaction` above: that already committed by the time
    // this runs, and `audit_events` has no foreign key to any of the tables it
    // touched, so there is nothing for a shared transaction to buy. This
    // matches what `ObjectsService.delete` and `UsersService.updateUserRoles`
    // both already do — the audit write is a separate statement, after the
    // state change it describes has landed.
    await this.audit(userId, {
      scope,
      deleted: { ...deleted, aiKeyRemoved },
    });

    this.logger.log(
      `Account data reset for user ${userId} (scope: ${scope}, aiKeyRemoved: ${aiKeyRemoved})`,
    );

    // -------------------------------------------------------------------------
    // 6. NOTIFY, LAST
    // -------------------------------------------------------------------------
    //
    // `notify` is detached and NEVER REJECTS, so this is called plainly with no
    // `try`/`catch` around it, exactly as every other caller in this codebase
    // does: a send failure becomes a `notification_deliveries` row carrying the
    // error, never an exception that could make an already-successful reset
    // look like it failed.
    //
    // `account.data_reset` is `mandatory: true` in the registry — see that
    // entry's own comment for the ordering hazard it sidesteps. Step 3 above
    // deleted `user_settings`, which is where a non-mandatory event's stored
    // channel preference would live, moments ago.
    const payload: AccountDataResetEmailData = {
      recipientEmail: user.email,
      scope,
      aiKeyRemoved,
      resetAt: new Date(),
      appUrl: this.appUrl(),
    };
    await this.notifications.notify('account.data_reset', userId, payload);

    return { scope, deleted, aiKeyRemoved };
  }

  /**
   * One `account:reset` row per reset.
   *
   * `meta` carries the scope and per-table COUNTS — table names and numbers,
   * never a row's content. The same discipline the AI-key service states for a
   * credential action, applied here to thirty-odd tables instead of one: an
   * audit trail describing what a destructive action touched must not become a
   * second copy of the data it destroyed.
   */
  private async audit(
    userId: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: 'account:reset',
        targetType: 'user',
        targetId: userId,
        meta: meta as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Absolute URL of the application root, for the reset email's CTA.
   *
   * Trims a trailing slash and returns `undefined` with no `APP_URL`
   * configured, so the email layout omits the button rather than rendering one
   * that goes nowhere.
   */
  private appUrl(): string | undefined {
    const appUrl = this.config.get<string>('appUrl');
    return appUrl ? appUrl.replace(/\/+$/, '') : undefined;
  }
}
