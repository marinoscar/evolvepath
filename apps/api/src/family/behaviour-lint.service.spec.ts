import { Test } from '@nestjs/testing';

import { AiGatewayService } from '../ai/gateway/ai-gateway.service';
import { TestThrottle } from '../ai/gateway/test-throttle';
import { BehaviourLintService } from './behaviour-lint.service';

const USER = 'user-1';

function gatewayReturning(output: unknown) {
  return { invoke: jest.fn().mockResolvedValue({ ok: true, invocationId: 'inv', output, usage: {} }) };
}

function gatewayFailing(code = 'no_user_key') {
  return { invoke: jest.fn().mockResolvedValue({ ok: false, invocationId: 'inv', error: { code, message: code } }) };
}

async function build(gateway: { invoke: jest.Mock }, throttle = new TestThrottle()) {
  const module = await Test.createTestingModule({
    providers: [
      BehaviourLintService,
      { provide: AiGatewayService, useValue: gateway },
      { provide: TestThrottle, useValue: throttle },
    ],
  }).compile();

  return module.get(BehaviourLintService);
}

describe('BehaviourLintService', () => {
  it('never calls the gateway for a title that passes', async () => {
    const gateway = gatewayReturning({ suggestion: 'unused' });
    const service = await build(gateway);

    expect(await service.checkWithSuggestion(USER, 'Put phone away during dinner')).toEqual({
      ok: true,
      code: null,
      match: null,
      suggestion: null,
      source: 'none',
    });
    expect(gateway.invoke).not.toHaveBeenCalled();
  });

  it('returns the verdict with a rewrite when the coach answers', async () => {
    const gateway = gatewayReturning({ suggestion: 'Read with Mia for 15 minutes' });
    const service = await build(gateway);

    expect(await service.checkWithSuggestion(USER, 'Make Mia happier')).toEqual({
      ok: false,
      code: 'TARGETS_OTHER_PERSON',
      match: 'Make Mia happier',
      suggestion: 'Read with Mia for 15 minutes',
      source: 'ai',
    });
  });

  // PRD §120: the deterministic path keeps working when the provider is down.
  it('still returns the verdict, with no suggestion, when the gateway fails', async () => {
    const gateway = gatewayFailing();
    const service = await build(gateway);

    expect(await service.checkWithSuggestion(USER, 'Make Mia happier')).toMatchObject({
      ok: false,
      code: 'TARGETS_OTHER_PERSON',
      suggestion: null,
      source: 'none',
    });
  });

  it('never rejects, whatever the gateway reports', async () => {
    for (const code of ['no_user_key', 'provider_error', 'schema_invalid', 'timeout']) {
      const service = await build(gatewayFailing(code));

      await expect(service.checkWithSuggestion(USER, 'Make Mia happier')).resolves.toMatchObject({
        source: 'none',
      });
    }
  });

  // The realistic failure: asked to rewrite "Make Mia happier", a model answers
  // "Help Mia feel happier" — the same commitment in politer words.
  it('drops a suggestion that fails the lint itself', async () => {
    const gateway = gatewayReturning({ suggestion: 'Make Mia calmer at dinner' });
    const service = await build(gateway);

    expect(await service.checkWithSuggestion(USER, 'Make Mia happier')).toMatchObject({
      suggestion: null,
      source: 'none',
    });
  });

  it('trims the suggestion', async () => {
    const gateway = gatewayReturning({ suggestion: '  Read with Mia for 15 minutes  ' });
    const service = await build(gateway);

    expect(await service.checkWithSuggestion(USER, 'Make Mia happier')).toMatchObject({
      suggestion: 'Read with Mia for 15 minutes',
    });
  });

  it('sends the coach the title and the offending substring, and versions the prompt', async () => {
    const gateway = gatewayReturning({ suggestion: 'Read with Mia for 15 minutes' });
    const service = await build(gateway);

    await service.checkWithSuggestion(USER, 'Make Mia happier');

    expect(gateway.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        persona: 'coach',
        userId: USER,
        promptVersion: 'family-behaviour-rewrite.v1',
        schemaName: 'FamilyBehaviourRewrite',
        input: JSON.stringify({ title: 'Make Mia happier', match: 'Make Mia happier' }),
      }),
    );
  });

  it('stops calling the gateway once the per-user window is spent', async () => {
    const gateway = gatewayReturning({ suggestion: 'Read with Mia for 15 minutes' });
    const service = await build(gateway);

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await service.checkWithSuggestion(USER, 'Make Mia happier');
    }

    // Ten per minute; the verdict keeps coming back regardless.
    expect(gateway.invoke).toHaveBeenCalledTimes(10);
    await expect(service.checkWithSuggestion(USER, 'Make Mia happier')).resolves.toMatchObject({
      ok: false,
      source: 'none',
    });
  });

  it('never logs the title', async () => {
    const gateway = gatewayReturning({ suggestion: 'Read with Mia for 15 minutes' });
    const service = await build(gateway);
    const lines: string[] = [];
    jest
      .spyOn((service as unknown as { logger: { log: (m: string) => void } }).logger, 'log')
      .mockImplementation((message: string) => void lines.push(message));

    await service.checkWithSuggestion(USER, 'Make Mia happier');

    expect(lines.join('\n')).not.toContain('Mia');
    expect(lines.join('\n')).toContain('family.lint');
  });
});
