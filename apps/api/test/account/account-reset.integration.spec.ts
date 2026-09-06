import request from 'supertest';

import {
  TestContext,
  createTestApp,
  closeTestApp,
} from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockViewerUser, authHeader } from '../helpers/auth-mock.helper';
import {
  ACCOUNT_RESET_PHRASES,
  ACCOUNT_RESET_TABLES,
  CUSTOM_EXERCISES_TABLE,
  MEDIA_ATTACHMENTS_TABLE,
  STORAGE_OBJECTS_TABLE,
} from '../../src/account/account-reset.constants';

// =============================================================================
// Account Data Reset — HTTP integration (issue #221, epic #220)
// =============================================================================
//
// `AccountResetService`'s own spec (`account-reset.service.spec.ts`) already
// covers the delete order, the storage sweep and the audit/notification
// contract at the unit level. What only the transport layer can prove:
//
//   * `@Auth()` with NO permission string really does let the least-privileged
//     role (Viewer) reach both routes — the "no permission to invent" claim
//     this module's own header makes.
//   * The Zod pipe, not the service, is what a caller sees first on a bad
//     phrase, and what happens to a request that tries to name a target user.
// =============================================================================

describe('Account Data Reset Integration', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  /** Every ACCOUNT_RESET_TABLES delegate, plus the three extras, wired to
   * resolve so a full reset can run end to end through the real service. */
  function mockAllResetDelegates() {
    for (const entry of ACCOUNT_RESET_TABLES) {
      const delegate = (context.prismaMock as Record<string, any>)[entry.model];
      delegate.deleteMany.mockResolvedValue({ count: 1 });
      delegate.count.mockResolvedValue(1);
    }
    context.prismaMock.exercise.deleteMany.mockResolvedValue({ count: 0 });
    context.prismaMock.exercise.count.mockResolvedValue(0);
    context.prismaMock.storageObject.count.mockResolvedValue(0);
    context.prismaMock.storageObject.findMany.mockResolvedValue([]);
    context.prismaMock.mediaAttachment.count.mockResolvedValue(0);
    context.prismaMock.auditEvent.create.mockResolvedValue({} as any);

    // `UserAiKeyService.deleteForUser` (scope: data_and_key) — a real
    // credential lookup/delete, not overridden as a provider, so it needs its
    // own Prisma rows stubbed rather than the AI key service itself.
    context.prismaMock.credential.findUnique.mockResolvedValue(null);
    context.prismaMock.credential.deleteMany.mockResolvedValue({ count: 0 });
  }

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    mockAllResetDelegates();
  });

  describe('GET /api/account/data-summary', () => {
    it('returns 401 without a token', async () => {
      await request(context.app.getHttpServer())
        .get('/api/account/data-summary')
        .expect(401);
    });

    it("returns the caller's own counts and both phrases", async () => {
      const viewer = await createMockViewerUser(context);

      const response = await request(context.app.getHttpServer())
        .get('/api/account/data-summary')
        .set(authHeader(viewer.accessToken))
        .expect(200);

      const expectedKeys = new Set([
        ...ACCOUNT_RESET_TABLES.map((e) => e.table),
        CUSTOM_EXERCISES_TABLE,
        STORAGE_OBJECTS_TABLE,
        MEDIA_ATTACHMENTS_TABLE,
      ]);
      expect(new Set(Object.keys(response.body.data.counts))).toEqual(
        expectedKeys,
      );
      expect(response.body.data.phrases).toEqual(ACCOUNT_RESET_PHRASES);
    });

    it('is reachable by a Viewer — the least-privileged role — because this is not a privilege, it is what owning the account already means', async () => {
      const viewer = await createMockViewerUser(context);

      await request(context.app.getHttpServer())
        .get('/api/account/data-summary')
        .set(authHeader(viewer.accessToken))
        .expect(200);
    });
  });

  describe('POST /api/account/reset', () => {
    it('answers 400 on a mismatched phrase and deletes nothing', async () => {
      const viewer = await createMockViewerUser(context);

      await request(context.app.getHttpServer())
        .post('/api/account/reset')
        .set(authHeader(viewer.accessToken))
        .send({ scope: 'data', confirmationPhrase: 'nope' })
        .expect(400);

      expect(context.prismaMock.$transaction).not.toHaveBeenCalled();
      expect(context.prismaMock.commitment.deleteMany).not.toHaveBeenCalled();
      expect(context.prismaMock.auditEvent.create).not.toHaveBeenCalled();
    });

    it("succeeds for scope 'data' and returns { scope, deleted, aiKeyRemoved: false }", async () => {
      const viewer = await createMockViewerUser(context);

      const response = await request(context.app.getHttpServer())
        .post('/api/account/reset')
        .set(authHeader(viewer.accessToken))
        .send({ scope: 'data', confirmationPhrase: ACCOUNT_RESET_PHRASES.data })
        .expect(200);

      expect(response.body.data.scope).toBe('data');
      expect(response.body.data.aiKeyRemoved).toBe(false);
      expect(typeof response.body.data.deleted).toBe('object');
      expect(response.body.data.deleted.commitments).toBe(1);
    });

    it("succeeds for scope 'data_and_key' and returns { scope, deleted, aiKeyRemoved: true }", async () => {
      const viewer = await createMockViewerUser(context);

      const response = await request(context.app.getHttpServer())
        .post('/api/account/reset')
        .set(authHeader(viewer.accessToken))
        .send({
          scope: 'data_and_key',
          confirmationPhrase: ACCOUNT_RESET_PHRASES.data_and_key,
        })
        .expect(200);

      expect(response.body.data.scope).toBe('data_and_key');
      expect(response.body.data.aiKeyRemoved).toBe(true);
    });

    it('lets a Viewer reset their own data', async () => {
      const viewer = await createMockViewerUser(context);

      await request(context.app.getHttpServer())
        .post('/api/account/reset')
        .set(authHeader(viewer.accessToken))
        .send({ scope: 'data', confirmationPhrase: ACCOUNT_RESET_PHRASES.data })
        .expect(200);
    });

    it('strips an extra userId/targetUserId field rather than honouring it — no request shape can name another user', async () => {
      // `resetAccountSchema` is a plain `z.object(...)`, not `.strict()`, so
      // Zod's default behaviour is to silently DROP unknown keys rather than
      // reject the request with a 400. Either answer would have satisfied
      // "no route accepts a user id"; this asserts the one this schema
      // actually gives — the request still succeeds, and the audit row it
      // produces is attributed to the AUTHENTICATED caller regardless of what
      // the body claimed.
      const viewer = await createMockViewerUser(context);

      const response = await request(context.app.getHttpServer())
        .post('/api/account/reset')
        .set(authHeader(viewer.accessToken))
        .send({
          scope: 'data',
          confirmationPhrase: ACCOUNT_RESET_PHRASES.data,
          userId: 'someone-elses-id',
          targetUserId: 'someone-elses-id',
        })
        .expect(200);

      expect(response.body.data.scope).toBe('data');

      const auditCall = (
        context.prismaMock.auditEvent.create as jest.Mock
      ).mock.calls.find((call) => call[0].data.action === 'account:reset');
      expect(auditCall).toBeDefined();
      expect(auditCall![0].data.actorUserId).toBe(viewer.id);
      expect(auditCall![0].data.targetId).toBe(viewer.id);
    });
  });
});
