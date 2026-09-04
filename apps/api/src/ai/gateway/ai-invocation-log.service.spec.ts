import { AiInvocationLogService } from './ai-invocation-log.service';

const base = {
  invocationId: 'inv-1',
  operation: 'invoke' as const,
  keyScope: 'user' as const,
  userId: 'user-1',
  persona: 'coach',
  provider: 'openai',
  model: 'gpt-5.4',
  promptVersion: 'coach.v1',
  requestId: null,
  providerRequestId: null,
  status: 'succeeded' as const,
  errorCode: null,
  errorMessage: null,
  inputTokens: 1,
  outputTokens: 2,
  cachedInputTokens: 0,
  reasoningTokens: 0,
  latencyMs: 10,
  outputValid: true,
  attachmentCount: 0,
  input: null,
  output: null,
};

describe('AiInvocationLogService', () => {
  let prisma: { aiInvocation: { create: jest.Mock } };
  let service: AiInvocationLogService;

  const written = () => prisma.aiInvocation.create.mock.calls[0]![0].data;

  beforeEach(() => {
    prisma = { aiInvocation: { create: jest.fn().mockResolvedValue({}) } };
    service = new AiInvocationLogService(prisma as never);
  });

  it('writes the row under the caller-supplied invocation id', async () => {
    await service.record(base);

    expect(written().id).toBe('inv-1');
    expect(written().keyScope).toBe('user');
    expect(written().promptVersion).toBe('coach.v1');
  });

  it('redacts a key nested deep inside the JSON blobs', async () => {
    await service.record({
      ...base,
      input: {
        instructions: 'run: curl -H "authorization: Bearer sk-abcdefghijklmnop"',
        nested: [{ deeper: { note: 'sk-zyxwvutsrqponml' } }],
      },
      secrets: ['sk-abcdefghijklmnop'],
    });

    const serialised = JSON.stringify(written().input);
    expect(serialised).not.toContain('sk-abcdefghijklmnop');
    expect(serialised).not.toContain('sk-zyxwvutsrqponml');
    // Both passes fired: the registered key and the pattern.
    expect(serialised).toContain('[redacted]');
    expect(serialised).toContain('sk-***');
  });

  it('redacts object keys as well as values', async () => {
    await service.record({
      ...base,
      output: { 'sk-abcdefghijklmnop': 'value' },
    });

    expect(Object.keys(written().output)).toEqual(['sk-***']);
  });

  it('caps a blob at 32 KiB with a marker and a preview', async () => {
    await service.record({
      ...base,
      output: { big: 'x'.repeat(40 * 1024) },
    });

    // A truncated JSON document is not JSON, so the whole value is replaced
    // rather than cut short.
    expect(written().output._truncated).toBe(true);
    expect(written().output.preview).toHaveLength(1024);
  });

  it('leaves a blob under the cap intact', async () => {
    await service.record({ ...base, output: { ok: true } });

    expect(written().output).toEqual({ ok: true });
  });

  it('caps the error message at 2000 characters', async () => {
    await service.record({ ...base, errorMessage: 'y'.repeat(9000) });

    expect(written().errorMessage).toHaveLength(2000);
  });

  it('never rejects when the database write fails', async () => {
    // Telemetry must not fail the call it is describing.
    prisma.aiInvocation.create.mockRejectedValue(new Error('db down'));

    await expect(service.record(base)).resolves.toBeUndefined();
  });
});
