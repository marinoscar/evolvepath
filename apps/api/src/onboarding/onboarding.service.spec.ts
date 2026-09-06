import { BadRequestException, ConflictException } from '@nestjs/common';
import type { UserProfile } from '@prisma/client';

import { OnboardingService } from './onboarding.service';
import { buildTemplateProposal } from './onboarding-templates';
import type { OnboardingProposal } from './onboarding-proposal.schema';

// =============================================================================
// Answering, proposing and approving (issue #101, epic E04)
// =============================================================================
//
// Three promises are asserted here and nowhere else:
//
//   • `propose` STORES ON THE PROFILE AND NOWHERE ELSE. `outcome.create` and
//     `commitment.create` are never called — PRD §15's promise, and invisible
//     to any test that reads only the response body.
//   • `approve` runs inside ONE `$transaction`, and the audit row is written
//     AFTER it (a row inside would be rolled back with what it is evidence of).
//   • The SECOND approve is a 409 and creates nothing.
// =============================================================================

const MONDAY = new Date('2026-09-07T08:00:00.000Z');

const proposal = (): OnboardingProposal =>
  buildTemplateProposal(
    {
      sixMonthVision: 'Stop wasting mornings',
      domains: ['WORK', 'FAMILY', 'HEALTH'],
      weekdayMinutes: 60,
      healthBaseline: null,
    },
    MONDAY,
    'UTC',
  );

function profileRow(over: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'p1',
    userId: 'u1',
    timezone: 'UTC',
    locale: 'en',
    onboardingStep: 'PROPOSAL',
    onboardingCompletedAt: null,
    coachingStyle: 'BALANCED',
    weekdayMinutes: 60,
    obstacles: ['PROCRASTINATE'],
    sixMonthVision: 'Stop wasting mornings',
    selectedDomains: ['WORK', 'FAMILY', 'HEALTH'],
    domainReflections: null,
    healthBaseline: null,
    pendingProposal: { source: 'ai', proposal: proposal() },
    confidenceScore: 4,
    ...over,
  } as unknown as UserProfile;
}

describe('OnboardingService', () => {
  let prisma: Record<string, any>;
  let profiles: { getOrCreate: jest.Mock; update: jest.Mock };
  let proposals: { propose: jest.Mock };
  let service: OnboardingService;

  beforeEach(() => {
    const table = () => ({ create: jest.fn(async ({ data }: any) => ({ id: crypto.randomUUID(), ...data })), upsert: jest.fn(async () => ({ id: 'x' })), update: jest.fn(async () => ({})) });

    prisma = {
      bestSelfProfile: table(),
      outcome: table(),
      plan: table(),
      planVersion: table(),
      routine: table(),
      commitment: table(),
      domainMode: table(),
      userProfile: table(),
      auditEvent: table(),
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };

    profiles = {
      getOrCreate: jest.fn(async () => profileRow()),
      update: jest.fn(async (_u: string, patch: any) => ({ ...profileRow(), ...patch })),
    };

    proposals = { propose: jest.fn(async () => ({ proposal: proposal(), invocationId: 'inv' })) };

    service = new OnboardingService(prisma as never, profiles as never, proposals as never);
  });

  describe('patchAnswers', () => {
    it('merges only the keys it was sent', async () => {
      await service.patchAnswers('u1', { step: 'TIME', weekdayMinutes: 45 } as never);

      expect(profiles.update).toHaveBeenCalledWith('u1', {
        onboardingStep: 'TIME',
        weekdayMinutes: 45,
      });
    });

    it('refuses to touch a completed account', async () => {
      profiles.getOrCreate.mockResolvedValue(profileRow({ onboardingCompletedAt: MONDAY }));

      await expect(service.patchAnswers('u1', { weekdayMinutes: 45 } as never)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('start', () => {
    it('rejects a timezone the runtime cannot resolve', async () => {
      profiles.getOrCreate.mockResolvedValue(profileRow({ onboardingStep: 'PROMISE' }));

      await expect(service.start('u1', { timezone: 'Mars/Olympus' } as never)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('moves off PROMISE but never drags a user forward from a later step', async () => {
      profiles.getOrCreate.mockResolvedValue(profileRow({ onboardingStep: 'DOMAINS' }));

      await service.start('u1', { timezone: 'Asia/Tokyo' } as never);

      expect(profiles.update).toHaveBeenCalledWith('u1', { timezone: 'Asia/Tokyo' });
    });
  });

  describe('propose', () => {
    it('stores the proposal on the profile and writes no domain rows', async () => {
      const result = await service.propose('u1', MONDAY);

      expect(result.source).toBe('ai');
      expect(profiles.update).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ onboardingStep: 'PROPOSAL' }),
      );
      expect(prisma.outcome.create).not.toHaveBeenCalled();
      expect(prisma.commitment.create).not.toHaveBeenCalled();
      expect(prisma.planVersion.create).not.toHaveBeenCalled();
    });

    it('will not guess a plan for a user who has not said what matters', async () => {
      profiles.getOrCreate.mockResolvedValue(profileRow({ selectedDomains: [] }));

      await expect(service.propose('u1', MONDAY)).rejects.toBeInstanceOf(BadRequestException);
      expect(proposals.propose).not.toHaveBeenCalled();
    });
  });

  describe('skipAi', () => {
    it('produces a template without reaching the gateway', async () => {
      const result = await service.skipAi('u1', MONDAY);

      expect(result.source).toBe('template');
      expect(result.proposal.routines.length).toBeGreaterThan(0);
      expect(proposals.propose).not.toHaveBeenCalled();
    });
  });

  describe('confidence', () => {
    it('keeps the plan and records the score when the answer is 3 or more', async () => {
      const result = await service.confidence('u1', 4, MONDAY);

      expect(result.reproposed).toBe(false);
      expect(profiles.update).toHaveBeenCalledWith('u1', { confidenceScore: 4 });
      expect(proposals.propose).not.toHaveBeenCalled();
    });

    it('re-asks the coach for a smaller plan at 2', async () => {
      const smaller = { ...proposal(), reducedFromRequest: true };
      proposals.propose.mockResolvedValue({ proposal: smaller, invocationId: 'inv' });

      const result = await service.confidence('u1', 2, MONDAY);

      expect(result.reproposed).toBe(true);
      expect(proposals.propose).toHaveBeenCalledWith(
        expect.objectContaining({ previousProposal: expect.anything() }),
      );
    });

    it('reduces a template arithmetically rather than calling a provider that is down', async () => {
      profiles.getOrCreate.mockResolvedValue(
        profileRow({ pendingProposal: { source: 'template', proposal: proposal() } as never }),
      );

      const result = await service.confidence('u1', 1, MONDAY);

      expect(result.reproposed).toBe(true);
      expect(result.source).toBe('template');
      expect(result.proposal.reducedFromRequest).toBe(true);
      expect(proposals.propose).not.toHaveBeenCalled();
    });
  });

  describe('approve', () => {
    it('writes the whole Path inside one transaction and audits after it', async () => {
      const result = await service.approve('u1', proposal(), MONDAY);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(result.outcomeIds).toHaveLength(3);
      expect(result.planVersionIds).toHaveLength(3);
      expect(result.routineIds).toHaveLength(3);
      expect(result.commitmentIds.length).toBeGreaterThanOrEqual(3);

      expect(prisma.userProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ onboardingStep: 'DONE', onboardingCompletedAt: MONDAY }),
        }),
      );

      expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
      expect(prisma.auditEvent.create.mock.calls[0][0].data).toMatchObject({
        action: 'onboarding:approved',
        meta: expect.objectContaining({ source: 'ai', outcomes: 3, routines: 3 }),
      });
    });

    it('attributes the plan to the source on the row, not the one in the body', async () => {
      profiles.getOrCreate.mockResolvedValue(
        profileRow({ pendingProposal: { source: 'template', proposal: proposal() } as never }),
      );

      await service.approve('u1', proposal(), MONDAY);

      const version = prisma.planVersion.create.mock.calls[0][0].data;

      expect(version.createdBy).toBe('USER');
      expect(version.status).toBe('ACTIVE');
      expect(version.userApproved).toBe(true);
      expect(version.version).toBe(1);
    });

    it('records that the user edited the plan before approving it', async () => {
      const edited = proposal();
      edited.firstWeekCommitments[0].durationMinutes = 15;

      await service.approve('u1', edited, MONDAY);

      expect(prisma.auditEvent.create.mock.calls[0][0].data.meta.edited).toBe(true);
    });

    it('rejects an edited plan that adds a fourth behaviour, naming the rule', async () => {
      const edited = proposal();
      edited.routines = [...edited.routines, { ...edited.routines[0], title: 'A fourth' }];

      const error = await service.approve('u1', edited, MONDAY).catch((e) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse().details.reason).toBe('PROPOSAL_INVALID');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('answers a second approve with 409 and creates nothing', async () => {
      profiles.getOrCreate.mockResolvedValue(profileRow({ onboardingCompletedAt: MONDAY }));

      const error = await service.approve('u1', proposal(), MONDAY).catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse().details.reason).toBe('ONBOARDING_ALREADY_COMPLETED');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('puts every selected domain into GROW', async () => {
      await service.approve('u1', proposal(), MONDAY);

      expect(prisma.domainMode.upsert).toHaveBeenCalledTimes(3);
    });
  });
});
