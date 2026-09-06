import { Test, TestingModule } from '@nestjs/testing';

import { AiGatewayService } from '../../ai/gateway/ai-gateway.service';
import { OFFER_NOTE } from './comeback-copy';
import { RestartWordingService } from './restart-wording.service';
import type { RestartPlan } from './restart-picker';

// =============================================================================
// The coach's wording, and the gate on it (issue #112, epic E11)
// =============================================================================
//
// Asking a model not to say "overdue" is a request. Checking its answer is a
// guarantee — and this is the one screen where the wrong word does the exact
// damage the feature exists to prevent.
// =============================================================================

const restart: RestartPlan = {
  domain: 'HEALTH',
  routineId: 'r1',
  outcomeId: 'o1',
  planVersionId: 'v1',
  title: '12-minute bodyweight circuit',
  minutes: 12,
  preferredTime: '07:00',
  reason: 'Health matters most to you right now.',
  alternatives: [],
};

describe('RestartWordingService (#112)', () => {
  let service: RestartWordingService;
  let invoke: jest.Mock;

  beforeEach(async () => {
    invoke = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestartWordingService,
        { provide: AiGatewayService, useValue: { invoke } },
      ],
    }).compile();

    service = module.get(RestartWordingService);
  });

  it('uses the model’s wording when it is kind and well-formed', async () => {
    invoke.mockResolvedValue({
      ok: true,
      output: { title: 'Twelve gentle minutes', note: 'Start where you are.' },
    });

    expect(await service.compose('u1', restart, 'BALANCED', 4)).toEqual({
      title: 'Twelve gentle minutes',
      note: 'Start where you are.',
      source: 'ai',
    });
  });

  it('falls back to the deterministic copy when the provider is down', async () => {
    invoke.mockResolvedValue({ ok: false, error: { code: 'ai_unavailable' } });

    expect(await service.compose('u1', restart, 'BALANCED', 4)).toEqual({
      title: restart.title,
      note: OFFER_NOTE,
      source: 'template',
    });
  });

  it.each([
    ['Clear your overdue workouts', 'Start where you are.'],
    ['Twelve minutes', 'Time to catch up on the week you lost'],
    ['Rebuild your streak', 'Start where you are.'],
  ])('throws away wording that shames the user (%s)', async (title, note) => {
    invoke.mockResolvedValue({ ok: true, output: { title, note } });

    const result = await service.compose('u1', restart, 'BALANCED', 4);

    expect(result.source).toBe('template');
    expect(result.title).toBe(restart.title);
  });

  it('falls back on empty output rather than shipping a blank card', async () => {
    invoke.mockResolvedValue({ ok: true, output: { title: '   ', note: 'x' } });

    expect((await service.compose('u1', restart, 'BALANCED', 4)).source).toBe('template');
  });

  it('hands the model the decision, never the decision to make', async () => {
    invoke.mockResolvedValue({ ok: false, error: { code: 'ai_unavailable' } });

    await service.compose('u1', restart, 'DIRECT', 4);

    const call = invoke.mock.calls[0][0];
    expect(call.persona).toBe('coach');
    expect(call.promptVersion).toBe('comeback-restart.v1');
    expect(JSON.parse(call.input)).toMatchObject({
      domain: 'HEALTH',
      title: '12-minute bodyweight circuit',
      minutes: 12,
      idleDays: 4,
    });
  });
});
