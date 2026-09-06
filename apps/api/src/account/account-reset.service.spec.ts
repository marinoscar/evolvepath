import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import { ObjectsService } from '../storage/objects/objects.service';
import { UserAiKeyService } from '../ai/user-key/user-ai-key.service';
import { NotificationsService } from '../notifications/notifications.service';
import { createMockPrismaService } from '../../test/mocks/prisma.mock';
import type { RequestUser } from '../auth/interfaces/authenticated-user.interface';
import { AccountResetService } from './account-reset.service';
import {
  ACCOUNT_RESET_PHRASES,
  ACCOUNT_RESET_TABLES,
  CUSTOM_EXERCISES_TABLE,
  MEDIA_ATTACHMENTS_TABLE,
  STORAGE_OBJECTS_TABLE,
} from './account-reset.constants';

// =============================================================================
// AccountResetService — tests (issue #221, epic #220)
// =============================================================================
//
// Three things this suite exists to catch that a looser test would not:
//
//   1. A phrase mismatch that deletes anyway and throws afterwards. Asserting
//      only the thrown exception cannot catch this — the transaction, the
//      storage sweep and the audit write are all spied on directly, so
//      "nothing happened" is checked, not merely "it complained".
//   2. A reordering of `ACCOUNT_RESET_TABLES`. The delete order is derived
//      from the SAME constant `AccountResetService` reads, so a real reorder
//      of the constant reorders this suite's expectation too — this is
//      deliberate: a spec that hardcoded a second copy of the thirty-one
//      names would only ever catch itself disagreeing with itself.
//   3. Storage bytes surviving a reset because a raw `deleteMany` replaced
//      `ObjectsService.delete`, which is what actually reaches the provider.
// =============================================================================

const USER_ID = 'user-1';
const requestUser: RequestUser = {
  id: USER_ID,
  email: 'owner@test.local',
  roles: ['viewer'],
  permissions: [],
  isActive: true,
};

/** One entry in the shared call log every mocked side effect writes to. */
type LogEntry =
  | { kind: 'storage-delete'; objectId: string }
  | { kind: 'table-delete'; table: string }
  | { kind: 'transaction-open' }
  | { kind: 'ai-key-purge' }
  | { kind: 'audit' }
  | { kind: 'notify' };

describe('AccountResetService', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let objects: { delete: jest.Mock };
  let userAiKeys: { deleteForUser: jest.Mock };
  let notifications: { notify: jest.Mock };
  let config: { get: jest.Mock };
  let service: AccountResetService;
  /** Chronological record of every mocked side effect, across all fakes. */
  let log: LogEntry[];

  /** The exact 33-entry delete order the real service is supposed to run. */
  function expectedDeleteOrder(): string[] {
    const outcomesIndex = ACCOUNT_RESET_TABLES.findIndex(
      (entry) => entry.table === 'outcomes',
    );
    return [
      ...ACCOUNT_RESET_TABLES.slice(0, outcomesIndex + 1).map((e) => e.table),
      CUSTOM_EXERCISES_TABLE,
      ...ACCOUNT_RESET_TABLES.slice(outcomesIndex + 1).map((e) => e.table),
    ];
  }

  beforeEach(() => {
    log = [];
    prisma = createMockPrismaService();

    // Every ACCOUNT_RESET_TABLES delegate: a tracked deleteMany plus a count
    // for `summarize`.
    for (const entry of ACCOUNT_RESET_TABLES) {
      const delegate = (prisma as Record<string, any>)[entry.model];
      delegate.deleteMany = jest.fn().mockImplementation(async () => {
        log.push({ kind: 'table-delete', table: entry.table });
        return { count: 1 };
      });
      delegate.count = jest.fn().mockResolvedValue(1);
    }

    // The custom-exercise delete, which does not ride the generic loop.
    (prisma.exercise.deleteMany as jest.Mock) = jest
      .fn()
      .mockImplementation(async () => {
        log.push({ kind: 'table-delete', table: CUSTOM_EXERCISES_TABLE });
        return { count: 1 };
      });
    (prisma.exercise.count as jest.Mock) = jest.fn().mockResolvedValue(1);

    (prisma.storageObject.count as jest.Mock) = jest.fn().mockResolvedValue(1);
    (prisma.mediaAttachment.count as jest.Mock) = jest
      .fn()
      .mockResolvedValue(1);
    (prisma.storageObject.findMany as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ id: 'obj-1' }, { id: 'obj-2' }]);

    (prisma.auditEvent.create as jest.Mock) = jest
      .fn()
      .mockImplementation(async () => {
        log.push({ kind: 'audit' });
        return {};
      });

    // Interactive transaction: call straight into the callback with the same
    // mocked client, and record when it opens relative to everything else.
    (prisma.$transaction as jest.Mock) = jest
      .fn()
      .mockImplementation(async (arg: any) => {
        log.push({ kind: 'transaction-open' });
        if (typeof arg === 'function') return arg(prisma);
        return arg;
      });

    objects = {
      delete: jest.fn().mockImplementation(async (id: string) => {
        log.push({ kind: 'storage-delete', objectId: id });
      }),
    };
    userAiKeys = {
      deleteForUser: jest.fn().mockImplementation(async () => {
        log.push({ kind: 'ai-key-purge' });
      }),
    };
    notifications = {
      notify: jest.fn().mockImplementation(async () => {
        log.push({ kind: 'notify' });
      }),
    };
    config = { get: jest.fn().mockReturnValue(undefined) };

    service = new AccountResetService(
      prisma as unknown as PrismaService,
      userAiKeys as unknown as UserAiKeyService,
      objects as unknown as ObjectsService,
      notifications as unknown as NotificationsService,
      config as unknown as ConfigService,
    );
  });

  // ===========================================================================
  // The phrase gate
  // ===========================================================================

  describe('the phrase gate', () => {
    it('throws BadRequestException on a mismatched phrase and touches nothing — not the transaction, not storage, not the key, not the audit trail', async () => {
      await expect(
        service.reset(requestUser, 'data', 'not the right phrase'),
      ).rejects.toThrow(BadRequestException);

      // The claim under test is "nothing happened", not "it complained" — a
      // service that deleted first and threw after would still satisfy the
      // assertion above, so every side effect is checked directly.
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(objects.delete).not.toHaveBeenCalled();
      expect(userAiKeys.deleteForUser).not.toHaveBeenCalled();
      expect(prisma.auditEvent.create).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
      expect(log).toEqual([]);
    });

    it.each<[string, 'data' | 'data_and_key', string]>([
      ['an empty phrase', 'data', ''],
      ['a lower-cased phrase', 'data', 'delete my data'],
      [
        "the OTHER scope's phrase sent for this scope",
        'data',
        ACCOUNT_RESET_PHRASES.data_and_key,
      ],
    ])('rejects %s the same way, before touching anything', async (_label, scope, phrase) => {
      await expect(service.reset(requestUser, scope, phrase)).rejects.toThrow(
        BadRequestException,
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(objects.delete).not.toHaveBeenCalled();
      expect(userAiKeys.deleteForUser).not.toHaveBeenCalled();
      expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    });

    it('accepts a phrase with surrounding whitespace — .trim() only, never case-folded', async () => {
      const result = await service.reset(
        requestUser,
        'data',
        `  ${ACCOUNT_RESET_PHRASES.data}  `,
      );

      expect(result.scope).toBe('data');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // The delete order — the most important test in the file
  // ===========================================================================

  describe('the delete order', () => {
    it('deletes every ACCOUNT_RESET_TABLES table in declared order, with the custom-exercise delete immediately after outcomes', async () => {
      await service.reset(requestUser, 'data', ACCOUNT_RESET_PHRASES.data);

      const tableDeletes = log
        .filter((entry): entry is { kind: 'table-delete'; table: string } =>
          entry.kind === 'table-delete',
        )
        .map((entry) => entry.table);

      expect(tableDeletes).toEqual(expectedDeleteOrder());
    });

    it('deletes evidence_items and reflections before commitments, so no SetNull orphan survives the parent delete', async () => {
      await service.reset(requestUser, 'data', ACCOUNT_RESET_PHRASES.data);

      const tableDeletes = log
        .filter((entry): entry is { kind: 'table-delete'; table: string } =>
          entry.kind === 'table-delete',
        )
        .map((entry) => entry.table);

      const commitmentsIndex = tableDeletes.indexOf('commitments');
      expect(tableDeletes.indexOf('evidence_items')).toBeLessThan(
        commitmentsIndex,
      );
      expect(tableDeletes.indexOf('reflections')).toBeLessThan(
        commitmentsIndex,
      );
    });

    it('deletes exercises after both workout_programs and workout_sessions, so the Restrict FK from workout_template_exercises/set_logs never fires', async () => {
      await service.reset(requestUser, 'data', ACCOUNT_RESET_PHRASES.data);

      const tableDeletes = log
        .filter((entry): entry is { kind: 'table-delete'; table: string } =>
          entry.kind === 'table-delete',
        )
        .map((entry) => entry.table);

      const exercisesIndex = tableDeletes.indexOf(CUSTOM_EXERCISES_TABLE);
      expect(tableDeletes.indexOf('workout_programs')).toBeLessThan(
        exercisesIndex,
      );
      expect(tableDeletes.indexOf('workout_sessions')).toBeLessThan(
        exercisesIndex,
      );
    });
  });

  // ===========================================================================
  // Storage
  // ===========================================================================

  describe('storage', () => {
    it('calls ObjectsService.delete once per owned object, with the caller’s own RequestUser', async () => {
      await service.reset(requestUser, 'data', ACCOUNT_RESET_PHRASES.data);

      expect(objects.delete).toHaveBeenCalledTimes(2);
      expect(objects.delete).toHaveBeenNthCalledWith(1, 'obj-1', requestUser);
      expect(objects.delete).toHaveBeenNthCalledWith(2, 'obj-2', requestUser);
    });

    it('deletes storage objects before the transaction opens', async () => {
      await service.reset(requestUser, 'data', ACCOUNT_RESET_PHRASES.data);

      const storageIndices = log
        .map((entry, i) => (entry.kind === 'storage-delete' ? i : -1))
        .filter((i) => i !== -1);
      const transactionIndex = log.findIndex(
        (entry) => entry.kind === 'transaction-open',
      );

      expect(storageIndices.length).toBe(2);
      for (const i of storageIndices) {
        expect(i).toBeLessThan(transactionIndex);
      }
    });

    it('never calls a raw prisma.storageObject.deleteMany — only ObjectsService.delete may remove an object', async () => {
      await service.reset(requestUser, 'data', ACCOUNT_RESET_PHRASES.data);

      expect(prisma.storageObject.deleteMany).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // The key
  // ===========================================================================

  describe('the key', () => {
    it('never purges the AI key on scope: data', async () => {
      const result = await service.reset(
        requestUser,
        'data',
        ACCOUNT_RESET_PHRASES.data,
      );

      expect(userAiKeys.deleteForUser).not.toHaveBeenCalled();
      expect(result.aiKeyRemoved).toBe(false);
    });

    it('purges exactly the caller’s AI key on scope: data_and_key, and reports it', async () => {
      const result = await service.reset(
        requestUser,
        'data_and_key',
        ACCOUNT_RESET_PHRASES.data_and_key,
      );

      expect(userAiKeys.deleteForUser).toHaveBeenCalledTimes(1);
      expect(userAiKeys.deleteForUser).toHaveBeenCalledWith(USER_ID);
      expect(result.aiKeyRemoved).toBe(true);
    });
  });

  // ===========================================================================
  // Audit
  // ===========================================================================

  describe('audit', () => {
    it('writes exactly one account:reset audit row, attributed to the caller as both actor and target', async () => {
      await service.reset(requestUser, 'data', ACCOUNT_RESET_PHRASES.data);

      expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
      const call = (prisma.auditEvent.create as jest.Mock).mock.calls[0][0];
      expect(call.data.action).toBe('account:reset');
      expect(call.data.targetType).toBe('user');
      expect(call.data.actorUserId).toBe(USER_ID);
      expect(call.data.targetId).toBe(USER_ID);
    });

    it('writes the audit row after the transaction resolves and after the key purge', async () => {
      await service.reset(
        requestUser,
        'data_and_key',
        ACCOUNT_RESET_PHRASES.data_and_key,
      );

      const transactionIndex = log.findIndex(
        (e) => e.kind === 'transaction-open',
      );
      const keyPurgeIndex = log.findIndex((e) => e.kind === 'ai-key-purge');
      const auditIndex = log.findIndex((e) => e.kind === 'audit');

      expect(auditIndex).toBeGreaterThan(transactionIndex);
      expect(auditIndex).toBeGreaterThan(keyPurgeIndex);
    });

    it('carries per-table counts and aiKeyRemoved in meta, and nothing that looks like row content', async () => {
      await service.reset(
        requestUser,
        'data_and_key',
        ACCOUNT_RESET_PHRASES.data_and_key,
      );

      const call = (prisma.auditEvent.create as jest.Mock).mock.calls[0][0];
      const meta = call.data.meta as Record<string, unknown>;

      expect(meta.scope).toBe('data_and_key');
      expect(typeof meta.deleted).toBe('object');
      const deleted = meta.deleted as Record<string, unknown>;
      expect(deleted.aiKeyRemoved).toBe(true);

      // The key set is exactly: every ACCOUNT_RESET_TABLES table, the custom
      // exercises table, storage_objects, media_attachments, and
      // aiKeyRemoved. A later field slipping in here (a row id, a name, any
      // content) is a visible failure of this assertion, by design.
      const expectedKeys = new Set([
        ...ACCOUNT_RESET_TABLES.map((e) => e.table),
        CUSTOM_EXERCISES_TABLE,
        STORAGE_OBJECTS_TABLE,
        MEDIA_ATTACHMENTS_TABLE,
        'aiKeyRemoved',
      ]);
      expect(new Set(Object.keys(deleted))).toEqual(expectedKeys);
    });
  });

  // ===========================================================================
  // Notification
  // ===========================================================================

  describe('notification', () => {
    it('notifies account.data_reset once, with the caller’s email and the scope-correct aiKeyRemoved', async () => {
      await service.reset(
        requestUser,
        'data_and_key',
        ACCOUNT_RESET_PHRASES.data_and_key,
      );

      expect(notifications.notify).toHaveBeenCalledTimes(1);
      const [eventKey, userId, payload] = (notifications.notify as jest.Mock)
        .mock.calls[0];
      expect(eventKey).toBe('account.data_reset');
      expect(userId).toBe(USER_ID);
      expect((payload as any).recipientEmail).toBe(requestUser.email);
      expect((payload as any).aiKeyRemoved).toBe(true);
    });

    it('reports aiKeyRemoved: false in the notification payload for scope: data', async () => {
      await service.reset(requestUser, 'data', ACCOUNT_RESET_PHRASES.data);

      const [, , payload] = (notifications.notify as jest.Mock).mock.calls[0];
      expect((payload as any).aiKeyRemoved).toBe(false);
    });
  });

  // ===========================================================================
  // summarize — read-only means read-only
  // ===========================================================================

  describe('summarize', () => {
    it('counts every ACCOUNT_RESET_TABLES entry plus exercises, storage_objects and media_attachments, and returns the phrases', async () => {
      const summary = await service.summarize(USER_ID);

      const expectedKeys = new Set([
        ...ACCOUNT_RESET_TABLES.map((e) => e.table),
        CUSTOM_EXERCISES_TABLE,
        STORAGE_OBJECTS_TABLE,
        MEDIA_ATTACHMENTS_TABLE,
      ]);
      expect(new Set(Object.keys(summary.counts))).toEqual(expectedKeys);
      expect(summary.phrases).toEqual(ACCOUNT_RESET_PHRASES);
    });

    it('calls no deleteMany, no $transaction and no ObjectsService.delete — read-only means read-only', async () => {
      await service.summarize(USER_ID);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(objects.delete).not.toHaveBeenCalled();
      for (const entry of ACCOUNT_RESET_TABLES) {
        const delegate = (prisma as Record<string, any>)[entry.model];
        expect(delegate.deleteMany).not.toHaveBeenCalled();
      }
      expect(prisma.exercise.deleteMany).not.toHaveBeenCalled();
    });
  });
});
