import { z } from 'zod';

import { toOpenAiStrictSchema } from './strict-json-schema';

describe('toOpenAiStrictSchema', () => {
  it('requires every declared property and makes optionals nullable', () => {
    const schema = toOpenAiStrictSchema(
      z.object({ a: z.string(), b: z.number().optional() }),
    );

    expect(schema.required).toEqual(['a', 'b']);
    expect(schema.additionalProperties).toBe(false);

    const properties = schema.properties as Record<string, { type: unknown }>;
    expect(properties.a!.type).toBe('string');
    // Optionality does not exist in strict mode; nullable is the faithful
    // translation.
    expect(properties.b!.type).toEqual(['number', 'null']);
  });

  it('handles the connection probe schema', () => {
    expect(toOpenAiStrictSchema(z.object({ ok: z.boolean() }))).toEqual({
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    });
  });

  it('applies the same rules to nested objects and to array items', () => {
    const schema = toOpenAiStrictSchema(
      z.object({
        nested: z.object({ x: z.string(), y: z.string().optional() }),
        list: z.array(z.object({ z: z.string().optional() })),
      }),
    );

    const properties = schema.properties as Record<string, Record<string, unknown>>;

    const nested = properties.nested!;
    expect(nested.required).toEqual(['x', 'y']);
    expect(nested.additionalProperties).toBe(false);

    const items = properties.list!.items as Record<string, unknown>;
    expect(items.required).toEqual(['z']);
    expect(items.additionalProperties).toBe(false);
  });

  it('adds a null branch to an already-anyOf property rather than rewriting it', () => {
    const schema = toOpenAiStrictSchema(
      z.object({ maybe: z.union([z.string(), z.number()]).optional() }),
    );

    const maybe = (schema.properties as Record<string, Record<string, unknown>>)
      .maybe!;

    expect(maybe.anyOf).toEqual([
      { type: 'string' },
      { type: 'number' },
      { type: 'null' },
    ]);
  });

  it('leaves an explicitly nullable property with exactly one null branch', () => {
    const schema = toOpenAiStrictSchema(
      z.object({ note: z.string().nullable() }),
    );

    const note = (schema.properties as Record<string, Record<string, unknown>>)
      .note!;

    expect(note.anyOf).toEqual([{ type: 'string' }, { type: 'null' }]);
    expect(schema.required).toEqual(['note']);
  });

  it('strips $schema', () => {
    expect(
      toOpenAiStrictSchema(z.object({ a: z.string() })).$schema,
    ).toBeUndefined();
  });

  it('refuses a record, naming the path', () => {
    expect(() =>
      toOpenAiStrictSchema(z.object({ counts: z.record(z.string(), z.number()) })),
    ).toThrow(/\$\.counts.*record/s);
  });

  it('refuses a union of objects, naming the path', () => {
    expect(() =>
      toOpenAiStrictSchema(
        z.object({
          either: z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
        }),
      ),
    ).toThrow(/union of objects/);
  });
});
