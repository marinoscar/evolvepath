import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService, MockPrismaService } from '../../../test/mocks/prisma.mock';
import { CommitmentsService } from '../commitments.service';
import { DecompositionService } from '../decomposition/decomposition.service';
import { templateProposal } from '../decomposition/decomposition.schema';
import { CommitmentActionsService } from './commitment-actions.service';

describe('CommitmentActionsService (#40)', () => {
  let service: CommitmentActionsService;
  let prisma: MockPrismaService;
  let commitments: { transition: jest.Mock };
  let decomposition: { propose: jest.Mock };

  const userId = 'user-123';
  const id = '55555555-5555-4555-8555-555555555555';
  const otherId = '66666666-6666-4666-8666-666666666666';
  const start = new Date('2026-03-01T09:00:00.000Z');

  const row = (over: Record<string, unknown> = {}) =>
    ({
      id,
      userId,
      domain: 'WORK',
      title: 'Draft the proposal storyline',
      outcomeId: null,
      planVersionId: null,
      routineId: null,
      scheduledStart: start,
      scheduledEnd: null,
      importance: 5,
      commitmentType: null,
      fullVersion: null,
      shortVersion: null,
      minimumVersion: null,
      fullMinutes: null,
      shortMinutes: null,
      minimumMinutes: null,
      status: 'PLANNED',
      rescheduleCount: 0,
      rescheduledFromId: null,
      skipReason: null,
      skipNote: null,
      userConfirmed: false,
      startedAt: null,
      completedAt: null,
      activeSince: null,
      activeSeconds: 0,
      timerMinutes: null,
      versionUsed: null,
      minutesSpent: null,
      steps: null,
      decomposedFromId: null,
      createdAt: start,
      updatedAt: start,
      ...over,
    }) as never;

  /** What `evidence.create` was called with, by `evidenceType`. */
  const evidenceOf = (type: string) =>
    prisma.evidence.create.mock.calls
      .map(([args]) => (args as { data: Record<string, unknown> }).data)
      .find((data) => data.evidenceType === type);

  const auditActions = () =>
    prisma.auditEvent.create.mock.calls.map(
      ([args]) => (args as { data: { action: string } }).data.action,
    );

  beforeEach(async () => {
    prisma = createMockPrismaService();
    commitments = { transition: jest.fn() };
    decomposition = { propose: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommitmentActionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CommitmentsService, useValue: commitments },
        { provide: DecompositionService, useValue: decomposition },
      ],
    }).compile();

    service = module.get(CommitmentActionsService);

    prisma.$transaction.mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : arg,
    );
    prisma.commitment.findMany.mockResolvedValue([] as never);
    prisma.auditEvent.create.mockResolvedValue({ id: 'audit-1' } as never);
    prisma.evidence.create.mockResolvedValue({ id: 'evidence-1' } as never);
    prisma.reflection.create.mockResolvedValue({ id: 'reflection-1' } as never);
  });

  // ---------------------------------------------------------------------------

  describe('ownership', () => {
    // 404, never 403: a 403 would confirm the id is real.
    it.each([
      ['start', () => service.start(userId, id, {} as never)],
      ['pause', () => service.pause(userId, id)],
      ['continue', () => service.continue(userId, id, {} as never)],
      ['complete', () => service.complete(userId, id, {} as never)],
      ['partial', () => service.partial(userId, id, {} as never)],
      ['fallback', () => service.fallback(userId, id, { version: 'short' } as never)],
      ['reschedule', () =>
        service.reschedule(userId, id, { scheduledStart: start.toISOString() } as never)],
      ['skip', () => service.skip(userId, id, { reason: 'AVOIDED' } as never)],
      ['decompose/apply', () =>
        service.applyDecomposition(userId, id, templateProposal())],
    ])("answers 404 for another user's commitment on %s", async (_name, call) => {
      prisma.commitment.findFirst.mockResolvedValue(null as never);

      await expect(call()).rejects.toThrow(NotFoundException);
    });

    it('answers 404 on decompose too', async () => {
      prisma.commitment.findFirst.mockResolvedValue(null as never);

      await expect(service.propose(userId, id, null)).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------

  describe('start', () => {
    it('moves to STARTED, stamps the timer and writes APP_FLOW started', async () => {
      prisma.commitment.findFirst.mockResolvedValue(row());
      prisma.commitment.update.mockResolvedValue(
        row({ status: 'STARTED', startedAt: start, activeSince: start, timerMinutes: 10 }),
      );

      const card = await service.start(userId, id, { minutes: 10 } as never);

      const data = prisma.commitment.update.mock.calls[0][0].data as Record<string, unknown>;
      expect(data.status).toBe('STARTED');
      expect(data.activeSince).toBeInstanceOf(Date);
      expect(data.activeSeconds).toBe(0);
      expect(data.timerMinutes).toBe(10);

      expect(evidenceOf('started')).toMatchObject({
        source: 'APP_FLOW',
        quantitativeValue: 10,
        confidence: 1,
      });
      expect(card.status).toBe('STARTED');
      expect(auditActions()).toContain('commitment:start');
    });

    it('never rewrites startedAt on a later start', async () => {
      const first = new Date('2026-03-01T08:00:00.000Z');
      prisma.commitment.findFirst.mockResolvedValue(row({ status: 'READY', startedAt: first }));
      prisma.commitment.update.mockResolvedValue(row({ status: 'STARTED', startedAt: first }));

      await service.start(userId, id, {} as never);

      const data = prisma.commitment.update.mock.calls[0][0].data as Record<string, unknown>;
      expect(data.startedAt).toBe(first);
    });

    // To a user there is one button; erroring would punish them for a
    // distinction they cannot see.
    it('resumes a paused commitment instead of erroring', async () => {
      prisma.commitment.findFirst.mockResolvedValue(
        row({ status: 'STARTED', startedAt: start, activeSince: null, activeSeconds: 90 }),
      );
      prisma.commitment.update.mockResolvedValue(
        row({ status: 'STARTED', startedAt: start, activeSince: new Date(), activeSeconds: 90 }),
      );

      await service.start(userId, id, {} as never);

      expect(evidenceOf('continued')).toBeDefined();
      expect(evidenceOf('started')).toBeUndefined();
    });

    it('is a no-op on a commitment whose timer is already running', async () => {
      prisma.commitment.findFirst.mockResolvedValue(
        row({ status: 'STARTED', startedAt: start, activeSince: start }),
      );

      await service.start(userId, id, {} as never);

      expect(prisma.commitment.update).not.toHaveBeenCalled();
      expect(prisma.evidence.create).not.toHaveBeenCalled();
    });

    // Two commitments claiming the same wall-clock minutes would make every
    // later "how long did this take" answer a lie.
    it('pauses whatever else the user left running, with its own evidence', async () => {
      prisma.commitment.findFirst.mockResolvedValue(row());
      prisma.commitment.findMany.mockResolvedValue([
        row({
          id: otherId,
          status: 'STARTED',
          activeSince: new Date('2026-03-01T08:58:00.000Z'),
          activeSeconds: 30,
        }),
      ] as never);
      prisma.commitment.update.mockResolvedValue(row({ status: 'STARTED' }));

      await service.start(userId, id, {} as never);

      const pausedOther = prisma.commitment.update.mock.calls.find(
        ([args]) => (args as { where: { id: string } }).where.id === otherId,
      );
      expect(pausedOther).toBeDefined();
      expect(
        (pausedOther![0] as { data: Record<string, unknown> }).data.activeSince,
      ).toBeNull();
      expect(evidenceOf('paused')).toMatchObject({ commitmentId: otherId });
    });

    it('refuses to start a terminal commitment with INVALID_TRANSITION', async () => {
      prisma.commitment.findFirst.mockResolvedValue(row({ status: 'COMPLETED' }));

      await expect(service.start(userId, id, {} as never)).rejects.toMatchObject({
        response: { details: { reason: 'INVALID_TRANSITION' } },
      });
    });
  });

  // ---------------------------------------------------------------------------

  describe('pause and continue', () => {
    it('banks the running seconds and stops the clock, staying STARTED', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-01T09:01:00.000Z'));
      prisma.commitment.findFirst.mockResolvedValue(
        row({ status: 'STARTED', startedAt: start, activeSince: start, activeSeconds: 0 }),
      );
      prisma.commitment.update.mockResolvedValue(
        row({ status: 'STARTED', startedAt: start, activeSince: null, activeSeconds: 60 }),
      );

      const card = await service.pause(userId, id);

      const data = prisma.commitment.update.mock.calls[0][0].data as Record<string, unknown>;
      expect(data).toEqual({ activeSince: null, activeSeconds: 60 });
      expect(card.status).toBe('STARTED');
      expect(evidenceOf('paused')).toMatchObject({ quantitativeValue: 60, source: 'APP_FLOW' });
      jest.useRealTimers();
    });

    it('refuses to pause a commitment that was never started', async () => {
      prisma.commitment.findFirst.mockResolvedValue(row());

      await expect(service.pause(userId, id)).rejects.toThrow(ConflictException);
    });

    it('adds extraMinutes to the existing target on continue', async () => {
      prisma.commitment.findFirst.mockResolvedValue(
        row({ status: 'STARTED', startedAt: start, activeSince: null, timerMinutes: 10 }),
      );
      prisma.commitment.update.mockResolvedValue(
        row({ status: 'STARTED', startedAt: start, timerMinutes: 25 }),
      );

      await service.continue(userId, id, { extraMinutes: 15 } as never);

      const data = prisma.commitment.update.mock.calls[0][0].data as Record<string, unknown>;
      expect(data.timerMinutes).toBe(25);
    });

    // "Continue another 15?" fires while the session is still running past its
    // target. Refusing would leave the user's only way forward a pause followed
    // by a continue, writing a `paused` evidence row for a pause that never
    // happened.
    it('extends the target of a still-running session without touching the clock', async () => {
      prisma.commitment.findFirst.mockResolvedValue(
        row({ status: 'STARTED', startedAt: start, activeSince: start, timerMinutes: 5 }),
      );
      prisma.commitment.update.mockResolvedValue(
        row({ status: 'STARTED', startedAt: start, activeSince: start, timerMinutes: 20 }),
      );

      await service.continue(userId, id, { extraMinutes: 15 } as never);

      const data = prisma.commitment.update.mock.calls[0][0].data as Record<string, unknown>;
      expect(data.timerMinutes).toBe(20);
      // Re-anchoring would silently discard the seconds already accumulated.
      expect(data).not.toHaveProperty('activeSince');
    });

    it('refuses to continue a commitment that is not started at all', async () => {
      prisma.commitment.findFirst.mockResolvedValue(row({ status: 'PLANNED' }));

      await expect(service.continue(userId, id, {} as never)).rejects.toThrow(ConflictException);
    });

    it('refuses to continue a terminal commitment', async () => {
      prisma.commitment.findFirst.mockResolvedValue(row({ status: 'COMPLETED' }));

      await expect(service.continue(userId, id, {} as never)).rejects.toMatchObject({
        response: { details: { reason: 'INVALID_TRANSITION' } },
      });
    });
  });

  // ---------------------------------------------------------------------------

  describe('complete and partial', () => {
    it('derives minutesSpent from the timer and tags FULL when no fallback was chosen', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-01T09:10:00.000Z'));
      prisma.commitment.findFirst.mockResolvedValue(
        row({ status: 'STARTED', startedAt: start, activeSince: start, activeSeconds: 0 }),
      );
      prisma.commitment.update.mockResolvedValue(row({ status: 'COMPLETED' }));

      await service.complete(userId, id, {} as never);

      const data = prisma.commitment.update.mock.calls[0][0].data as Record<string, unknown>;
      expect(data.minutesSpent).toBe(10);
      expect(data.versionUsed).toBe('FULL');
      // Folded in so the record does not depend on the user remembering to pause.
      expect(data.activeSince).toBeNull();
      expect(data.activeSeconds).toBe(600);

      expect(JSON.parse(evidenceOf('completed')!.qualitativeValue as string)).toEqual({
        notes: null,
        versionUsed: 'FULL',
        fallbackUsed: false,
      });
      expect(evidenceOf('completed')).toMatchObject({ source: 'USER_LOG' });
      jest.useRealTimers();
    });

    it("lets the user's own minutesSpent win over the timer", async () => {
      prisma.commitment.findFirst.mockResolvedValue(
        row({ status: 'STARTED', startedAt: start, activeSeconds: 60 }),
      );
      prisma.commitment.update.mockResolvedValue(row({ status: 'COMPLETED' }));

      await service.complete(userId, id, { minutesSpent: 45 } as never);

      const data = prisma.commitment.update.mock.calls[0][0].data as Record<string, unknown>;
      expect(data.minutesSpent).toBe(45);
    });

    // The alternative is manufacturing a start the product never observed.
    it('completes a never-started commitment without inventing a start', async () => {
      prisma.commitment.findFirst.mockResolvedValue(row());
      prisma.commitment.update.mockResolvedValue(row({ status: 'COMPLETED' }));

      await service.complete(userId, id, {} as never);

      const data = prisma.commitment.update.mock.calls[0][0].data as Record<string, unknown>;
      expect(data.status).toBe('COMPLETED');
      expect(data).not.toHaveProperty('startedAt');
      expect(evidenceOf('started')).toBeUndefined();
      expect(evidenceOf('completed')).toBeDefined();
    });

    it('records a fallback completion as such', async () => {
      prisma.commitment.findFirst.mockResolvedValue(
        row({ status: 'STARTED', startedAt: start, versionUsed: 'MINIMUM' }),
      );
      prisma.commitment.update.mockResolvedValue(row({ status: 'COMPLETED' }));

      await service.complete(userId, id, {} as never);

      expect(JSON.parse(evidenceOf('completed')!.qualitativeValue as string)).toMatchObject({
        versionUsed: 'MINIMUM',
        fallbackUsed: true,
      });
    });

    it('moves to PARTIALLY_COMPLETED with its own evidence type', async () => {
      prisma.commitment.findFirst.mockResolvedValue(row({ status: 'STARTED', startedAt: start }));
      prisma.commitment.update.mockResolvedValue(row({ status: 'PARTIALLY_COMPLETED' }));

      await service.partial(userId, id, {} as never);

      const data = prisma.commitment.update.mock.calls[0][0].data as Record<string, unknown>;
      expect(data.status).toBe('PARTIALLY_COMPLETED');
      expect(evidenceOf('partially_completed')).toBeDefined();
      expect(auditActions()).toContain('commitment:partial');
    });

    it('never puts the user’s notes in the audit row', async () => {
      prisma.commitment.findFirst.mockResolvedValue(row());
      prisma.commitment.update.mockResolvedValue(row({ status: 'COMPLETED' }));

      await service.complete(userId, id, { notes: 'felt awful about this' } as never);

      const meta = JSON.stringify(prisma.auditEvent.create.mock.calls[0][0]);
      expect(meta).not.toContain('felt awful');
    });
  });

  // ---------------------------------------------------------------------------

  describe('fallback', () => {
    it('sets versionUsed without changing the status', async () => {
      prisma.commitment.findFirst.mockResolvedValue(
        row({ minimumVersion: 'Open the doc', minimumMinutes: 5 }),
      );
      prisma.commitment.update.mockResolvedValue(row({ versionUsed: 'MINIMUM' }));

      await service.fallback(userId, id, { version: 'minimum' } as never);

      const data = prisma.commitment.update.mock.calls[0][0].data as Record<string, unknown>;
      expect(data).toEqual({ versionUsed: 'MINIMUM' });
      expect(JSON.parse(evidenceOf('fallback_selected')!.qualitativeValue as string)).toEqual({
        version: 'MINIMUM',
        fallbackUsed: true,
      });
    });

    it('rejects a version the commitment never declared', async () => {
      prisma.commitment.findFirst.mockResolvedValue(row());

      await expect(
        service.fallback(userId, id, { version: 'short' } as never),
      ).rejects.toMatchObject({
        response: { details: { reason: 'VERSION_NOT_DEFINED' } },
      });
      expect(prisma.commitment.update).not.toHaveBeenCalled();
    });

    it('is a BadRequest, not a conflict — the body named a version that is not there', async () => {
      prisma.commitment.findFirst.mockResolvedValue(row());

      await expect(
        service.fallback(userId, id, { version: 'minimum' } as never),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------

  describe('reschedule', () => {
    const replacementId = '77777777-7777-4777-8777-777777777777';
    const to = '2026-03-02T07:00:00.000Z';

    it('delegates to the transition matrix and returns the NEW row', async () => {
      prisma.commitment.findFirst.mockResolvedValue(row());
      commitments.transition.mockResolvedValue({
        commitment: { id, status: 'RESCHEDULED' },
        rescheduledTo: { id: replacementId },
        evidence: null,
      });
      prisma.commitment.findUniqueOrThrow.mockResolvedValue(
        row({
          id: replacementId,
          scheduledStart: new Date(to),
          rescheduleCount: 1,
          rescheduledFromId: id,
        }),
      );

      const card = await service.reschedule(userId, id, { scheduledStart: to } as never);

      expect(commitments.transition).toHaveBeenCalledWith(userId, id, {
        to: 'RESCHEDULED',
        rescheduleTo: to,
      });
      expect(card.id).toBe(replacementId);
      expect(card.rescheduleCount).toBe(1);
    });

    // The live intention carries its own move history; the closed row keeps only
    // what happened before it moved.
    it('writes the rescheduled evidence on the new row, never the original', async () => {
      prisma.commitment.findFirst.mockResolvedValue(row());
      commitments.transition.mockResolvedValue({
        commitment: { id, status: 'RESCHEDULED' },
        rescheduledTo: { id: replacementId },
        evidence: null,
      });
      prisma.commitment.findUniqueOrThrow.mockResolvedValue(
        row({ id: replacementId, scheduledStart: new Date(to), rescheduleCount: 1 }),
      );

      await service.reschedule(userId, id, { scheduledStart: to } as never);

      const evidence = evidenceOf('rescheduled')!;
      expect(evidence.commitmentId).toBe(replacementId);
      expect(JSON.parse(evidence.qualitativeValue as string)).toEqual({
        from: start.toISOString(),
        to,
        count: 1,
      });
    });

    it('applies a scheduledEnd from the body to the new row', async () => {
      prisma.commitment.findFirst.mockResolvedValue(row());
      commitments.transition.mockResolvedValue({
        commitment: { id, status: 'RESCHEDULED' },
        rescheduledTo: { id: replacementId },
        evidence: null,
      });
      prisma.commitment.update.mockResolvedValue(
        row({ id: replacementId, scheduledStart: new Date(to), rescheduleCount: 1 }),
      );

      await service.reschedule(userId, id, {
        scheduledStart: to,
        scheduledEnd: '2026-03-02T08:00:00.000Z',
      } as never);

      expect(prisma.commitment.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: replacementId } }),
      );
    });

    it('refuses to move a started commitment with ALREADY_STARTED', async () => {
      prisma.commitment.findFirst.mockResolvedValue(
        row({ status: 'STARTED', startedAt: start, activeSince: start }),
      );

      await expect(
        service.reschedule(userId, id, { scheduledStart: to } as never),
      ).rejects.toMatchObject({ response: { details: { reason: 'ALREADY_STARTED' } } });
      expect(commitments.transition).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------

  describe('skip', () => {
    it('stores the enum, the note, and a reflection tagged with the reason', async () => {
      prisma.commitment.findFirst.mockResolvedValue(row());
      prisma.commitment.update.mockResolvedValue(
        row({ status: 'SKIPPED', skipReason: 'UNEXPECTED_CONFLICT' }),
      );

      await service.skip(userId, id, {
        reason: 'UNEXPECTED_CONFLICT',
        text: 'in-laws visiting',
      } as never);

      const data = prisma.commitment.update.mock.calls[0][0].data as Record<string, unknown>;
      expect(data).toEqual({
        status: 'SKIPPED',
        skipReason: 'UNEXPECTED_CONFLICT',
        skipNote: 'in-laws visiting',
      });

      expect(prisma.reflection.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          relatedType: 'commitment',
          relatedId: id,
          commitmentId: id,
          userText: 'in-laws visiting',
          frictionTags: ['UNEXPECTED_CONFLICT'],
        }),
      });
    });

    // A skip is not execution: recording it as evidence would make "what did you
    // do this week" include the things you did not do.
    it('writes no evidence', async () => {
      prisma.commitment.findFirst.mockResolvedValue(row());
      prisma.commitment.update.mockResolvedValue(row({ status: 'SKIPPED' }));

      await service.skip(userId, id, { reason: 'AVOIDED' } as never);

      expect(prisma.evidence.create).not.toHaveBeenCalled();
    });

    it('keeps the note out of the audit row', async () => {
      prisma.commitment.findFirst.mockResolvedValue(row());
      prisma.commitment.update.mockResolvedValue(row({ status: 'SKIPPED' }));

      await service.skip(userId, id, { reason: 'AVOIDED', text: 'dreading it' } as never);

      const audited = JSON.stringify(prisma.auditEvent.create.mock.calls[0][0]);
      expect(audited).toContain('AVOIDED');
      expect(audited).not.toContain('dreading it');
    });
  });

  // ---------------------------------------------------------------------------

  describe('decompose', () => {
    it('writes nothing at all', async () => {
      prisma.commitment.findFirst.mockResolvedValue(row());
      decomposition.propose.mockResolvedValue(templateProposal());

      const proposal = await service.propose(userId, id, 'only ten minutes');

      expect(proposal.source).toBe('template');
      expect(prisma.commitment.create).not.toHaveBeenCalled();
      expect(prisma.commitment.update).not.toHaveBeenCalled();
      expect(prisma.evidence.create).not.toHaveBeenCalled();
    });

    it('creates the child on apply and leaves the parent untouched', async () => {
      prisma.commitment.findFirst.mockResolvedValue(row({ outcomeId: 'outcome-1', importance: 4 }));
      prisma.commitment.create.mockResolvedValue(
        row({ id: '88888888-8888-4888-8888-888888888888', decomposedFromId: id }),
      );

      const proposal = {
        steps: [
          { title: 'Open the doc', minutes: 5 },
          { title: 'Write one sentence', minutes: 10 },
        ],
        firstStep: { title: 'Open the doc', minutes: 5 },
        message: 'Start here.',
        source: 'ai' as const,
      };

      const card = await service.applyDecomposition(userId, id, proposal);

      const data = prisma.commitment.create.mock.calls[0][0].data as Record<string, unknown>;
      expect(data).toMatchObject({
        title: 'Open the doc',
        fullVersion: 'Open the doc',
        fullMinutes: 5,
        minimumMinutes: 5,
        decomposedFromId: id,
        status: 'PLANNED',
        outcomeId: 'outcome-1',
        importance: 4,
      });
      expect(data.steps).toEqual(proposal.steps);

      expect(prisma.commitment.update).not.toHaveBeenCalled();
      expect(card.decomposedFromId).toBe(id);
      expect(auditActions()).toContain('commitment:decompose_apply');
    });

    // Creating a smaller commitment is still a plan (PRD §10.9).
    it('writes no evidence on apply', async () => {
      prisma.commitment.findFirst.mockResolvedValue(row());
      prisma.commitment.create.mockResolvedValue(row({ decomposedFromId: id }));

      await service.applyDecomposition(userId, id, templateProposal());

      expect(prisma.evidence.create).not.toHaveBeenCalled();
    });

    it('holds an edited proposal to the same contract the model was', async () => {
      prisma.commitment.findFirst.mockResolvedValue(row());

      await expect(
        service.applyDecomposition(userId, id, {
          ...templateProposal(),
          firstStep: { title: 'A whole afternoon', minutes: 240 },
        } as never),
      ).rejects.toThrow();
      expect(prisma.commitment.create).not.toHaveBeenCalled();
    });
  });
});
