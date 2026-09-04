import request from 'supertest';
import { z } from 'zod';
import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

import {
  TestContext,
  createTestApp,
  closeTestApp,
} from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { CredentialsService } from '../../src/credentials/credentials.service';
import { OpenAiProvider } from '../../src/ai/providers/openai/openai.provider';
import { AiGatewayService } from '../../src/ai/gateway/ai-gateway.service';
import {
  AiKeyRequiredException,
  assertAiKeyAvailable,
} from '../../src/ai/gateway/ai-errors';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

/**
 * A controller that does what a real E04+ route will do: call the gateway, get
 * `no_user_key` back, and let `assertAiKeyAvailable` turn it into the 412 the
 * web app redirects on.
 */
@Controller('probe')
class AiKeyRequiredProbeController {
  @Get()
  hit() {
    assertAiKeyAvailable({ ok: false, error: { code: 'no_user_key' } });
    return { unreachable: true };
  }
}

@Module({
  controllers: [AiKeyRequiredProbeController],
  // The REAL filter, registered exactly as `AppModule` registers it. Rendering
  // through anything else would prove nothing: the whole point is that the
  // filter honours the verbatim-body brand instead of rewriting `code`.
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
class AiKeyRequiredProbeModule {}

// =============================================================================
// AI Gateway Integration (issue #26, epic #20)
// =============================================================================
//
// Two things a unit spec cannot prove:
//
//   1. `AiGatewayService` is REACHABLE from the real `AppModule` graph with all
//      of its dependencies satisfied — the settings service, the user-key
//      service, the provider registry, the attachment resolver (which needs both
//      `ObjectsService` and the `STORAGE_PROVIDER` token) and the logger.
//      A missing module import is invisible to every unit test and fatal at boot.
//
//   2. `AiKeyRequiredException` SERIALISES as `{ statusCode: 412, code:
//      'AI_KEY_REQUIRED' }`. That depends on `HttpExceptionFilter` honouring the
//      verbatim-body brand, which is a different file, and the filter's default
//      would rewrite `code` to 'ERROR' — destroying the one discriminator the
//      web app's redirect (#29) keys off. It is asserted through a real route.
// =============================================================================

const USER_ID = '22222222-2222-4222-8222-222222222222';

const mockCredentials = {
  describe: jest.fn().mockResolvedValue(null),
  setSecret: jest.fn().mockResolvedValue(undefined),
  deleteSecret: jest.fn().mockResolvedValue(undefined),
  getSecret: jest.fn().mockResolvedValue(null),
};

const mockProvider = {
  kind: 'openai' as const,
  listModels: jest.fn().mockResolvedValue([]),
  generate: jest.fn(),
};

describe('AI Gateway Integration', () => {
  let context: TestContext;
  let gateway: AiGatewayService;

  beforeAll(async () => {
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [
        { provide: CredentialsService, useValue: mockCredentials },
        { provide: OpenAiProvider, useValue: mockProvider },
      ],
    });

    gateway = context.module.get(AiGatewayService);
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();

    mockCredentials.getSecret.mockReset().mockResolvedValue('sk-user-integration');
    mockProvider.generate.mockReset().mockResolvedValue({
      outputText: '{"ok":true}',
      refusal: null,
      usage: {
        inputTokens: 42,
        outputTokens: 7,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
      providerRequestId: 'req_1',
      responseModel: 'gpt-5.4',
      incompleteReason: null,
    });

    context.prismaMock.aiInvocation.create.mockResolvedValue({} as any);
    context.prismaMock.systemSettings.findUnique.mockResolvedValue({
      value: {
        provider: 'openai',
        enabled: true,
        defaultModel: 'gpt-5.4',
        personaModels: {},
      },
    } as any);
  });

  it('resolves from the real module graph and completes a call', async () => {
    const result = await gateway.invoke({
      persona: 'coach',
      userId: USER_ID,
      promptVersion: 'coach.v1',
      instructions: 'Reply with the JSON {"ok":true}.',
      input: 'ping',
      schema: z.object({ ok: z.boolean() }),
      schemaName: 'probe',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.output).toEqual({ ok: true });

    const row = context.prismaMock.aiInvocation.create.mock.calls[0][0].data;
    expect(row.keyScope).toBe('user');
    expect(row.operation).toBe('invoke');
    expect(row.userId).toBe(USER_ID);
    expect(row.promptVersion).toBe('coach.v1');
  });

  it('reports no_user_key without throwing when the caller has no key', async () => {
    mockCredentials.getSecret.mockResolvedValue(null);

    const result = await gateway.invoke({
      persona: 'coach',
      userId: USER_ID,
      promptVersion: 'coach.v1',
      instructions: 'Be brief.',
      input: 'ping',
      schema: z.object({ ok: z.boolean() }),
      schemaName: 'probe',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('no_user_key');
  });

  it('renders AiKeyRequiredException verbatim as 412 AI_KEY_REQUIRED', async () => {
    // A minimal app rather than a raw Fastify route on the main one: a route
    // registered straight on the Fastify instance never reaches Nest's
    // exception filter, so it would prove nothing about the rendering.
    const probeModule = await Test.createTestingModule({
      imports: [AiKeyRequiredProbeModule],
    }).compile();

    const probeApp =
      probeModule.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
    await probeApp.init();
    await probeApp.getHttpAdapter().getInstance().ready();

    const response = await request(probeApp.getHttpServer())
      .get('/probe')
      .expect(412);

    await probeApp.close();

    // The filter's default would have rewritten `code` to 'ERROR'; the
    // verbatim brand is what stops it.
    expect(response.body).toEqual({
      statusCode: 412,
      code: 'AI_KEY_REQUIRED',
      message: expect.stringContaining('OpenAI API key is required'),
    });
  });

  it('leaves every other gateway failure alone in assertAiKeyAvailable', () => {
    // A route with a deterministic fallback (PRD §120) simply does not call
    // this, and a route that does must not have unrelated failures converted.
    expect(() =>
      assertAiKeyAvailable({ ok: false, error: { code: 'rate_limit' } }),
    ).not.toThrow();
    expect(() => assertAiKeyAvailable({ ok: true })).not.toThrow();
    expect(() =>
      assertAiKeyAvailable({ ok: false, error: { code: 'no_user_key' } }),
    ).toThrow(AiKeyRequiredException);
  });
});
