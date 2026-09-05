import { Test, TestingModule } from '@nestjs/testing';

import { AiGatewayService } from '../../ai/gateway/ai-gateway.service';
import { UserProfileService } from '../../user-profile/user-profile.service';
import { TodayService } from '../today.service';
import { todayInsightSchema } from '../today.schema';
import { EMPTY_DAY_INSIGHT, insightTemplateFor } from './insight-templates';
import {
  buildInsightInstructions,
  TODAY_INSIGHT_PROMPT_VERSION,
  TodayInsightService,
} from './today-insight.service';

const NOW = new Date('2026-03-02T09:00:00.000Z');

const todayResponse = (over: Record<string, unknown> = {}) => ({
  greeting: 'morning',
  stateLine: '1 commitment today.',
  dateLocal: '2026-03-02',
  timeZone: 'UTC',
  checkIn: null,
  nextBestAction: {
    commitmentId: 'c1',
    title: 'Draft the storyline',
    domain: 'WORK',
    durationMinutes: 25,
    version: 'full',
    rationale: 'This is the most useful 25 minutes you have right now.',
    fallback: { title: '5-minute start', durationMinutes: 5 },
    interventionMode: 'ACT',
    confidence: 0.9,
  },
  domains: [
    { domain: 'WORK', mode: 'GROW', commitments: [] },
    { domain: 'FAMILY', mode: 'GROW', commitments: [] },
    { domain: 'HEALTH', mode: 'GROW', commitments: [] },
  ],
  momentum: null,
  coachInsight: null,
  ...over,
});

describe('TodayInsightService (#38)', () => {
  let service: TodayInsightService;
  let ai: { invoke: jest.Mock };
  let today: { getToday: jest.Mock };
  let userProfile: { find: jest.Mock };

  beforeEach(async () => {
    ai = { invoke: jest.fn() };
    today = { getToday: jest.fn().mockResolvedValue(todayResponse()) };
    userProfile = { find: jest.fn().mockResolvedValue({ coachingStyle: 'BALANCED' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TodayInsightService,
        { provide: AiGatewayService, useValue: ai },
        { provide: TodayService, useValue: today },
        { provide: UserProfileService, useValue: userProfile },
      ],
    }).compile();

    service = module.get(TodayInsightService);
  });

  const aiSuccess = (text: string) =>
    ai.invoke.mockResolvedValue({
      ok: true,
      invocationId: 'inv-1',
      output: { text },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      model: 'gpt-test',
      latencyMs: 10,
    });

  it('returns the coach sentence when the gateway answers', async () => {
    aiSuccess('Two focused blocks and you have made the week.');

    const insight = await service.getInsight('u1', NOW);

    expect(insight).toMatchObject({
      text: 'Two focused blocks and you have made the week.',
      source: 'ai',
    });
    expect(todayInsightSchema.safeParse(insight).success).toBe(true);
  });

  // PRD §120: every failure is the same failure to this screen.
  it.each([
    'no_user_key',
    'ai_disabled',
    'provider_error',
    'timeout',
    'schema_violation',
    'rate_limited',
  ])('falls back to the template for error code %s', async (code) => {
    ai.invoke.mockResolvedValue({
      ok: false,
      error: { code, message: 'nope' },
      invocationId: 'inv-1',
      model: null,
      latencyMs: 5,
    });

    const insight = await service.getInsight('u1', NOW);

    expect(insight.source).toBe('template');
    expect(insight.text).toBe(insightTemplateFor('ACT'));
  });

  it('keys the template to the intervention mode the engine resolved', async () => {
    today.getToday.mockResolvedValue(
      todayResponse({
        nextBestAction: {
          ...todayResponse().nextBestAction,
          interventionMode: 'RECOVER',
        },
      }),
    );
    ai.invoke.mockResolvedValue({
      ok: false,
      error: { code: 'provider_error', message: 'down' },
      invocationId: 'i',
      model: null,
      latencyMs: 1,
    });

    expect((await service.getInsight('u1', NOW)).text).toBe(insightTemplateFor('RECOVER'));
  });

  it('has something honest to say on a day with nothing scheduled', async () => {
    today.getToday.mockResolvedValue(todayResponse({ nextBestAction: null }));
    ai.invoke.mockResolvedValue({
      ok: false,
      error: { code: 'provider_error', message: 'down' },
      invocationId: 'i',
      model: null,
      latencyMs: 1,
    });

    expect((await service.getInsight('u1', NOW)).text).toBe(EMPTY_DAY_INSIGHT);
  });

  it('treats an empty model answer as no answer', async () => {
    aiSuccess('   ');

    expect((await service.getInsight('u1', NOW)).source).toBe('template');
  });

  describe('cache', () => {
    it('does not call the gateway a second time on the same local day', async () => {
      aiSuccess('One sentence.');

      await service.getInsight('u1', NOW);
      await service.getInsight('u1', NOW);

      expect(ai.invoke).toHaveBeenCalledTimes(1);
    });

    // A user who just said "low energy" and still reads yesterday's chirpy
    // insight would reasonably conclude nothing listened.
    it('regenerates after invalidate', async () => {
      aiSuccess('One sentence.');

      await service.getInsight('u1', NOW);
      service.invalidate('u1');
      await service.getInsight('u1', NOW);

      expect(ai.invoke).toHaveBeenCalledTimes(2);
    });

    // The stored date not matching today's IS the eviction — it lands at the
    // user's local midnight rather than the server's.
    it('regenerates when the local date rolls over', async () => {
      aiSuccess('One sentence.');
      await service.getInsight('u1', NOW);

      today.getToday.mockResolvedValue(todayResponse({ dateLocal: '2026-03-03' }));
      await service.getInsight('u1', new Date('2026-03-03T09:00:00.000Z'));

      expect(ai.invoke).toHaveBeenCalledTimes(2);
    });

    it('caches per user', async () => {
      aiSuccess('One sentence.');

      await service.getInsight('u1', NOW);
      await service.getInsight('u2', NOW);

      expect(ai.invoke).toHaveBeenCalledTimes(2);
    });
  });

  describe('the prompt', () => {
    it('uses the coach persona and the versioned prompt', async () => {
      aiSuccess('One sentence.');

      await service.getInsight('u1', NOW);

      expect(ai.invoke).toHaveBeenCalledWith(
        expect.objectContaining({
          persona: 'coach',
          userId: 'u1',
          promptVersion: TODAY_INSIGHT_PROMPT_VERSION,
          schemaName: 'today_insight',
        }),
      );
    });

    // The model gets what the deterministic engine decided; it does not get to
    // re-decide it (PRD §13).
    it('gives the model the recommendation, not the raw candidate list', async () => {
      aiSuccess('One sentence.');

      await service.getInsight('u1', NOW);

      const input = JSON.parse(ai.invoke.mock.calls[0][0].input);
      expect(input.nextBestAction).toEqual({
        title: 'Draft the storyline',
        domain: 'WORK',
        durationMinutes: 25,
        interventionMode: 'ACT',
      });
      expect(input.domains).toHaveLength(3);
    });

    it('varies with the stored coaching style', () => {
      expect(buildInsightInstructions('GENTLE')).not.toBe(buildInsightInstructions('DIRECT'));
      expect(buildInsightInstructions('anything else')).toBe(
        buildInsightInstructions('BALANCED'),
      );
    });

    it('always caps the answer at one sentence', () => {
      for (const style of ['GENTLE', 'BALANCED', 'DIRECT']) {
        expect(buildInsightInstructions(style)).toContain('One sentence.');
      }
    });
  });
});
