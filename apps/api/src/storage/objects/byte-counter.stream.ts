import { Transform, TransformCallback } from 'node:stream';

/**
 * A pass-through that counts bytes and fails the stream past a limit
 * (issue #71, epic #67).
 *
 * The simple upload path hands a Readable straight to the provider, so the
 * only moment the real byte length is known is while it flows. Two things
 * depend on that: `storage_objects.size`, which was written as `0` "to be
 * updated by post-processing" and never was, and the size limit, which cannot
 * be enforced from a Content-Length a client controls.
 *
 * Overflow destroys the stream rather than merely stopping the count: a
 * `Transform` that quietly drops bytes would produce a truncated object that
 * looks successful.
 */
export class ByteCounterStream extends Transform {
  private counted = 0n;

  constructor(private readonly limitBytes: number) {
    super();
  }

  /** Bytes seen so far. Valid at any point; final once the stream ends. */
  get bytes(): bigint {
    return this.counted;
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.counted += BigInt(chunk.length);

    if (this.limitBytes > 0 && this.counted > BigInt(this.limitBytes)) {
      callback(new ByteLimitExceededError(this.counted, this.limitBytes));
      return;
    }

    callback(null, chunk);
  }
}

/**
 * Thrown into the stream on overflow. A named error rather than a
 * `BadRequestException` because it travels through provider code that would
 * otherwise wrap it; the service maps it to the 400 at the boundary it owns.
 */
export class ByteLimitExceededError extends Error {
  constructor(
    readonly bytes: bigint,
    readonly limitBytes: number,
  ) {
    super(`Upload exceeded ${limitBytes} bytes`);
    this.name = 'ByteLimitExceededError';
  }
}

/** Does this error (or any of its causes) mean "the upload was too big"? */
export function isByteLimitExceeded(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof ByteLimitExceededError) return true;
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}
