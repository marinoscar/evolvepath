import request from 'supertest';

import {
  TestContext,
  createTestApp,
  closeTestApp,
} from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockTestUser, authHeader } from '../helpers/auth-mock.helper';
import { AiGatewayService } from '../../src/ai/gateway/ai-gateway.service';

// =============================================================================
// POST /media/attachments/:id/ask (issue #96, epic #67)
// =============================================================================
//
// The rule this file exists to hold: **the coaching path is always 200.** A
// provider failure, a missing key, or output that fails the contract is a
// readable `{ ok: false, error }` (PRD §120) — the deterministic product keeps
// working when the model does not, and an exception here would turn "the coach
// is unavailable" into "the page is broken".
//
// The 4xx answers are about the MEDIA, not the model: 404 for something that
// is not yours, 409 while it is still processing, 400 when processing failed,
// 429 past the rate limit.
// =============================================================================

const ATTACHMENT_ID = '550e8400-e29b-41d4-a716-4466554400aa';

const ADVICE = {
  summary: 'Your setup looks steady.',
  observations: ['Feet are under the bar.'],
  advice: ['Brace before you unrack.'],
  safetyFlag: { level: 'none', reason: '' },
};

describe('Media ask integration', () => {
  let context: TestContext;
  const gateway = { invoke: jest.fn() };

  const storageObject = (overrides: Record<string, any> = {}) => ({
    id: 'obj-1',
    name: 'clip.mp4',
    size: BigInt(2048),
    mimeType: 'video/mp4',
    storageKey: 'uploads/1/clip.mp4',
    storageProvider: 's3',
    bucket: 'test-bucket',
    status: 'ready',
    s3UploadId: null,
    metadata: null,
    uploadedById: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const attachment = (overrides: Record<string, any> = {}) => ({
    id: ATTACHMENT_ID,
    userId: 'user-1',
    storageObjectId: 'obj-1',
    kind: 'VIDEO',
    purpose: 'WORKOUT_FORM',
    targetType: null,
    targetId: null,
    aiSummary: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    storageObject: storageObject(),
    ...overrides,
  });

  beforeAll(async () => {
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [{ provide: AiGatewayService, useValue: gateway }],
    });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    jest.clearAllMocks();
    context.prismaMock.auditEvent.create.mockResolvedValue({});
    context.prismaMock.mediaAttachment.update.mockResolvedValue({});
  });

  it('answers 200 with the advice and stores it on the attachment', async () => {
    const user = await createMockTestUser(context);
    context.prismaMock.mediaAttachment.findUnique.mockResolvedValue(
      attachment({ userId: user.id }),
    );
    gateway.invoke.mockResolvedValue({
      ok: true,
      output: ADVICE,
      invocationId: 'inv-1',
      model: 'gpt-test',
      latencyMs: 100,
    });

    const response = await request(context.app.getHttpServer())
      .post(`/api/media/attachments/${ATTACHMENT_ID}/ask`)
      .set(authHeader(user.accessToken))
      .send({ question: 'Is my back rounding?' })
      .expect(200);

    expect(response.body.data).toMatchObject({
      ok: true,
      advice: { summary: 'Your setup looks steady.' },
      invocationId: 'inv-1',
    });

    const [{ data }] = context.prismaMock.mediaAttachment.update.mock.calls[0];
    expect(data.aiSummary.summary).toBe('Your setup looks steady.');
    expect(data.aiSummary.question).toBe('Is my back rounding?');
  });

  it('answers 200 with ok:false when the caller has no key', async () => {
    // The one the UI must handle by linking to /settings/ai-key, because it is
    // the user's to fix rather than an outage.
    const user = await createMockTestUser(context);
    context.prismaMock.mediaAttachment.findUnique.mockResolvedValue(
      attachment({ userId: user.id }),
    );
    gateway.invoke.mockResolvedValue({
      ok: false,
      error: { code: 'no_user_key', message: 'Add your OpenAI key' },
    });

    const response = await request(context.app.getHttpServer())
      .post(`/api/media/attachments/${ATTACHMENT_ID}/ask`)
      .set(authHeader(user.accessToken))
      .send({})
      .expect(200);

    expect(response.body.data).toEqual({
      ok: false,
      error: { code: 'no_user_key', message: 'Add your OpenAI key' },
    });
    // Nothing stored: a failure must not overwrite a good previous answer.
    expect(context.prismaMock.mediaAttachment.update).not.toHaveBeenCalled();
  });

  it('answers 409 while the media is still processing', async () => {
    const user = await createMockTestUser(context);
    context.prismaMock.mediaAttachment.findUnique.mockResolvedValue(
      attachment({
        userId: user.id,
        storageObject: storageObject({ status: 'processing' }),
      }),
    );

    await request(context.app.getHttpServer())
      .post(`/api/media/attachments/${ATTACHMENT_ID}/ask`)
      .set(authHeader(user.accessToken))
      .send({})
      .expect(409);

    expect(gateway.invoke).not.toHaveBeenCalled();
  });

  it('answers 400 when processing failed', async () => {
    const user = await createMockTestUser(context);
    context.prismaMock.mediaAttachment.findUnique.mockResolvedValue(
      attachment({
        userId: user.id,
        storageObject: storageObject({ status: 'failed' }),
      }),
    );

    await request(context.app.getHttpServer())
      .post(`/api/media/attachments/${ATTACHMENT_ID}/ask`)
      .set(authHeader(user.accessToken))
      .send({})
      .expect(400);
  });

  it('answers 404 for a foreign attachment', async () => {
    const user = await createMockTestUser(context);
    context.prismaMock.mediaAttachment.findUnique.mockResolvedValue(
      attachment({ userId: 'somebody-else' }),
    );

    await request(context.app.getHttpServer())
      .post(`/api/media/attachments/${ATTACHMENT_ID}/ask`)
      .set(authHeader(user.accessToken))
      .send({})
      .expect(404);

    expect(gateway.invoke).not.toHaveBeenCalled();
  });

  it('refuses a question longer than the DTO allows', async () => {
    const user = await createMockTestUser(context);

    await request(context.app.getHttpServer())
      .post(`/api/media/attachments/${ATTACHMENT_ID}/ask`)
      .set(authHeader(user.accessToken))
      .send({ question: 'x'.repeat(501) })
      .expect(400);
  });

  it('answers 429 on the eleventh call in a minute', async () => {
    const user = await createMockTestUser(context);
    context.prismaMock.mediaAttachment.findUnique.mockResolvedValue(
      attachment({ userId: user.id }),
    );
    gateway.invoke.mockResolvedValue({
      ok: true,
      output: ADVICE,
      invocationId: 'inv-1',
      model: 'gpt-test',
      latencyMs: 10,
    });

    for (let call = 0; call < 10; call += 1) {
      await request(context.app.getHttpServer())
        .post(`/api/media/attachments/${ATTACHMENT_ID}/ask`)
        .set(authHeader(user.accessToken))
        .send({})
        .expect(200);
    }

    await request(context.app.getHttpServer())
      .post(`/api/media/attachments/${ATTACHMENT_ID}/ask`)
      .set(authHeader(user.accessToken))
      .send({})
      .expect(429);
  });

  it('requires authentication', async () => {
    await request(context.app.getHttpServer())
      .post(`/api/media/attachments/${ATTACHMENT_ID}/ask`)
      .send({})
      .expect(401);
  });
});
