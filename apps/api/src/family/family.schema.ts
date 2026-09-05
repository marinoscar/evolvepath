import { z } from 'zod';

// =============================================================================
// The family boundary, expressed as schemas (issue #37, epic E08)
// =============================================================================
//
// THE MEMBER RESPONSE SCHEMA IS `.strict()` AND THAT IS THE FEATURE. PRD §33
// fixes what a family member record may hold; VISION §50 says why — the people
// in it never consented to being modeled. A permissive schema would let a
// `notes`, `mood` or `score` key ride along the day some service starts
// selecting `*`, and nothing would fail. Here, one extra key is a parse error.
//
// `FAMILY_MEMBER_RESPONSE_KEYS` exists beside it as the assertion target: the
// mapper's output is compared against this list by SORTED EQUALITY rather than
// containment, so a leak is a failing test rather than something a reviewer has
// to notice in a diff.
//
// `userId` is deliberately absent from both response schemas. These are own
// resources — the caller is the owner by construction — and echoing the id back
// is a value with no reader and one more thing to redact.
// =============================================================================

/** `0 = Sunday … 6 = Saturday`, matching JavaScript's `Date#getDay()`. */
export const WEEKDAY_MIN = 0;
export const WEEKDAY_MAX = 6;

/**
 * How often a ritual comes round.
 *
 * Not an RRULE string: the product needs three fields, a UI has to render them
 * as chips and a time picker, and parsing RFC 5545 back into that shape to draw
 * a form is strictly more code than storing the three fields. The recurrence
 * engine (issue #41) reads exactly this object.
 */
export const ritualRecurrenceSchema = z.object({
  /** `0 = Sunday … 6 = Saturday`. Display order is Monday-first; values are not. */
  weekdays: z
    .array(z.number().int().min(WEEKDAY_MIN).max(WEEKDAY_MAX))
    .min(1)
    .max(7)
    .refine((days) => new Set(days).size === days.length, 'weekdays must be unique'),
  /** `HH:mm`, local to `user_profiles.timezone`. */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:mm'),
  /** Anchored to the ritual's creation week; 3 is deliberately not offered. */
  everyNWeeks: z.union([z.literal(1), z.literal(2), z.literal(4)]),
});

export type RitualRecurrence = z.infer<typeof ritualRecurrenceSchema>;

export const familyRelationshipSchema = z.enum([
  'PARTNER',
  'CHILD',
  'PARENT',
  'SIBLING',
  'FRIEND',
  'OTHER',
]);

export type FamilyRelationshipValue = z.infer<typeof familyRelationshipSchema>;

/** `YYYY-MM-DD`. The year may be the 1900 placeholder; nothing reads it. */
export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');

export const familyMemberResponseSchema = z
  .object({
    id: z.string().uuid(),
    nickname: z.string().min(1).max(40),
    relationship: familyRelationshipSchema,
    birthday: dateOnlySchema.nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type FamilyMemberResponse = z.infer<typeof familyMemberResponseSchema>;

/**
 * Exactly the keys a family member record may ever expose.
 *
 * Kept as a literal list rather than derived from the schema on purpose: a
 * derived list would agree with the schema by construction and prove nothing.
 * `family.schema.spec.ts` asserts the two agree, so growing the schema without
 * meaning to fails the build.
 */
export const FAMILY_MEMBER_RESPONSE_KEYS = [
  'id',
  'nickname',
  'relationship',
  'birthday',
  'createdAt',
] as const;

export const ritualResponseSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string(),
    purpose: z.string().nullable(),
    familyMemberId: z.string().uuid().nullable(),
    recurrence: ritualRecurrenceSchema,
    idealMinutes: z.number().int(),
    minimumMinutes: z.number().int(),
    fallbackBehavior: z.string().nullable(),
    active: z.boolean(),
    lastMaterializedThrough: dateOnlySchema.nullable(),
    routineId: z.string().uuid().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type RitualResponse = z.infer<typeof ritualResponseSchema>;

/** The writable fields of a family member. */
export const createFamilyMemberSchema = z
  .object({
    nickname: z.string().trim().min(1).max(40),
    relationship: familyRelationshipSchema,
    birthday: dateOnlySchema.nullish(),
  })
  .strict();

export const updateFamilyMemberSchema = createFamilyMemberSchema.partial();
