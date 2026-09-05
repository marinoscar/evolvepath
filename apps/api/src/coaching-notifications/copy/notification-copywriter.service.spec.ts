import { Test } from '@nestjs/testing';

import { AiGatewayService } from '../../ai/gateway/ai-gateway.service';
import { defaultCopyFor } from './copy-templates';
import {
  buildCopyInstructions,
  NotificationCopywriterService,
} from './notification-copywriter.service';

const N = '22222222-2222-4222-8222-222222222222';
const C = '11111111-1111-4111-8111-111111111111';

const PAYLOAD = {
  sentInteractionId: N,
  commitmentId: C,
  domain: 'HEALTH',
  commitmentTitle: 'Upper A',
  scheduledStart: '2026-09-08T15:00:00.000Z',
  minutesUntil: 20,
  startMinutes: 38,
};

const CONTEXT = {
  userId: 'user-1',
  coachingStyle: 'BALANCED',
  domainMode: null,
  priorTitles: [],
  journeyState: null,
};

const okResult = (output: Record<string, string>) => ({
  ok: true as const,
  invocationId: 'inv-1',
  output,
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  model: 'gpt-test',
  latencyMs: 10,
});

describe('NotificationCopywriterService (#59)', () => {
  let service: NotificationCopywriterService;
  let gateway: { invoke: jest.Mock };

  beforeEach(async () => {
    gateway = { invoke: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        NotificationCopywriterService,
        { provide: AiGatewayService, useValue: gateway },
      ],
    }).compile();
    service = module.get(NotificationCopywriterService);
  });

  const write = () =>
    service.write('coach.commitment_upcoming', 'N1', PAYLOAD, CONTEXT);

  it('uses clean AI copy', async () => {
    gateway.invoke.mockResolvedValue(
      okResult({ title: 'Upper A in twenty', body: 'Shoes by the door.', actionLabel: 'Start' }),
    );

    await expect(write()).resolves.toEqual({
      copy: { title: 'Upper A in twenty', body: 'Shoes by the door.', actionLabel: 'Start' },
      source: 'ai',
    });
  });

  it('falls back to the template when the gateway fails', async () => {
    gateway.invoke.mockResolvedValue({
      ok: false,
      invocationId: 'inv-1',
      error: { code: 'provider_error', message: 'down' },
      model: null,
      latencyMs: 5,
    });

    const result = await write();

    expect(result.source).toBe('template');
    expect(result.copy).toEqual(defaultCopyFor('coach.commitment_upcoming', PAYLOAD));
  });

  // The commonest outcome by far, and it is not an error: a user who has not
  // brought a key still gets every notification, with the template copy.
  it('treats a missing user key exactly like any other failure', async () => {
    gateway.invoke.mockResolvedValue({
      ok: false,
      invocationId: 'inv-1',
      error: { code: 'no_user_key', message: 'no key' },
      model: null,
      latencyMs: 1,
    });

    await expect(write()).resolves.toMatchObject({ source: 'template' });
  });

  // PRD §129. Prompting a model not to shame someone is a request; checking is
  // the guarantee.
  it.each([
    ['a blame phrase', "Don't let yourself down"],
    ['manufactured urgency', 'Last chance to train today'],
    ['emotional leverage', 'What would your daughters think'],
    ['shouting', 'Upper A now!!'],
  ])('rejects %s and uses the template', async (_label, title) => {
    gateway.invoke.mockResolvedValue(
      okResult({ title, body: 'Time to go.', actionLabel: 'Start' }),
    );

    const result = await write();

    expect(result.source).toBe('template');
    expect(result.copy.title).not.toBe(title);
  });

  it('screens the body and the action label too, not just the title', async () => {
    gateway.invoke.mockResolvedValue(
      okResult({ title: 'Upper A', body: 'You promised you would.', actionLabel: 'Start' }),
    );

    await expect(write()).resolves.toMatchObject({ source: 'template' });
  });

  // The distinction the pattern list exists for: PRD §60's own example copy
  // uses "failed" about a schedule, and the product wants to be able to say it.
  it('allows factual language about a plan that is not working', async () => {
    gateway.invoke.mockResolvedValue(
      okResult({
        title: 'Two evening workouts failed',
        body: 'I think the schedule needs changing.',
        actionLabel: 'Review',
      }),
    );

    await expect(write()).resolves.toMatchObject({ source: 'ai' });
  });

  describe('what the model is allowed to see', () => {
    beforeEach(() => {
      gateway.invoke.mockResolvedValue(
        okResult({ title: 'T', body: 'B', actionLabel: 'A' }),
      );
    });

    it('sends the persona, the version and the caller’s own id', async () => {
      await write();

      const request = gateway.invoke.mock.calls[0][0];
      expect(request.persona).toBe('notification_copywriter');
      expect(request.promptVersion).toBe('notification-copy.v1');
      expect(request.userId).toBe('user-1');
    });

    // PRD §14.7: the copywriter "does not decide whether notification limits may
    // be violated". It cannot argue about a limit it has never been shown.
    it('sends nothing about caps, quiet hours or the decision', async () => {
      await write();

      const input = gateway.invoke.mock.calls[0][0].input as string;
      expect(input).not.toContain('dailyCap');
      expect(input).not.toContain('quietHours');
      expect(input).not.toContain('sentToday');
      expect(input).not.toContain('suppress');
    });

    it('sends the default copy as the thing to improve on', async () => {
      await write();

      const input = gateway.invoke.mock.calls[0][0].input as string;
      expect(input).toContain('defaultCopy');
      expect(input).toContain('Upper A starts in 20 minutes');
    });

    it('sends the prior titles, so it can avoid repeating itself', async () => {
      await service.write('coach.commitment_upcoming', 'N1', PAYLOAD, {
        ...CONTEXT,
        priorTitles: ['Upper A starts in 20 minutes'],
      });

      const input = gateway.invoke.mock.calls[0][0].input as string;
      expect(input).toContain('priorTitles');
    });

    it('caps the output tokens — this is two lines, not an essay', async () => {
      await write();

      expect(gateway.invoke.mock.calls[0][0].maxOutputTokens).toBe(200);
    });
  });
});

describe('buildCopyInstructions (#59)', () => {
  it.each(['GENTLE', 'BALANCED', 'DIRECT'])('has a voice for %s', (style) => {
    expect(buildCopyInstructions(style).length).toBeGreaterThan(100);
  });

  it('falls back to the balanced voice for an unknown style', () => {
    expect(buildCopyInstructions('SHOUTY')).toBe(buildCopyInstructions('BALANCED'));
  });

  it('states the boundary the persona must not cross', () => {
    const instructions = buildCopyInstructions('BALANCED');

    expect(instructions).toContain('already been made');
    expect(instructions).toContain('Never imply disappointment');
    expect(instructions).toContain('Use only facts present in the input');
  });
});
