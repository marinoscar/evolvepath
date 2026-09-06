import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { FocusSessionService, MAX_DISTRACTION_NOTES } from './focus-session.service';

// =============================================================================
// Focus sessions (issue #110)
// =============================================================================
//
// `CommitmentActionsService` is mocked ON PURPOSE and the assertions check that
// it was CALLED. That is the contract this service is held to: it must not
// re-implement the state machine, and the only way to prove it does not is to
// prove it delegates.
// =============================================================================

const USER = 'user-1';
const COMMITMENT = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-09-08T09:30:00.000Z');

function card(over: Record<string, unknown> = {}) {
  return {
    id: COMMITMENT,
    title: 'Storyline',
    status: 'STARTED',
    timer: {
      activeSince: NOW.toISOString(),
      activeSeconds: 0,
      elapsedSeconds: 0,
      timerMinutes: 25,
      remainingSeconds: 1500,
    },
    ...over,
  };
}

interface BuildOptions {
  commitment?: Record<string, unknown> | null;
  active?: Record<string, unknown> | null;
  session?: Record<string, unknown> | null;
  startThrows?: Error;
}

function build(options: BuildOptions = {}) {
  const commitment =
    options.commitment === null
      ? null
      : {
          id: COMMITMENT,
          userId: USER,
          domain: 'WORK',
          title: 'Storyline',
          status: 'PLANNED',
          scheduledStart: NOW,
          scheduledEnd: null,
          activeSince: null,
          // 10 minutes banked by the time `stop` reads the row back.
          activeSeconds: 600,
          timerMinutes: 25,
          startedAt: NOW,
          completedAt: null,
          rescheduleCount: 0,
          importance: 3,
          fullVersion: null,
          shortVersion: null,
          minimumVersion: null,
          fullMinutes: null,
          shortMinutes: null,
          minimumMinutes: null,
          versionUsed: null,
          minutesSpent: null,
          outcomeId: null,
          workoutTemplateId: null,
          ritualId: null,
          familyMemberId: null,
          decomposedFromId: null,
          steps: null,
          ...options.commitment,
        };

  const sessionRow =
    options.session === null
      ? null
      : {
          id: SESSION,
          userId: USER,
          commitmentId: COMMITMENT,
          plannedMinutes: 25,
          instruction: 'Write the decision sentence',
          startedAt: new Date(NOW.getTime() - 600_000),
          endedAt: null,
          outcome: null,
          actualMinutes: null,
          continuedCount: 0,
          distractionNotes: [],
          evidenceId: null,
          ...options.session,
        };

  const created: { evidence: any[]; sessions: any[] } = { evidence: [], sessions: [] };

  const prisma: any = {
    commitment: {
      findFirst: jest.fn(async () => commitment),
      findUnique: jest.fn(async () => commitment),
    },
    focusSession: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.endedAt === null && where.id === undefined
          ? (options.active ?? null)
          : sessionRow,
      ),
      findMany: jest.fn(async () => (sessionRow ? [{ ...sessionRow, commitment }] : [])),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: SESSION,
          endedAt: null,
          outcome: null,
          actualMinutes: null,
          continuedCount: 0,
          distractionNotes: [],
          evidenceId: null,
          ...data,
        };
        created.sessions.push(row);
        return row;
      }),
      update: jest.fn(async ({ data }: any) => {
        const next = { ...sessionRow, ...data };
        if (data.continuedCount?.increment) {
          next.continuedCount = (sessionRow?.continuedCount ?? 0) + data.continuedCount.increment;
        }
        if (data.distractionNotes?.push) {
          next.distractionNotes = [
            ...(sessionRow?.distractionNotes ?? []),
            data.distractionNotes.push,
          ];
        }
        return next;
      }),
      delete: jest.fn(async () => sessionRow),
    },
    evidence: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `evidence-${created.evidence.length + 1}`, ...data };
        created.evidence.push(row);
        return row;
      }),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const actions = {
    start: options.startThrows
      ? jest.fn(async () => {
          throw options.startThrows;
        })
      : jest.fn(async () => card()),
    continue: jest.fn(async () => card({ timer: { ...card().timer, timerMinutes: 40 } })),
    complete: jest.fn(async () => card({ status: 'COMPLETED' })),
    partial: jest.fn(async () => card({ status: 'PARTIALLY_COMPLETED' })),
    pause: jest.fn(async () => card({ status: 'STARTED' })),
  };

  return {
    service: new FocusSessionService(prisma as never, actions as never),
    prisma,
    actions,
    created,
  };
}

describe('FocusSessionService.start', () => {
  it('creates the row and delegates the transition to E05', async () => {
    const { service, actions, created } = build();

    const view = await service.start(
      USER,
      { commitmentId: COMMITMENT, plannedMinutes: 25 },
      NOW,
    );

    expect(actions.start).toHaveBeenCalledTimes(1);
    expect(actions.start).toHaveBeenCalledWith(USER, COMMITMENT, { minutes: 25 });
    expect(created.sessions).toHaveLength(1);
    expect(view.plannedMinutes).toBe(25);
    expect(view.commitment.timer?.timerMinutes).toBe(25);
  });

  it('refuses a second session with 409 and the running session id', async () => {
    const { service } = build({ active: { id: 'other', commitmentId: 'c-other', endedAt: null } });

    await expect(
      service.start(USER, { commitmentId: COMMITMENT, plannedMinutes: 25 }, NOW),
    ).rejects.toMatchObject({
      response: {
        details: {
          reason: 'FOCUS_SESSION_ACTIVE',
          activeSessionId: 'other',
          commitmentId: 'c-other',
        },
      },
    });
  });

  it('with takeOver, ends the running session as ABANDONED first', async () => {
    const { service, prisma, actions } = build({
      active: {
        id: SESSION,
        userId: USER,
        commitmentId: COMMITMENT,
        plannedMinutes: 25,
        startedAt: new Date(NOW.getTime() - 600_000),
        endedAt: null,
        continuedCount: 0,
        distractionNotes: [],
      },
    });

    await service.start(
      USER,
      { commitmentId: COMMITMENT, plannedMinutes: 25, takeOver: true },
      NOW,
    );

    expect(prisma.focusSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outcome: 'ABANDONED' }) }),
    );
    expect(actions.start).toHaveBeenCalledTimes(1);
  });

  it('deletes the row when the commitment action refuses', async () => {
    const { service, prisma } = build({
      startThrows: new ConflictException('INVALID_TRANSITION'),
    });

    await expect(
      service.start(USER, { commitmentId: COMMITMENT, plannedMinutes: 25 }, NOW),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.focusSession.delete).toHaveBeenCalledWith({ where: { id: SESSION } });
  });

  it('refuses a non-WORK commitment', async () => {
    const { service } = build({ commitment: { domain: 'HEALTH' } });

    await expect(
      service.start(USER, { commitmentId: COMMITMENT, plannedMinutes: 25 }, NOW),
    ).rejects.toMatchObject({ response: { details: { reason: 'COMMITMENT_NOT_WORK' } } });
  });

  it.each(['COMPLETED', 'CANCELLED'])('refuses a %s commitment', async (status) => {
    const { service } = build({ commitment: { status } });

    await expect(
      service.start(USER, { commitmentId: COMMITMENT, plannedMinutes: 25 }, NOW),
    ).rejects.toMatchObject({ response: { details: { reason: 'COMMITMENT_NOT_STARTABLE' } } });
  });

  it("answers 404 for another user's commitment", async () => {
    const { service } = build({ commitment: null });

    await expect(
      service.start(USER, { commitmentId: COMMITMENT, plannedMinutes: 25 }, NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('FocusSessionService.extend', () => {
  it('raises both counters and delegates to continue', async () => {
    const { service, actions, prisma } = build();

    const view = await service.extend(USER, SESSION, { minutes: 15 }, NOW);

    expect(prisma.focusSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { plannedMinutes: 40, continuedCount: { increment: 1 } },
      }),
    );
    expect(actions.continue).toHaveBeenCalledWith(USER, COMMITMENT, { extraMinutes: 15 });
    expect(view.plannedMinutes).toBe(40);
    expect(view.continuedCount).toBe(1);
    expect(view.commitment.timer?.timerMinutes).toBe(40);
  });

  it('refuses once the session has ended', async () => {
    const { service } = build({ session: { endedAt: NOW } });

    await expect(service.extend(USER, SESSION, { minutes: 15 }, NOW)).rejects.toMatchObject({
      response: { details: { reason: 'FOCUS_SESSION_ENDED' } },
    });
  });
});

describe('FocusSessionService.addNote', () => {
  it('trims and appends', async () => {
    const { service, prisma } = build();

    const view = await service.addNote(USER, SESSION, '  Checked Slack  ', NOW);

    expect(prisma.focusSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { distractionNotes: { push: 'Checked Slack' } } }),
    );
    expect(view.distractionNotes).toEqual(['Checked Slack']);
  });

  it(`refuses the note past ${MAX_DISTRACTION_NOTES}`, async () => {
    const { service } = build({
      session: { distractionNotes: Array.from({ length: MAX_DISTRACTION_NOTES }, () => 'x') },
    });

    await expect(service.addNote(USER, SESSION, 'one more', NOW)).rejects.toMatchObject({
      response: { details: { reason: 'TOO_MANY_NOTES' } },
    });
  });

  it('refuses once the session has ended', async () => {
    const { service } = build({ session: { endedAt: NOW } });

    await expect(service.addNote(USER, SESSION, 'x', NOW)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('FocusSessionService.stop', () => {
  it('completes, writes TIMER evidence from the banked seconds, and links it', async () => {
    const { service, actions, created } = build();

    const result = await service.stop(USER, SESSION, { outcome: 'done' }, NOW);

    expect(actions.complete).toHaveBeenCalledWith(USER, COMMITMENT, { notes: null });
    expect(created.evidence).toHaveLength(1);
    expect(created.evidence[0]).toMatchObject({
      evidenceType: 'focus_session',
      source: 'TIMER',
      quantitativeValue: 10, // 600 banked seconds
      quantitativeUnit: 'minutes',
      qualitativeValue: 'done',
    });
    expect(result.actualMinutes).toBe(10);
    expect(result.evidenceId).toBe('evidence-1');
    expect(result.commitmentStatus).toBe('COMPLETED');
    expect(result.session.outcome).toBe('DONE');
  });

  it('partial goes through the partial action', async () => {
    const { service, actions } = build();

    const result = await service.stop(USER, SESSION, { outcome: 'partial' }, NOW);

    expect(actions.partial).toHaveBeenCalled();
    expect(result.commitmentStatus).toBe('PARTIALLY_COMPLETED');
  });

  it('abandoned pauses, leaves the commitment open, and still writes evidence', async () => {
    const { service, actions, created } = build({
      commitment: { status: 'STARTED', activeSince: new Date(NOW.getTime() - 60_000) },
    });

    const result = await service.stop(USER, SESSION, { outcome: 'abandoned' }, NOW);

    expect(actions.pause).toHaveBeenCalled();
    expect(actions.complete).not.toHaveBeenCalled();
    expect(result.commitmentStatus).toBe('STARTED');
    expect(created.evidence).toHaveLength(1);
    expect(created.evidence[0].qualitativeValue).toBe('abandoned');
  });

  it('abandoned on an already-paused commitment does not call pause', async () => {
    const { service, actions, created } = build({
      commitment: { status: 'STARTED', activeSince: null },
    });

    await service.stop(USER, SESSION, { outcome: 'abandoned' }, NOW);

    expect(actions.pause).not.toHaveBeenCalled();
    expect(created.evidence).toHaveLength(1);
  });

  it('floors the recorded minutes at 1', async () => {
    const { service } = build({ commitment: { activeSeconds: 5, activeSince: null } });

    const result = await service.stop(USER, SESSION, { outcome: 'partial' }, NOW);

    expect(result.actualMinutes).toBe(1);
  });

  it('refuses a second stop', async () => {
    const { service } = build({ session: { endedAt: NOW } });

    await expect(service.stop(USER, SESSION, { outcome: 'done' }, NOW)).rejects.toMatchObject({
      response: { details: { reason: 'FOCUS_SESSION_ENDED' } },
    });
  });

  it("answers 404 for another user's session", async () => {
    const { service } = build({ session: null });

    await expect(service.stop(USER, SESSION, { outcome: 'done' }, NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('FocusSessionService.list', () => {
  it('filters by commitment', async () => {
    const { service, prisma } = build();

    await service.list(USER, { commitmentId: COMMITMENT }, NOW);

    expect(prisma.focusSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER, commitmentId: COMMITMENT }),
        orderBy: { startedAt: 'desc' },
      }),
    );
  });

  it('refuses a window over 93 days', async () => {
    const { service } = build();

    await expect(
      service.list(
        USER,
        { from: '2026-01-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
        NOW,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('FocusSessionService.getActive', () => {
  it('returns serverNow so a skewed client can re-anchor', async () => {
    const { service } = build({ active: null });

    const result = await service.getActive(USER, NOW);

    expect(result.session).toBeNull();
    expect(result.serverNow).toBe(NOW.toISOString());
  });
});
