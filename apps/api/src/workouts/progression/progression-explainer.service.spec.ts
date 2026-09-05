import { Test } from '@nestjs/testing';

import { AiGatewayService } from '../../ai/gateway/ai-gateway.service';
import type { ProgressionSuggestion } from './double-progression';
import {
  numbersAreSafe,
  ProgressionExplainerService,
  templateExplanation,
} from './progression-explainer.service';

// =============================================================================
// The guard is the reason this file exists (issue #85, epic E09)
//
// A model asked to explain "go to 22.5 kg" will occasionally write "go to 25
// kg" — a fluent, confident sentence a reader cannot tell from a true one, and
// one that puts weight on a bar. The prompt asks; this checks.
// =============================================================================

const INCREASE: ProgressionSuggestion = {
  action: 'increase',
  currentWeightKg: 20,
  suggestedWeightKg: 22.5,
  deltaKg: 2.5,
  reason: 'top_of_range_twice',
  basis: { sessions: 2, lastReps: [12, 12, 12], lastRpe: [7, 7, 7] },
};

const PAIN: ProgressionSuggestion = {
  ...INCREASE,
  action: 'hold',
  reason: 'discomfort',
  suggestedWeightKg: 20,
  deltaKg: null,
};

describe('numbersAreSafe', () => {
  it('accepts a sentence that only quotes the rule', () => {
    expect(numbersAreSafe('A small increase to 22.5 kg.', INCREASE)).toBe(true);
  });

  it('accepts the reps and the current weight it was decided from', () => {
    expect(numbersAreSafe('12 reps at 20 kg twice — go to 22.5 kg.', INCREASE)).toBe(true);
  });

  it('rejects a load the rule never suggested', () => {
    expect(numbersAreSafe('Go to 25 kg today.', INCREASE)).toBe(false);
  });

  it('rejects an invented rep target', () => {
    expect(numbersAreSafe('Aim for 15 reps at 22.5 kg.', INCREASE)).toBe(false);
  });

  it('treats 22.50 and 22.5 as the same weight', () => {
    expect(numbersAreSafe('Go to 22.50 kg.', INCREASE)).toBe(true);
  });

  it('accepts a sentence with no numbers at all', () => {
    expect(numbersAreSafe('Add a little weight today.', INCREASE)).toBe(true);
  });
});

describe('templateExplanation', () => {
  it('names the suggested weight for an increase', () => {
    expect(templateExplanation('Dumbbell Bench Press', INCREASE)).toContain('22.5 kg');
  });

  it('tells a bodyweight movement to get harder rather than heavier', () => {
    const sentence = templateExplanation('Push-Up', {
      ...INCREASE,
      suggestedWeightKg: null,
      deltaKg: null,
    });

    expect(sentence).toContain('Push-Up');
    expect(sentence).not.toContain('kg');
  });

  it('says only "stop" after sharp pain, with no programming advice', () => {
    const sentence = templateExplanation('Barbell Bench Press', PAIN);

    expect(sentence).toBe('Stop this exercise.');
    expect(sentence).not.toMatch(/kg|rep|lighter|weight/i);
  });
});

describe('ProgressionExplainerService', () => {
  const userId = 'user-1';
  const key = { sessionId: 'session-1', exerciseId: 'exercise-1' };
  let ai: { invoke: jest.Mock };
  let service: ProgressionExplainerService;

  beforeEach(async () => {
    ai = { invoke: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        ProgressionExplainerService,
        { provide: AiGatewayService, useValue: ai },
      ],
    }).compile();

    service = module.get(ProgressionExplainerService);
  });

  function aiSays(sentence: string) {
    ai.invoke.mockResolvedValue({
      ok: true,
      invocationId: 'inv-1',
      output: { sentence },
      usage: {},
      model: 'gpt-test',
      latencyMs: 1,
    });
  }

  it('uses the model when the sentence only quotes the rule', async () => {
    aiSays('You hit 12 on every set twice — 22.5 kg today.');

    await expect(service.explain(userId, key, 'Dumbbell Bench Press', INCREASE)).resolves.toEqual({
      sentence: 'You hit 12 on every set twice — 22.5 kg today.',
      source: 'ai',
    });
  });

  it('discards a sentence that names a different load', async () => {
    aiSays('Big jump today: go to 30 kg.');

    const result = await service.explain(userId, key, 'Dumbbell Bench Press', INCREASE);

    expect(result.source).toBe('template');
    expect(result.sentence).toContain('22.5 kg');
  });

  it('falls back to the template when the provider is unavailable', async () => {
    ai.invoke.mockResolvedValue({
      ok: false,
      invocationId: 'inv-2',
      error: { code: 'timeout', message: 'no answer' },
      model: null,
      latencyMs: 1,
    });

    await expect(
      service.explain(userId, key, 'Dumbbell Bench Press', INCREASE),
    ).resolves.toMatchObject({ source: 'template' });
  });

  it('never asks a model about sharp pain', async () => {
    const result = await service.explain(userId, key, 'Barbell Bench Press', PAIN);

    expect(ai.invoke).not.toHaveBeenCalled();
    expect(result).toEqual({ sentence: 'Stop this exercise.', source: 'template' });
  });

  it('spends the key once per movement per session', async () => {
    aiSays('22.5 kg today.');

    await service.explain(userId, key, 'Dumbbell Bench Press', INCREASE);
    await service.explain(userId, key, 'Dumbbell Bench Press', INCREASE);

    expect(ai.invoke).toHaveBeenCalledTimes(1);
  });

  it('calls the gateway with the persona and prompt version it must', async () => {
    aiSays('22.5 kg today.');

    await service.explain(userId, key, 'Dumbbell Bench Press', INCREASE);

    expect(ai.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        persona: 'coach',
        promptVersion: 'progression-explain.v1',
        schemaName: 'progression_explanation',
        userId,
      }),
    );
  });
});
