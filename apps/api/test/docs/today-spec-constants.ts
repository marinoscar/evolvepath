/**
 * The one Today constant that lives in the WEB app rather than the API.
 *
 * `apps/api`'s Jest project cannot import from `apps/web` (different tsconfig,
 * different module resolution), so the value is restated here with a pointer
 * rather than reached for. If they ever disagree, this file is the lie — and it
 * is a two-line one, in a place a reviewer looks.
 *
 * Source: `apps/web/src/utils/commitmentTimer.ts` → `MAX_CLOCK_SKEW_SECONDS`.
 */
export const MAX_CLOCK_SKEW_SECONDS_DOC = 5;
