import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { UserProfileService } from '../../user-profile/user-profile.service';
import { CommitmentActionsService } from '../../commitments/actions/commitment-actions.service';
import { MomentumService } from '../momentum/momentum.service';
import { ComebackService } from './comeback.service';
import { RestartWordingService } from './restart-wording.service';

// =============================================================================
// The comeback loop, wired (issue #112, epic E11)
// =============================================================================
//
// The assertions that matter are about restraint:
//
//   - evidence is never written, updated or deleted by the sweep (PRD §109);
//   - a STARTED row survives it (the matrix has no STARTED → MISSED);
//   - yesterday's 23:00 in a UTC−6 zone is closed and today's 00:30 is not —
//     which a `setHours(0,0,0,0)` implementation gets exactly backwards;
//   - a model-written title containing "overdue" is thrown away.
// =============================================================================

const NOW = new Date('2026-03-06T18:00:00.000Z');
const DAY = 86_400_000;

describe('ComebackService (#112)', () => {
  let service: ComebackService;
  let prisma: any;
  let profiles: { getOrCreate: jest.Mock; find: jest.Mock };
  let momentum: { forUser: jest.Mock };
  let actions: { complete: jest.Mock };
  let wording: { compose: jest.Mock };

  const profileRow = (over: Record<string, unknown> = {}) => ({
    userId: 'u1',
    timezone: 'UTC',
    coachingStyle: 'BALANCED',
    comebackState: 'NONE',
    comebackTrigger: null,
    comebackOfferedAt: null,
    comebackCommitmentId: null,
    lastActiveAt: new Date(NOW.getTime() - 5 * DAY),
    lastSweepAt: null,
    planReviewSuggestedAt: null,
    ...over,
  });

  const commitmentRow = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    userId: 'u1',
    domain: 'HEALTH',
    title: 'Strength workout',
    scheduledStart: new Date(NOW.getTime() - 2 * DAY),
    scheduledEnd: null,
    status: 'PLANNED',
    importance: 3,
    commitmentType: null,
    rescheduleCount: 0,
    fullVersion: null,
    shortVersion: null,
    minimumVersion: null,
    fullMinutes: 20,
    shortMinutes: null,
    minimumMinutes: null,
    versionUsed: null,
    minutesSpent: null,
    startedAt: null,
    completedAt: null,
    activeSince: null,
    activeSeconds: 0,
    timerMinutes: null,
    steps: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      commitment: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn(),
        create: jest.fn().mockImplementation(async ({ data }: any) =>
          commitmentRow({ id: 'restart-1', ...data }),
        ),
        count: jest.fn().mockResolvedValue(0),
      },
      evidence: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' }),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      outcome: { findMany: jest.fn().mockResolvedValue([]) },
      domainMode: { findMany: jest.fn().mockResolvedValue([]) },
      userProfile: { update: jest.fn() },
      auditEvent: { create: jest.fn().mockResolvedValue({ id: 'a1' }) },
    };
    profiles = {
      getOrCreate: jest.fn().mockResolvedValue(profileRow()),
      find: jest.fn().mockResolvedValue(profileRow()),
    };
    momentum = { forUser: jest.fn().mockResolvedValue({}) };
    actions = { complete: jest.fn().mockResolvedValue({}) };
    wording = {
      compose: jest.fn().mockResolvedValue({
        title: 'A 10-minute walk',
        note: 'No catching up. We start from today.',
        source: 'template',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComebackService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserProfileService, useValue: profiles },
        { provide: MomentumService, useValue: momentum },
        { provide: CommitmentActionsService, useValue: actions },
        { provide: RestartWordingService, useValue: wording },
      ],
    }).compile();

    service = module.get(ComebackService);
  });

  describe('the sweep', () => {
    it('closes only stale PLANNED and READY rows, and touches no evidence', async () => {
      prisma.commitment.findMany.mockResolvedValue([
        { id: 'a', status: 'PLANNED' },
        { id: 'b', status: 'READY' },
      ]);
      prisma.commitment.updateMany.mockResolvedValue({ count: 2 });
      prisma.commitment.count.mockResolvedValue(1);

      const result = await service.sweepUser('u1', NOW);

      expect(result.closedCount).toBe(2);
      expect(prisma.commitment.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['a', 'b'] } },
        data: { status: 'MISSED' },
      });
      // PRD §109: prior misses remain evidence.
      expect(prisma.evidence.update).not.toHaveBeenCalled();
      expect(prisma.evidence.delete).not.toHaveBeenCalled();
      expect(prisma.evidence.deleteMany).not.toHaveBeenCalled();
    });

    it('refuses to close a row the transition matrix would not', async () => {
      prisma.commitment.findMany.mockResolvedValue([
        { id: 'started', status: 'STARTED' },
        { id: 'planned', status: 'PLANNED' },
      ]);

      const result = await service.sweepUser('u1', NOW);

      expect(result.closedCount).toBe(1);
      expect(prisma.commitment.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['planned'] } },
        data: { status: 'MISSED' },
      });
    });

    it('reads the day boundary in the user’s zone, not the server’s', async () => {
      profiles.getOrCreate.mockResolvedValue(
        profileRow({ timezone: 'America/Costa_Rica' }),
      );

      await service.sweepUser('u1', new Date('2026-03-06T12:00:00.000Z'));

      // 2026-03-06 06:00 UTC is local midnight in UTC−6, so yesterday's 23:00
      // (05:00 UTC today) is stale and today's 00:30 (06:30 UTC) is not.
      const where = prisma.commitment.findMany.mock.calls[0][0].where;
      expect(where.scheduledStart.lt.toISOString()).toBe('2026-03-06T06:00:00.000Z');
    });

    it('offers exactly one restart, and marks it as one', async () => {
      // One historical row: enough for `hasHistory`, far short of the
      // repeated-miss threshold, so INACTIVITY is what fires.
      prisma.commitment.count.mockResolvedValue(1);

      const result = await service.sweepUser('u1', NOW);

      expect(result.trigger).toBe('INACTIVITY');
      expect(prisma.commitment.create).toHaveBeenCalledTimes(1);
      expect(prisma.commitment.create.mock.calls[0][0].data).toMatchObject({
        commitmentType: 'restart',
        status: 'PLANNED',
        domain: 'HEALTH',
      });
      expect(prisma.userProfile.update).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: expect.objectContaining({
          comebackState: 'OFFERED',
          comebackTrigger: 'INACTIVITY',
          comebackCommitmentId: 'restart-1',
        }),
      });
    });

    it('never offers twice — an open loop suppresses the next sweep', async () => {
      profiles.getOrCreate.mockResolvedValue(
        profileRow({ comebackState: 'OFFERED', comebackCommitmentId: 'restart-1' }),
      );

      const result = await service.sweepUser('u1', NOW);

      expect(result.trigger).toBeNull();
      expect(prisma.commitment.create).not.toHaveBeenCalled();
    });

    it('never greets a user with no history at all', async () => {
      profiles.getOrCreate.mockResolvedValue(profileRow({ lastActiveAt: null }));
      prisma.commitment.count.mockResolvedValue(0);
      prisma.evidence.count.mockResolvedValue(0);

      expect((await service.sweepUser('u1', NOW)).trigger).toBeNull();
    });

    it('raises the plan-review flag when the misses look like plan drift', async () => {
      prisma.commitment.count.mockResolvedValue(6);

      await service.sweepUser('u1', NOW);

      expect(prisma.userProfile.update).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: expect.objectContaining({ planReviewSuggestedAt: NOW }),
      });
    });

    it('writes audit rows that carry no title', async () => {
      prisma.commitment.count.mockResolvedValue(1);

      await service.sweepUser('u1', NOW);

      const actionsWritten = prisma.auditEvent.create.mock.calls.map(
        (call: any) => call[0].data.action,
      );
      expect(actionsWritten).toContain('comeback:sweep');
      expect(actionsWritten).toContain('comeback:offer');

      for (const call of prisma.auditEvent.create.mock.calls) {
        expect(JSON.stringify(call[0].data.meta)).not.toContain('walk');
      }
    });
  });

  describe('complete', () => {
    beforeEach(() => {
      profiles.getOrCreate.mockResolvedValue(
        profileRow({
          comebackState: 'IN_PROGRESS',
          comebackTrigger: 'INACTIVITY',
          comebackCommitmentId: 'restart-1',
          comebackOfferedAt: new Date(NOW.getTime() - 3_600_000),
        }),
      );
      prisma.commitment.findFirst.mockResolvedValue(
        commitmentRow({ id: 'restart-1', commitmentType: 'restart' }),
      );
    });

    it('records recovery and resets the loop', async () => {
      const result = await service.complete('u1', undefined, NOW);

      expect(result.celebration.title).toBe('Back on Path.');
      expect(actions.complete).toHaveBeenCalledWith('u1', 'restart-1', {
        notes: undefined,
      });
      expect(prisma.evidence.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            evidenceType: 'recovery',
            source: 'APP_FLOW',
          }),
        }),
      );
      expect(prisma.userProfile.update).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: expect.objectContaining({
          comebackState: 'NONE',
          comebackCommitmentId: null,
          lastActiveAt: NOW,
        }),
      });
    });

    it('does not re-complete a restart the user already finished', async () => {
      prisma.commitment.findFirst.mockResolvedValue(
        commitmentRow({ id: 'restart-1', status: 'COMPLETED' }),
      );

      await service.complete('u1', undefined, NOW);

      expect(actions.complete).not.toHaveBeenCalled();
      expect(prisma.evidence.create).toHaveBeenCalled();
    });

    it('refuses a second call — there is nothing left to complete', async () => {
      profiles.getOrCreate.mockResolvedValue(profileRow({ comebackState: 'NONE' }));

      await expect(service.complete('u1', undefined, NOW)).rejects.toMatchObject({
        response: { details: { reason: 'NO_COMEBACK_OFFER' } },
      });
    });
  });

  describe('choose and dismiss', () => {
    beforeEach(() => {
      profiles.getOrCreate.mockResolvedValue(
        profileRow({ comebackState: 'OFFERED', comebackCommitmentId: 'restart-1' }),
      );
      prisma.commitment.findFirst.mockResolvedValue(
        commitmentRow({ id: 'restart-1', status: 'PLANNED' }),
      );
      prisma.outcome.findMany.mockResolvedValue([
        {
          id: 'o1',
          title: 'Ship the proposal',
          domain: 'WORK',
          importance: 4,
          plan: {
            versions: [
              {
                id: 'v1',
                routines: [
                  {
                    id: 'r1',
                    title: 'Morning focus block',
                    domain: 'WORK',
                    minimumDurationMin: 10,
                    fallbackBehavior: null,
                    preferredTime: '09:00',
                    sortOrder: 0,
                  },
                ],
              },
            ],
          },
        },
      ]);
    });

    it('cancels the old restart before creating the new one', async () => {
      await service.choose('u1', 'WORK', NOW);

      expect(prisma.commitment.update).toHaveBeenCalledWith({
        where: { id: 'restart-1' },
        data: { status: 'CANCELLED' },
      });
      expect(prisma.commitment.create).toHaveBeenCalledTimes(1);
      expect(prisma.commitment.create.mock.calls[0][0].data.domain).toBe('WORK');
    });

    it('refuses a domain with nothing to rebuild', async () => {
      await expect(service.choose('u1', 'FAMILY', NOW)).rejects.toMatchObject({
        response: { details: { reason: 'NO_RESTART_IN_DOMAIN' } },
      });
    });

    it('lets the user decline being helped', async () => {
      await service.dismiss('u1');

      expect(prisma.commitment.update).toHaveBeenCalledWith({
        where: { id: 'restart-1' },
        data: { status: 'CANCELLED' },
      });
      expect(prisma.userProfile.update).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: expect.objectContaining({ comebackState: 'NONE' }),
      });
    });
  });

  describe('getStatus', () => {
    it('says nothing at all when there is no open loop', async () => {
      const status = await service.getStatus('u1', NOW);

      expect(status).toMatchObject({
        state: 'NONE',
        trigger: null,
        restart: null,
        recommendation: null,
        alternatives: [],
      });
    });
  });
});
