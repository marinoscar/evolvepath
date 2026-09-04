// =============================================================================
// Model version filter (issue #22, epic #20)
// =============================================================================
//
// The product owner's constraint, expressed once: EvolvePath talks to GPT 5.4
// or newer, and to nothing else. OpenAI's `/v1/models` returns everything the
// key can reach — old chat models, embeddings, moderation, realtime and audio
// variants — so an unfiltered catalog would let an administrator pick a model
// that cannot satisfy the structured-output contract every AI call in this
// product depends on (PRD §115/§16), and the failure would surface much later
// as an unreadable provider response rather than as a greyed-out option.
//
// PURE, AND FREE OF NEST. The catalog service (#24) mocks the provider and
// relies on this module untouched; the settings service (#24) calls
// `isSupportedModelId` to turn a submitted `defaultModel` into a 400. Both
// want a function, not a provider.
//
// WHY A VERSION FLOOR RATHER THAN AN ALLOWLIST OF IDS. An allowlist goes stale
// the day OpenAI ships a model, and going stale means an administrator cannot
// select a model they are paying for until this repo is redeployed. A floor
// plus a variant denylist lets new versions through automatically and keeps
// out the families that are structurally wrong for this product, which is the
// distinction that actually matters.
// =============================================================================

/**
 * The oldest model family this product will talk to.
 *
 * Compared NUMERICALLY, field by field — `5.10` is newer than `5.4`, which a
 * string comparison gets backwards. The spec has that case in its table.
 */
export const MIN_SUPPORTED_MODEL = { major: 5, minor: 4 } as const;

/**
 * Variant tokens that disqualify a model however new it is.
 *
 * These are not "older", they are a different SHAPE: a realtime or audio model
 * speaks a different API surface, an embedding or moderation model does not
 * generate text at all, and an instruct/codex variant is not a Responses-API
 * chat model. Matched against the dash-separated tokens of the variant, so
 * `gpt-5.5-audio` is excluded while a hypothetical `gpt-5.5-audiophile` is not
 * — substring matching would over-reach, and over-reaching here silently hides
 * a model the administrator is entitled to use.
 */
export const EXCLUDED_MODEL_VARIANT_TOKENS = [
  'realtime',
  'audio',
  'transcribe',
  'tts',
  'image',
  'embedding',
  'moderation',
  'search',
  'instruct',
  'codex',
] as const;

/** A model id broken into the parts the floor and the denylist compare. */
export interface ParsedGptModelId {
  major: number;
  minor: number;
  /** Everything after the version, e.g. `mini` or `2026-03-01`. */
  variant: string | null;
}

/**
 * Anchored at both ends and at `gpt-`, which is what rejects `chatgpt-5.4-latest`
 * and `o3` without needing them in the denylist. A missing minor is `0`, so
 * `gpt-5` reads as 5.0 and falls below the floor — the right answer, since
 * `gpt-5` is a real, older model rather than a shorthand for the newest 5.x.
 */
const GPT_MODEL_ID = /^gpt-(\d+)(?:\.(\d+))?(?:-([a-z0-9.-]+))?$/i;

/**
 * Break `id` into major/minor/variant, or `null` when it is not a GPT model id.
 *
 * RETURNS `null` RATHER THAN THROWING: every caller is filtering a list that
 * came off the network, where an unrecognised id is an ordinary occurrence and
 * not an error condition.
 */
export function parseGptModelId(id: string): ParsedGptModelId | null {
  const match = GPT_MODEL_ID.exec(id.trim());
  if (!match) return null;

  return {
    major: Number.parseInt(match[1]!, 10),
    minor: match[2] === undefined ? 0 : Number.parseInt(match[2], 10),
    variant: match[3] ? match[3].toLowerCase() : null,
  };
}

/** Is `parsed` at or above {@link MIN_SUPPORTED_MODEL}? */
function meetsVersionFloor(parsed: ParsedGptModelId): boolean {
  if (parsed.major !== MIN_SUPPORTED_MODEL.major) {
    return parsed.major > MIN_SUPPORTED_MODEL.major;
  }
  return parsed.minor >= MIN_SUPPORTED_MODEL.minor;
}

/**
 * May an administrator select `id`?
 *
 * The single answer both the catalog filter and the settings validator use, so
 * "the select offered it" and "the save accepted it" can never disagree.
 */
export function isSupportedModelId(id: string): boolean {
  const parsed = parseGptModelId(id);
  if (!parsed) return false;
  if (!meetsVersionFloor(parsed)) return false;

  if (parsed.variant) {
    const tokens = parsed.variant.split('-');
    if (
      tokens.some((token) =>
        (EXCLUDED_MODEL_VARIANT_TOKENS as readonly string[]).includes(token),
      )
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Newest first, then alphabetical — the order the admin select renders.
 *
 * Version descending puts the model an administrator most likely wants at the
 * top; the id tiebreak is what keeps `gpt-5.4` above `gpt-5.4-mini` (the base
 * model before its cheaper sibling) and, more importantly, makes the order
 * TOTAL and stable, so the select does not reshuffle between two refreshes
 * that returned the same set in a different order.
 *
 * An unparseable id sorts last rather than throwing: `filterSupportedModels`
 * never passes one, but this is exported and a caller sorting a raw catalog
 * should get a defined answer.
 */
export function compareModelIds(a: string, b: string): number {
  const pa = parseGptModelId(a);
  const pb = parseGptModelId(b);

  if (pa && pb) {
    if (pa.major !== pb.major) return pb.major - pa.major;
    if (pa.minor !== pb.minor) return pb.minor - pa.minor;
  } else if (pa) {
    return -1;
  } else if (pb) {
    return 1;
  }

  return a.localeCompare(b);
}

/**
 * The supported subset of `models`, newest first.
 *
 * Generic over `{ id: string }` so it works on the provider's `AiModelInfo`
 * (which carries `created`) without this module having to import the provider
 * interface — keeping the filter free of everything except strings.
 *
 * Returns a NEW array; the input is not sorted in place, because the caller
 * frequently holds a cached catalog it is also about to return.
 */
export function filterSupportedModels<T extends { id: string }>(
  models: T[],
): T[] {
  return models
    .filter((model) => isSupportedModelId(model.id))
    .sort((a, b) => compareModelIds(a.id, b.id));
}
