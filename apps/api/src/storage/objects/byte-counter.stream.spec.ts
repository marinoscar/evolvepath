import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  ByteCounterStream,
  ByteLimitExceededError,
  isByteLimitExceeded,
} from './byte-counter.stream';

/** Drain a readable without keeping it, so the counter is the only observer. */
async function drain(source: Readable, counter: ByteCounterStream) {
  await pipeline(source, counter, async function* (chunks) {
    for await (const chunk of chunks) {
      void chunk;
    }
  });
}

describe('ByteCounterStream', () => {
  it('counts the bytes that flow through it', async () => {
    const counter = new ByteCounterStream(1000);
    await drain(Readable.from([Buffer.alloc(300), Buffer.alloc(200)]), counter);

    expect(counter.bytes).toBe(500n);
  });

  it('fails the stream once the limit is crossed', async () => {
    const counter = new ByteCounterStream(400);

    await expect(
      drain(Readable.from([Buffer.alloc(300), Buffer.alloc(200)]), counter),
    ).rejects.toBeInstanceOf(ByteLimitExceededError);
  });

  it('allows a stream exactly at the limit', async () => {
    const counter = new ByteCounterStream(500);
    await drain(Readable.from([Buffer.alloc(500)]), counter);

    expect(counter.bytes).toBe(500n);
  });

  it('treats a limit of 0 as no limit', async () => {
    const counter = new ByteCounterStream(0);
    await drain(Readable.from([Buffer.alloc(10_000)]), counter);

    expect(counter.bytes).toBe(10000n);
  });

  it('recognizes the error through a wrapping cause chain', () => {
    // The AWS SDK wraps stream errors; the service has to recognize it after
    // the wrap or the user gets a 500 for a file that was merely too big.
    const wrapped = new Error('upload failed', {
      cause: new Error('inner', { cause: new ByteLimitExceededError(1n, 0) }),
    });

    expect(isByteLimitExceeded(wrapped)).toBe(true);
    expect(isByteLimitExceeded(new Error('unrelated'))).toBe(false);
  });
});
