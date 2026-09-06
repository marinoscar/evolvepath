/**
 * `heic-convert` ships no types (issue #87, epic #67).
 *
 * Declared narrowly rather than as `declare module 'heic-convert'` with an
 * implicit `any`: the whole call surface this project uses is one function with
 * four fields, and writing them down is what makes a wrong `format` a compile
 * error rather than a runtime one on an iPhone photo nobody tested with.
 */
declare module 'heic-convert' {
  interface HeicConvertOptions {
    buffer: Buffer | Uint8Array;
    format: 'JPEG' | 'PNG';
    /** 0-1. Only meaningful for JPEG. */
    quality?: number;
  }

  function convert(options: HeicConvertOptions): Promise<ArrayBuffer>;

  export = convert;
}
