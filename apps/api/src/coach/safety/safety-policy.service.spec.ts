import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';

import { AiGatewayService } from '../../ai/gateway/ai-gateway.service';
import { SAFETY_PROMPT_VERSION } from '../prompts/safety.prompt';
import {
  SAFETY_CONSERVATIVE_NOTE,
  SAFETY_REDIRECT_COPY,
} from './safety-copy';
import { SafetyPolicyService, precheck } from './safety-policy.service';
import type { SafetyDecisionKind, SafetyCategory } from './safety.types';

// =============================================================================
// SafetyPolicyService (issue #82, epic E06)
// =============================================================================
//
// The fixture is the spec. Adding a rule means adding cases, and the two
// assertions that matter most are negative ones: a `definite` case must NOT
// reach the gateway (it has to work with the provider down), and an ordinary
// coaching sentence must NOT reach it either (it would be a cost and a latency
// tax on every message in the product).
// =============================================================================

interface SafetyCase {
  text: string;
  expected: { decision: SafetyDecisionKind; category: SafetyCategory };
  matchedRule?: string;
  viaModel?: boolean;
  modelReply?: { decision: string; category: string; rationale: string };
}

const { cases } = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'safety-cases.json'), 'utf8'),
) as { cases: SafetyCase[] };

const USER = 'user-1';

describe('SafetyPolicyService (#82)', () => {
  let service: SafetyPolicyService;
  let invoke: jest.Mock;

  beforeEach(async () => {
    invoke = jest.fn();
    const module = await Test.createTestingModule({
      providers: [
        SafetyPolicyService,
        { provide: AiGatewayService, useValue: { invoke } },
      ],
    }).compile();

    service = module.get(SafetyPolicyService);
  });

  it('has enough cases to be worth calling a fixture', () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
  });

  describe.each(cases)('$text', (testCase) => {
    it(`decides ${testCase.expected.decision}/${testCase.expected.category}`, async () => {
      if (testCase.viaModel) {
        invoke.mockResolvedValue({
          ok: true,
          invocationId: 'inv-1',
          output: testCase.modelReply,
          usage: {},
          model: 'gpt-5.4',
          latencyMs: 1,
        });
      }

      const decision = await service.evaluate({
        userId: USER,
        text: testCase.text,
        surface: 'coach',
      });

      expect(decision.decision).toBe(testCase.expected.decision);
      expect(decision.category).toBe(testCase.expected.category);

      // The negative half: a deterministic case must cost nothing and must
      // work when there is no provider to call.
      expect(invoke).toHaveBeenCalledTimes(testCase.viaModel ? 1 : 0);

      if (testCase.matchedRule) {
        expect(decision.matchedRule).toBe(testCase.matchedRule);
      }
      if (!testCase.viaModel) {
        expect(decision.source).toBe('precheck');
      }
    });
  });

  it('always attaches professional-care copy to a redirect', async () => {
    for (const testCase of cases.filter(
      (c) => c.expected.decision === 'redirect',
    )) {
      if (testCase.viaModel) {
        invoke.mockResolvedValue({
          ok: true,
          invocationId: 'inv-1',
          output: testCase.modelReply,
          usage: {},
          model: 'gpt-5.4',
          latencyMs: 1,
        });
      }

      const decision = await service.evaluate({
        userId: USER,
        text: testCase.text,
        surface: 'coach',
      });

      expect(decision.userFacingNote).toBe(
        SAFETY_REDIRECT_COPY[
          decision.category as Exclude<SafetyCategory, 'none'>
        ],
      );
    }
  });

  describe('when the safety persona cannot be reached', () => {
    beforeEach(() => {
      invoke.mockResolvedValue({
        ok: false,
        invocationId: 'inv-1',
        error: { code: 'no_user_key', message: 'no key' },
        model: null,
        latencyMs: 1,
      });
    });

    it('degrades an ambiguous message to conservative, never to allow', async () => {
      const decision = await service.evaluate({
        userId: USER,
        text: 'my knee hurts a bit after squats',
        surface: 'coach',
      });

      expect(decision.decision).toBe('conservative');
      expect(decision.category).toBe('injury');
      expect(decision.source).toBe('model_unavailable');
      expect(decision.userFacingNote).toBe(SAFETY_CONSERVATIVE_NOTE);
    });

    it('does not throw — ever', async () => {
      // A safety layer that can 500 the product is one somebody eventually
      // removes. `evaluate` has no failure mode that reaches its caller.
      await expect(
        service.evaluate({ userId: USER, text: 'pain', surface: 'planner' }),
      ).resolves.toBeDefined();
    });

    it('still decides deterministic cases with no provider at all', async () => {
      const decision = await service.evaluate({
        userId: USER,
        text: 'I have sharp chest pain when I run',
        surface: 'coach',
      });

      expect(decision).toEqual({
        decision: 'redirect',
        category: 'injury',
        userFacingNote: SAFETY_REDIRECT_COPY.injury,
        source: 'precheck',
        matchedRule: 'injury.chest_pain',
      });
      expect(invoke).not.toHaveBeenCalled();
    });
  });

  describe('the model call', () => {
    beforeEach(() => {
      invoke.mockResolvedValue({
        ok: true,
        invocationId: 'inv-1',
        output: {
          decision: 'conservative',
          category: 'injury',
          rationale: 'minor',
        },
        usage: {},
        model: 'gpt-5.4',
        latencyMs: 1,
      });
    });

    it('uses the safety persona and its versioned prompt', async () => {
      await service.evaluate({
        userId: USER,
        text: 'my knee hurts a bit',
        surface: 'workout',
      });

      const request = invoke.mock.calls[0][0];
      expect(request.persona).toBe('safety');
      expect(request.userId).toBe(USER);
      expect(request.promptVersion).toBe(SAFETY_PROMPT_VERSION);
      expect(request.maxOutputTokens).toBe(200);
      expect(JSON.parse(request.input).matchedRules).toEqual(['injury.hurts']);
    });

    it('normalises an incoherent answer rather than propagating it', async () => {
      // "redirect" with category "none" would index the copy table with
      // undefined and show the user an empty message.
      invoke.mockResolvedValue({
        ok: true,
        invocationId: 'inv-1',
        output: { decision: 'redirect', category: 'none', rationale: 'x' },
        usage: {},
        model: 'gpt-5.4',
        latencyMs: 1,
      });

      const decision = await service.evaluate({
        userId: USER,
        text: 'my knee hurts a bit',
        surface: 'coach',
      });

      expect(decision.category).toBe('injury');
      expect(decision.userFacingNote).toBe(SAFETY_REDIRECT_COPY.injury);
    });

    it('drops a category the model attached to an allow', async () => {
      invoke.mockResolvedValue({
        ok: true,
        invocationId: 'inv-1',
        output: { decision: 'allow', category: 'injury', rationale: 'x' },
        usage: {},
        model: 'gpt-5.4',
        latencyMs: 1,
      });

      const decision = await service.evaluate({
        userId: USER,
        text: 'my knee hurts a bit',
        surface: 'coach',
      });

      expect(decision).toMatchObject({ decision: 'allow', category: 'none' });
      expect(decision.userFacingNote).toBeUndefined();
    });
  });

  describe('precheck', () => {
    it('is pure: same input, same output, no clock, no IO', () => {
      const first = precheck('I have sharp chest pain when I run');
      const second = precheck('I have sharp chest pain when I run');

      expect(first).toEqual(second);
      expect(first.definite?.id).toBe('injury.chest_pain');
    });

    it('tolerates an empty or missing message', () => {
      expect(precheck('')).toEqual({ definite: null, ambiguous: [] });
      expect(precheck(undefined as unknown as string)).toEqual({
        definite: null,
        ambiguous: [],
      });
    });
  });

  it('never logs the evaluated text', async () => {
    const logged: string[] = [];
    jest
      .spyOn(service['logger'], 'log')
      .mockImplementation((message: unknown) => {
        logged.push(String(message));
      });

    await service.evaluate({
      userId: USER,
      text: 'I have sharp chest pain when I run',
      surface: 'coach',
    });

    expect(logged).toHaveLength(1);
    expect(logged[0]).not.toContain('chest pain');
    expect(logged[0]).toContain('rule=injury.chest_pain');
    expect(logged[0]).toContain('surface=coach');
  });
});
