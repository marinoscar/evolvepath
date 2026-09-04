import { z, type ZodType } from 'zod';

// =============================================================================
// Zod -> OpenAI strict-mode JSON Schema (issue #23, epic #20)
// =============================================================================
//
// PRD §115 step 5 is "call model with structured contract" and §16 requires
// validated structured output. OpenAI enforces that server-side only under
// `strict: true`, and strict mode is narrower than JSON Schema:
//
//   • every object must set `additionalProperties: false`
//   • every property must be listed in `required` — optionality does not exist
//   • `additionalProperties: <schema>` (a record/map) is not expressible
//
// Zod 4's `z.toJSONSchema` already emits the first rule and a correct
// `required` list, but its `required` reflects Zod's optionality, which strict
// mode forbids. So this module walks the result and does one substantive thing:
// TURNS OPTIONAL PROPERTIES INTO NULLABLE REQUIRED ONES. `{ note?: string }`
// becomes `note: string | null`, always present. That is the only faithful
// translation available, and it is why callers' Zod schemas should prefer
// `.nullable()` over `.optional()` — the round trip is then lossless.
//
// WHAT IT REFUSES, AND WHY IT THROWS RATHER THAN DEGRADES
// A record or a union of objects cannot be expressed under strict mode at all.
// Silently dropping the constraint would ship a request OpenAI rejects at
// runtime, from a caller that believed its contract was enforced; silently
// widening it would produce output the caller's own Zod parse then rejects,
// surfacing as `invalid_output` with no hint that the schema was the problem.
// Throwing at conversion time is a programmer error reported at the call site
// — which is why #26 keeps this call OUTSIDE the provider span, so it never
// looks like a provider failure.
//
// Callers model these with explicit keys instead: `{ monday: …, tuesday: … }`
// rather than `z.record(z.string(), …)`, and a discriminated shape with
// nullable branches rather than a union of objects.
// =============================================================================

type JsonSchemaNode = Record<string, unknown>;

/** Is this node the `{ type: 'null' }` branch a nullable produces? */
function isNullBranch(node: unknown): boolean {
  return (
    !!node &&
    typeof node === 'object' &&
    (node as JsonSchemaNode).type === 'null'
  );
}

/**
 * Make one property schema accept `null` as well as its own type.
 *
 * Two shapes, because Zod emits two: a plain `{ type: 'string' }` gains a
 * tuple type, and an existing `anyOf` (already nullable, or an enum union)
 * gains a null branch. Both are valid strict-mode JSON Schema; producing a
 * single shape for both would mean rewriting an `anyOf` into a `type` array,
 * which loses the branches' own constraints.
 */
function makeNullable(node: JsonSchemaNode): JsonSchemaNode {
  if (Array.isArray(node.anyOf)) {
    if (node.anyOf.some((branch) => isNullBranch(branch))) return node;
    return { ...node, anyOf: [...node.anyOf, { type: 'null' }] };
  }

  if (typeof node.type === 'string') {
    return node.type === 'null' ? node : { ...node, type: [node.type, 'null'] };
  }

  if (Array.isArray(node.type)) {
    return node.type.includes('null')
      ? node
      : { ...node, type: [...node.type, 'null'] };
  }

  // A node with neither `type` nor `anyOf` — `z.any()`, or a `$ref`. Wrapping
  // it in an anyOf is the one option that cannot lose information.
  return { anyOf: [node, { type: 'null' }] };
}

function walk(node: unknown, path: string): unknown {
  if (Array.isArray(node)) {
    return node.map((item, index) => walk(item, `${path}[${index}]`));
  }

  if (!node || typeof node !== 'object') return node;

  const current = { ...(node as JsonSchemaNode) };

  // `$schema` is meaningful to a validator and noise to OpenAI, which rejects
  // unknown top-level keys in some strict-mode paths. Dropped everywhere, not
  // just at the root, since a nested `$ref`ed definition can carry one.
  delete current.$schema;

  if (Array.isArray(current.anyOf) || Array.isArray(current.oneOf)) {
    const branches = (current.anyOf ?? current.oneOf) as unknown[];
    const substantive = branches.filter((branch) => !isNullBranch(branch));

    const objectBranches = substantive.filter(
      (branch) =>
        !!branch &&
        typeof branch === 'object' &&
        (branch as JsonSchemaNode).type === 'object',
    );

    if (objectBranches.length > 1) {
      throw new Error(
        `Cannot convert schema to OpenAI strict mode at "${path}": a union of objects is not expressible. ` +
          'Model the alternatives as explicit nullable keys on one object instead.',
      );
    }
  }

  if (current.type === 'object') {
    const additional = current.additionalProperties;

    // A RECORD. Zod emits `additionalProperties: <schema>` (plus
    // `propertyNames`) for `z.record`; strict mode has no way to say "any key".
    if (
      additional !== undefined &&
      additional !== false &&
      typeof additional === 'object'
    ) {
      throw new Error(
        `Cannot convert schema to OpenAI strict mode at "${path}": a record (open-ended keys) is not expressible. ` +
          'Declare the keys explicitly instead.',
      );
    }

    const properties = (current.properties ?? {}) as JsonSchemaNode;
    const declared = Object.keys(properties);
    const required = new Set(
      Array.isArray(current.required) ? (current.required as string[]) : [],
    );

    const rewritten: JsonSchemaNode = {};

    for (const key of declared) {
      const child = walk(properties[key], `${path}.${key}`) as JsonSchemaNode;
      // The substantive rule: an optional property becomes a nullable one.
      rewritten[key] = required.has(key) ? child : makeNullable(child);
    }

    current.properties = rewritten;
    // Strict mode: EVERY declared property is required, without exception.
    current.required = declared;
    current.additionalProperties = false;

    // Meaningless once `additionalProperties` is false, and rejected by some
    // strict-mode validators as an unexpected keyword alongside it.
    delete current.propertyNames;

    return current;
  }

  for (const [key, value] of Object.entries(current)) {
    if (key === 'properties') continue;
    current[key] = walk(value, `${path}.${key}`);
  }

  return current;
}

/**
 * Convert a caller's Zod output contract into the schema OpenAI's strict mode
 * accepts.
 *
 * @throws when the schema uses a record or a union of objects. See the header:
 *         this is a programmer error surfaced at the call site, deliberately
 *         not a provider failure.
 */
export function toOpenAiStrictSchema(
  schema: ZodType,
): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, { io: 'output' });
  return walk(generated, '$') as Record<string, unknown>;
}
