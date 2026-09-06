import { BadRequestException, NotFoundException } from '@nestjs/common';

import { FrictionService } from './friction.service';

// =============================================================================
// The friction answer, and the four ways the coach's reply is discarded (#116)
// =============================================================================
//
// The override cases are the point of this file. The intervention type is
// decided from the ANSWER, deterministically, before the model is called — and
// a reply that claims a different one, or recommends half an hour, or names
// another commitment, is thrown away in favour of the template. The user cannot
// tell a confident wrong sentence from a right one, so the server has to.
// =============================================================================

const USER = 'user-1';
const COMMITMENT = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-09-08T14:00:00.000Z');

function reply(over: Record<string, unknown> = {}) {
  return {
    intervention_type: 'DECOMPOSITION',
    reasoning_summary: 'Moved twice and described as too big.',
    user_message: 'Write only the first three bullets.',
    recommended_action: {
      title: 'Write the first three bullets',
      duration_minutes: 10,
      commitmentId: COMMITMENT,
    },
    fallback_action: null,
    proposal: null,
    friction_question: null,
    ...over,
  };
}

interface BuildOptions {
  commitment?: Record<string, unknown> | null;
  aiResult?: unknown;
  safety?: Record<string, unknown>;
  obstacle?: Record<string, unknown> | null;
  busy?: Array<Record<string, unknown>>;
}

function build(options: BuildOptions = {}) {
  const commitment =
    options.commitment === null
      ? null
      : {
          id: COMMITMENT,
          userId: USER,
          domain: 'WORK',
          title: 'Finish the strategy presentation',
          outcomeId: 'outcome-1',
          scheduledStart: new Date('2026-09-08T09:00:00.000Z'),
          scheduledEnd: new Date('2026-09-08T09:25:00.000Z'),
          rescheduleCount: 2,
          minimumVersion: 'Open the deck and write one line',
          minimumMinutes: 5,
          fullMinutes: 25,
          importance: 4,
          status: 'PLANNED',
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          ...options.commitment,
        };

  const created: { reflections: any[]; obstacles: any[]; audits: any[]; updates: any[] } = {
    reflections: [],
    obstacles: [],
    audits: [],
    updates: [],
  };

  const prisma: any = {
    commitment: {
      findFirst: jest.fn(async () => commitment),
      findMany: jest.fn(async () => options.busy ?? []),
    },
    outcome: {
      findFirst: jest.fn(async () => ({
        id: 'outcome-1',
        title: 'Win the budget',
        motivation: 'The board decides budget on it',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      })),
      findMany: jest.fn(async () => [
        { id: 'outcome-1', createdAt: new Date('2026-08-01T00:00:00.000Z') },
      ]),
    },
    evidence: { findMany: jest.fn(async () => []) },
    reflection: {
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `reflection-${created.reflections.length + 1}`, ...data };
        created.reflections.push(row);
        return row;
      }),
    },
    obstacle: {
      findFirst: jest.fn(async () => options.obstacle ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: 'obstacle-1', ...data };
        created.obstacles.push(row);
        return row;
      }),
      update: jest.fn(async ({ data }: any) => {
        created.updates.push(data);
        return { id: 'obstacle-1', ...data };
      }),
    },
    auditEvent: {
      create: jest.fn(async ({ data }: any) => {
        created.audits.push(data);
        return data;
      }),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const ai = {
    invoke: jest.fn(
      async (
        _request: unknown,
      ): Promise<unknown> =>
        options.aiResult ?? { ok: true, invocationId: 'inv-1', output: reply() },
    ),
  };

  const safety = {
    evaluate: jest.fn(async () => options.safety ?? { decision: 'allow', category: 'none', source: 'precheck' }),
  };

  const avoidance = {
    assessOne: jest.fn(async () => ({
      level: 3,
      interventionType: 'FRICTION_DIAGNOSIS',
      signals: ['RESCHEDULED_TWICE'],
      rationale: 'This has been moved 2 times.',
      suggestedAction: 'FRICTION_QUESTION',
    })),
  };

  const profiles = {
    find: jest.fn(async () => ({ timezone: 'UTC', coachingStyle: 'BALANCED' })),
  };

  return {
    service: new FrictionService(
      prisma as never,
      ai as never,
      safety as never,
      avoidance as never,
      profiles as never,
    ),
    prisma,
    ai,
    safety,
    created,
  };
}

describe('FrictionService.answer — the record', () => {
  it('writes one reflection tagged with the answer', async () => {
    const { service, created } = build();

    await service.answer(USER, COMMITMENT, { answer: 'TOO_BIG' }, NOW);

    expect(created.reflections).toHaveLength(1);
    expect(created.reflections[0]).toMatchObject({
      relatedType: 'commitment',
      commitmentId: COMMITMENT,
      frictionTags: ['TOO_BIG'],
    });
  });

  it('creates the obstacle the answer names, at one sighting', async () => {
    const { service, created } = build();

    await service.answer(USER, COMMITMENT, { answer: 'TOO_BIG' }, NOW);

    expect(created.obstacles[0]).toMatchObject({
      domain: 'WORK',
      type: 'TASK_TOO_LARGE',
      observedCount: 1,
    });
    expect(created.obstacles[0].confidence).toBeCloseTo(1 / 3);
  });

  it('increments an existing obstacle rather than creating a second', async () => {
    const { service, created, prisma } = build({
      obstacle: { id: 'obstacle-1', observedCount: 1, interventionHistory: [] },
    });

    await service.answer(USER, COMMITMENT, { answer: 'TOO_BIG' }, NOW);

    expect(prisma.obstacle.create).not.toHaveBeenCalled();
    expect(created.updates[0]).toMatchObject({ observedCount: 2 });
    expect(created.updates[0].confidence).toBeCloseTo(2 / 3);
    expect(created.updates[0].interventionHistory).toHaveLength(1);
  });

  it('audits once, with the answer and level but never the text', async () => {
    const { service, created } = build();

    await service.answer(USER, COMMITMENT, { answer: 'TIRED', text: 'private words' }, NOW);

    expect(created.audits).toHaveLength(1);
    expect(created.audits[0]).toMatchObject({
      action: 'work:friction_answered',
      targetId: COMMITMENT,
      meta: { answer: 'TIRED', level: 3, interventionType: 'REDUCE_SCOPE' },
    });
    expect(JSON.stringify(created.audits[0])).not.toContain('private words');
  });
});

describe('FrictionService.answer — the coach', () => {
  it('asks for wording with the required type in the input', async () => {
    const { service, ai } = build();

    await service.answer(USER, COMMITMENT, { answer: 'TOO_BIG' }, NOW);

    expect(ai.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        persona: 'coach',
        promptVersion: 'work-friction.v1',
        schemaName: 'coach_reply',
      }),
    );
    const request = ai.invoke.mock.calls[0][0] as { input: string };
    expect(request.input).toContain('"requiredInterventionType":"DECOMPOSITION"');
  });

  it('uses the reply when it passes every guard', async () => {
    const { service } = build();

    const result = await service.answer(USER, COMMITMENT, { answer: 'TOO_BIG' }, NOW);

    expect(result.intervention.source).toBe('ai');
    expect(result.intervention.userMessage).toBe('Write only the first three bullets.');
  });

  it.each([
    ['a different intervention type', { intervention_type: 'GOAL_CHALLENGE' }],
    [
      'an action longer than fifteen minutes',
      {
        recommended_action: {
          title: 'Do the whole thing',
          duration_minutes: 30,
          commitmentId: COMMITMENT,
        },
      },
    ],
    [
      "another commitment's id",
      {
        recommended_action: {
          title: 'Write three bullets',
          duration_minutes: 10,
          commitmentId: '99999999-9999-4999-8999-999999999999',
        },
      },
    ],
    [
      'a plan proposal of its own',
      {
        proposal: {
          kind: 'plan_change',
          planId: '99999999-9999-4999-8999-999999999999',
          summary: 'Move it',
          changes: [{}],
        },
      },
    ],
    [
      'a friction question of its own',
      { friction_question: { prompt: 'What is hard?', options: ['a', 'b'] } },
    ],
  ])('discards a reply with %s and sends the template', async (_label, override) => {
    const { service } = build({
      aiResult: { ok: true, invocationId: 'inv-1', output: reply(override) },
    });

    const result = await service.answer(USER, COMMITMENT, { answer: 'TOO_BIG' }, NOW);

    expect(result.intervention.source).toBe('template');
    // The mapping still holds — the answer decided it, not the model.
    expect(result.intervention.interventionType).toBe('DECOMPOSITION');
  });

  it('falls back to the template when the provider is down', async () => {
    const { service } = build({
      aiResult: { ok: false, invocationId: 'i', error: { code: 'network', message: 'down' } },
    });

    const result = await service.answer(USER, COMMITMENT, { answer: 'WORRIED_ABOUT_QUALITY' }, NOW);

    expect(result.intervention.source).toBe('template');
    expect(result.intervention.interventionType).toBe('PERFECTIONISM_REFRAME');
    expect(result.intervention.userMessage).toContain('rough draft');
  });
});

describe('FrictionService.answer — safety', () => {
  it('a redirect returns the professional-care copy and writes nothing', async () => {
    const { service, created, ai, prisma } = build({
      safety: {
        decision: 'redirect',
        category: 'crisis',
        source: 'precheck',
        userFacingNote: 'Please talk to someone who can help.',
      },
    });

    const result = await service.answer(
      USER,
      COMMITMENT,
      { answer: 'OTHER', text: 'a distressing sentence' },
      NOW,
    );

    expect(result.intervention.userMessage).toBe('Please talk to someone who can help.');
    expect(result.intervention.source).toBe('template');
    expect(result.obstacleId).toBeNull();
    expect(result.reflectionId).toBeNull();
    expect(created.reflections).toHaveLength(0);
    expect(prisma.obstacle.create).not.toHaveBeenCalled();
    expect(ai.invoke).not.toHaveBeenCalled();
  });

  it('does not run the safety layer when there is no free text', async () => {
    const { service, safety } = build();

    await service.answer(USER, COMMITMENT, { answer: 'TIRED' }, NOW);

    expect(safety.evaluate).not.toHaveBeenCalled();
  });
});

describe('FrictionService.answer — SOMETHING_URGENT', () => {
  it('suggests tomorrow in the same part of the day', async () => {
    const { service } = build();

    const result = await service.answer(USER, COMMITMENT, { answer: 'SOMETHING_URGENT' }, NOW);

    const slot = result.intervention.suggestedReschedule;
    expect(slot).toBeTruthy();
    // The commitment is at 09:00 UTC — a morning — so tomorrow's slot is too.
    expect(slot?.scheduledStart.startsWith('2026-09-09')).toBe(true);
    expect(new Date(slot!.scheduledStart).getUTCHours()).toBeLessThan(12);
    expect(result.intervention.recommendedAction).toBeNull();
  });

  it('steps past a colliding commitment', async () => {
    const { service } = build({
      busy: [
        {
          scheduledStart: new Date('2026-09-09T05:00:00.000Z'),
          scheduledEnd: new Date('2026-09-09T06:00:00.000Z'),
        },
      ],
    });

    const result = await service.answer(USER, COMMITMENT, { answer: 'SOMETHING_URGENT' }, NOW);

    expect(new Date(result.intervention.suggestedReschedule!.scheduledStart).getTime()).toBeGreaterThanOrEqual(
      new Date('2026-09-09T06:00:00.000Z').getTime(),
    );
  });
});

describe('FrictionService.answer — refusals', () => {
  it('refuses a non-WORK commitment', async () => {
    const { service } = build({ commitment: { domain: 'FAMILY' } });

    await expect(
      service.answer(USER, COMMITMENT, { answer: 'TIRED' }, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("answers 404 for another user's commitment", async () => {
    const { service } = build({ commitment: null });

    await expect(
      service.answer(USER, COMMITMENT, { answer: 'TIRED' }, NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
