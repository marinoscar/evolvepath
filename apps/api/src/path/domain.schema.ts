import { z } from 'zod';

// =============================================================================
// Zod mirrors of the Prisma domain enums (issue #39, epic #33)
// =============================================================================
//
// Prisma generates TypeScript types for its enums, but a request body is
// `unknown` until something validates it — and `Prisma.$Enums.Domain` is a
// type, not a runtime value that Zod can consume. So these lists exist twice:
// once in `schema.prisma`, once here.
//
// Two lists that must agree is a drift risk, and the mitigation is a test
// rather than a convention: `domain.schema.spec.ts` asserts each `.options`
// array equals `Object.values(Prisma.$Enums.X)`, so adding a member on one
// side and not the other fails at `npm test`, not in production.
// =============================================================================

export const domainSchema = z.enum(['WORK', 'FAMILY', 'HEALTH']);
export type DomainValue = z.infer<typeof domainSchema>;

export const outcomeStateSchema = z.enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED']);
export type OutcomeStateValue = z.infer<typeof outcomeStateSchema>;

export const domainModeKindSchema = z.enum(['GROW', 'MAINTAIN', 'RECOVER', 'PAUSE']);
export type DomainModeKindValue = z.infer<typeof domainModeKindSchema>;

/**
 * The three domains in canonical render order. `GET /me/domain-modes` returns
 * exactly this order, and the Path screen's sections follow it.
 */
export const DOMAINS = domainSchema.options;
