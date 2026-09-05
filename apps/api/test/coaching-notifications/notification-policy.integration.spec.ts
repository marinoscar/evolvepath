import request from 'supertest';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';
import { NOTIFICATION_POLICY_DEFAULTS } from '../../src/coaching-notifications/policy/notification-policy.schema';

// =============================================================================
// GET / PATCH /api/me/notification-policy over HTTP (issue #49, epic E12)
// =============================================================================
//
// What only a real request proves: that a user who has never touched this
// surface gets a working policy rather than a 404, and that a merge patch really
// merges — the two failure modes that would each make the settings page (E12-05)
// lie about what the coach is going to do.
// =============================================================================

describe('Notification policy (integration)', () => {
  let context: TestContext;
  let user: TestUser;

  const profile = (over: Record<string, unknown> = {}) => ({
    id: 'profile-1',
    userId: 'user-1',
    timezone: 'America/Costa_Rica',
    locale: 'en',
    onboardingStep: 'PROMISE',
    onboardingCompletedAt: null,
    coachingStyle: 'BALANCED',
    weekdayMinutes: null,
    quietHoursStart: null,
    quietHoursEnd: null,
    obstacles: [],
    sixMonthVision: null,
    selectedDomains: [],
    domainReflections: null,
    healthBaseline: null,
    pendingProposal: null,
    confidenceScore: null,
    notificationPolicy: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...over,
  });

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    resetPrismaMock();
    setupBaseMocks();
    user = await createMockContributorUser(context);
    context.prismaMock.userProfile.upsert.mockResolvedValue(profile());
    context.prismaMock.userProfile.update.mockResolvedValue(profile());
    context.prismaMock.auditEvent.create.mockResolvedValue({ id: 'audit' });
    // The fatigue assessment reads the interaction history (#59); with none
    // recorded the reduction is inactive and the configured cap stands.
    context.prismaMock.notificationInteraction.count.mockResolvedValue(0);
    context.prismaMock.notificationInteraction.findFirst.mockResolvedValue(null);
    context.prismaMock.notificationInteraction.findMany.mockResolvedValue([]);
  });

  const auth = () => authHeader(user.accessToken);
  const url = '/api/me/notification-policy';

  describe('GET', () => {
    it('answers with the defaults for a user who has never set anything', async () => {
      const res = await request(context.app.getHttpServer()).get(url).set(auth()).expect(200);

      expect(res.body.data).toMatchObject({
        dailyCap: NOTIFICATION_POLICY_DEFAULTS.dailyCap,
        weeklyCap: NOTIFICATION_POLICY_DEFAULTS.weeklyCap,
        perCommitmentMax: NOTIFICATION_POLICY_DEFAULTS.perCommitmentMax,
        quietHours: null,
        mutedCategories: [],
        timezone: 'America/Costa_Rica',
      });
    });

    it('creates the profile row lazily rather than 404ing', async () => {
      await request(context.app.getHttpServer()).get(url).set(auth()).expect(200);

      expect(context.prismaMock.userProfile.upsert).toHaveBeenCalled();
    });

    it('reports no fatigue reduction for a user with no ignored messages', async () => {
      const res = await request(context.app.getHttpServer()).get(url).set(auth()).expect(200);

      expect(res.body.data.fatigue).toEqual({
        active: false,
        effectiveDailyCap: NOTIFICATION_POLICY_DEFAULTS.dailyCap,
      });
    });

    it('requires a bearer token', async () => {
      await request(context.app.getHttpServer()).get(url).expect(401);
    });
  });

  describe('PATCH', () => {
    it('writes quiet hours to the E04-01 columns and caps to the JSON column', async () => {
      context.prismaMock.userProfile.update.mockResolvedValue(
        profile({
          quietHoursStart: '22:00',
          quietHoursEnd: '07:00',
          notificationPolicy: { ...NOTIFICATION_POLICY_DEFAULTS, dailyCap: 3 },
        }),
      );

      await request(context.app.getHttpServer())
        .patch(url)
        .set(auth())
        .send({ quietHours: { start: '22:00', end: '07:00' }, dailyCap: 3 })
        .expect(200);

      const data = context.prismaMock.userProfile.update.mock.calls[0][0].data as any;
      expect(data.quietHoursStart).toBe('22:00');
      expect(data.quietHoursEnd).toBe('07:00');
      expect(data.notificationPolicy).toMatchObject({ dailyCap: 3 });
    });

    it('leaves the caps it was not given alone', async () => {
      context.prismaMock.userProfile.upsert.mockResolvedValue(
        profile({ notificationPolicy: { dailyCap: 2, weeklyCap: 9, perCommitmentMax: 1 } }),
      );

      await request(context.app.getHttpServer())
        .patch(url)
        .set(auth())
        .send({ dailyCap: 5 })
        .expect(200);

      const data = context.prismaMock.userProfile.update.mock.calls[0][0].data as any;
      expect(data.notificationPolicy).toMatchObject({
        dailyCap: 5,
        weeklyCap: 9,
        perCommitmentMax: 1,
      });
    });

    it('does not touch quiet hours when the field is absent', async () => {
      await request(context.app.getHttpServer())
        .patch(url)
        .set(auth())
        .send({ dailyCap: 5 })
        .expect(200);

      const data = context.prismaMock.userProfile.update.mock.calls[0][0].data as any;
      expect(data).not.toHaveProperty('quietHoursStart');
    });

    it('clears quiet hours on an explicit null', async () => {
      await request(context.app.getHttpServer())
        .patch(url)
        .set(auth())
        .send({ quietHours: null })
        .expect(200);

      const data = context.prismaMock.userProfile.update.mock.calls[0][0].data as any;
      expect(data.quietHoursStart).toBeNull();
      expect(data.quietHoursEnd).toBeNull();
    });

    it('rejects a cap outside its range, naming the field', async () => {
      const res = await request(context.app.getHttpServer())
        .patch(url)
        .set(auth())
        .send({ dailyCap: 99 })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('dailyCap');
      expect(context.prismaMock.userProfile.update).not.toHaveBeenCalled();
    });

    it('rejects a half-specified quiet-hours window', async () => {
      await request(context.app.getHttpServer())
        .patch(url)
        .set(auth())
        .send({ quietHours: { start: '22:00' } })
        .expect(400);
    });

    it('rejects a muted category that is not a coaching event key', async () => {
      await request(context.app.getHttpServer())
        .patch(url)
        .set(auth())
        .send({ mutedCategories: ['security.role_changed'] })
        .expect(400);
    });

    it('writes an audit row naming the changed fields but not their values', async () => {
      await request(context.app.getHttpServer())
        .patch(url)
        .set(auth())
        .send({ quietHours: { start: '22:00', end: '07:00' }, dailyCap: 3 })
        .expect(200);

      const audit = context.prismaMock.auditEvent.create.mock.calls[0][0].data as any;
      expect(audit.action).toBe('notification_policy:update');
      expect(audit.targetType).toBe('user_profile');
      expect(audit.meta.changed.sort()).toEqual(['dailyCap', 'quietHours']);
      expect(JSON.stringify(audit.meta)).not.toContain('22:00');
    });

    it('reads and writes the caller’s own profile only', async () => {
      await request(context.app.getHttpServer())
        .patch(url)
        .set(auth())
        .send({ dailyCap: 3 })
        .expect(200);

      expect(context.prismaMock.userProfile.update.mock.calls[0][0].where).toEqual({
        userId: user.id,
      });
    });

    it('requires a bearer token', async () => {
      await request(context.app.getHttpServer()).patch(url).send({ dailyCap: 3 }).expect(401);
    });
  });
});
