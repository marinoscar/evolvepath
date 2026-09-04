// =============================================================================
// AI credential addresses (issue #24, epic #20)
// =============================================================================
//
// The `(purpose, name)` pairs every OpenAI key in this product lives at, in one
// file so that a rename is one edit and a typo is a compile error rather than a
// key written to an address nothing reads.
//
// TWO PURPOSES, NOT ONE WITH TWO NAMES. `CredentialsService` derives a distinct
// AES sub-key per purpose (see common/crypto/secret-cipher.ts), so a platform
// key and a user key are encrypted under different keys. A row moved or copied
// between the two addresses does not decrypt — which is a real, mechanical
// barrier against a mix-up in which a user's key ends up serving the admin
// catalog or, far worse, one user's key ends up serving another's call.
//
// The user key's `name` is the USER ID, which is why no migration is needed for
// per-user keys: the store is already keyed by an arbitrary discriminator
// within a purpose, and a uuid is a perfectly good one.
// =============================================================================

/** Purpose for the single platform-wide key. */
export const AI_PLATFORM_CREDENTIAL_PURPOSE = 'ai:openai';

/** Name within {@link AI_PLATFORM_CREDENTIAL_PURPOSE}. There is exactly one. */
export const AI_PLATFORM_CREDENTIAL_NAME = 'platform';

/** Human label stored alongside the platform key, for a future credentials UI. */
export const AI_PLATFORM_CREDENTIAL_LABEL = 'OpenAI platform API key';

/**
 * Purpose for per-user keys. The `name` is the user's id (#25).
 *
 * DELIBERATELY DISTINCT FROM THE PLATFORM PURPOSE. See the header.
 */
export const AI_USER_CREDENTIAL_PURPOSE = 'ai:openai:user';

/** Human label stored alongside a user's key. */
export const AI_USER_CREDENTIAL_LABEL = 'OpenAI API key';
