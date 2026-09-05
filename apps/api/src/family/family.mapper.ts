import type { FamilyMember, Ritual } from '@prisma/client';

import {
  ritualRecurrenceSchema,
  type FamilyMemberResponse,
  type RitualRecurrence,
  type RitualResponse,
} from './family.schema';

/**
 * A `@db.Date` column as `YYYY-MM-DD`.
 *
 * `toISOString().slice(0, 10)` and NOT a timezone-aware format, deliberately.
 * Postgres hands a `date` back as midnight UTC; running it through the user's
 * zone would turn a birthday of the 9th into the 8th for everyone west of
 * Greenwich. A calendar date is not an instant and is never resolved as one.
 */
export function toDateOnly(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

/**
 * The ONLY way a family member reaches a response body.
 *
 * Written as an explicit projection rather than a spread with deletions: a
 * spread leaks whatever the row grows next, and this record is the one place in
 * the product where that is a privacy failure rather than an untidy payload.
 */
export function toFamilyMemberDto(member: FamilyMember): FamilyMemberResponse {
  return {
    id: member.id,
    nickname: member.nickname,
    relationship: member.relationship,
    birthday: toDateOnly(member.birthday),
    createdAt: member.createdAt.toISOString(),
  };
}

/**
 * `recurrence` is `Json` in Prisma and therefore `unknown` in practice — it
 * survived a migration and whatever wrote it. Parsing on the way out means a
 * corrupt row fails here, at the boundary, instead of somewhere inside the
 * recurrence engine with a stack trace that names neither the ritual nor the
 * user.
 */
export function parseRecurrence(value: unknown): RitualRecurrence {
  return ritualRecurrenceSchema.parse(value);
}

export function toRitualDto(ritual: Ritual): RitualResponse {
  return {
    id: ritual.id,
    title: ritual.title,
    purpose: ritual.purpose,
    familyMemberId: ritual.familyMemberId,
    recurrence: parseRecurrence(ritual.recurrence),
    idealMinutes: ritual.idealMinutes,
    minimumMinutes: ritual.minimumMinutes,
    fallbackBehavior: ritual.fallbackBehavior,
    active: ritual.active,
    lastMaterializedThrough: toDateOnly(ritual.lastMaterializedThrough),
    routineId: ritual.routineId,
    createdAt: ritual.createdAt.toISOString(),
    updatedAt: ritual.updatedAt.toISOString(),
  };
}

/** Members render oldest first — the order the user added them. */
export const FAMILY_MEMBER_ORDER = [{ createdAt: 'asc' as const }];

/** Active rituals first, then alphabetically, so a paused one never leads. */
export const RITUAL_ORDER = [{ active: 'desc' as const }, { title: 'asc' as const }];
