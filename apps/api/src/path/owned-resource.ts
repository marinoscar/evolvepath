import { NotFoundException } from '@nestjs/common';

// =============================================================================
// The one way this module answers "is this row yours?" (issue #39, epic #33)
// =============================================================================
//
// EVERY per-user lookup goes through here, and the reason is a single sentence:
// A 403 CONFIRMS THE ROW EXISTS. `GET /outcomes/<someone else's id>` answering
// "Forbidden" tells an attacker they guessed a real id; answering "Not found"
// tells them nothing they did not already know. The two responses must be
// byte-identical, which they are only if there is one code path producing them.
//
// The shape of the lookup matters as much as the response. Callers pass a
// thunk that already scopes the query — `findFirst({ where: { id, userId } })`
// — rather than fetching by id and comparing `userId` afterwards. The second
// form works today and is one refactor away from a leak, because the row is in
// memory by the time anybody decides what to do with it.
// =============================================================================

/**
 * Resolves an already-ownership-scoped lookup, or throws 404.
 *
 * @param lookup A query that ALREADY filters on `userId` — e.g.
 *   `() => prisma.outcome.findFirst({ where: { id, userId } })`.
 * @param what The noun for the message, e.g. `'Outcome'`.
 */
export async function findOwnedOrThrow<T>(
  lookup: () => Promise<T | null>,
  what: string,
): Promise<T> {
  const row = await lookup();

  if (row === null || row === undefined) {
    throw new NotFoundException(`${what} not found`);
  }

  return row;
}
