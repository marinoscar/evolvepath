import { z } from 'zod';

// =============================================================================
// The typed boundary over `user_profiles` (issue #100, epic E04)
// =============================================================================
//
// The three JSON columns are validated HERE rather than in the database. Their
// shapes belong to the onboarding conversation and change with its copy; a
// column per answer would make every wording change a migration. What must not
// change is that nothing reaches those columns unvalidated, which is what this
// file guarantees.
// =============================================================================

/**
 * PRD §20 step 4. Stable keys, never the user-facing sentence: E07 groups
 * avoidance patterns on these and a copy edit must not split a cohort.
 */
export const OBSTACLE_OPTIONS = [
  'PROCRASTINATE',
  'TOO_AMBITIOUS',
  'FORGET',
  'SCHEDULE_CHANGES',
  'LOSE_MOTIVATION',
  'OVERWHELMED',
  'DONT_KNOW_WHAT',
  'OTHER',
] as const;

export type ObstacleOption = (typeof OBSTACLE_OPTIONS)[number];

export const obstaclesSchema = z.array(z.enum(OBSTACLE_OPTIONS)).max(8);

/** PRD §20 step 6. The floor and ceiling are honesty checks, not preferences. */
export const healthBaselineSchema = z.object({
  experience: z.enum(['NONE', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
  daysPerWeek: z.number().int().min(1).max(7),
  minutesPerSession: z.number().int().min(10).max(120),
  equipment: z.array(z.string().max(60)).max(20),
  preferences: z.string().max(500).optional(),
  limitations: z.string().max(500).optional(),
  /**
   * Up to three PRD §46 eating habits the user picked at onboarding (E09-10).
   *
   * Stored as keys, not copy: the registry owns the wording, and a stored
   * sentence would go stale the moment the copy improved. Nothing is scheduled
   * from these automatically — they appear on `/health` with an "add to this
   * week" button, which keeps E04's guardrails untouched.
   */
  nutritionBehaviors: z.array(z.string().max(60)).max(3).optional(),
});

export type HealthBaseline = z.infer<typeof healthBaselineSchema>;

/** PRD §20 step 3 — what the user said about each domain, in their words. */
export const domainReflectionsSchema = z.object({
  work: z.string().max(1000).optional(),
  family: z.string().max(1000).optional(),
  health: z.string().max(1000).optional(),
});

export type DomainReflections = z.infer<typeof domainReflectionsSchema>;

/**
 * 24-hour "HH:mm". Rejects `"9:00"` and `"24:00"` — a lenient parser here would
 * put an unorderable string in a column E12 compares lexicographically.
 */
export const quietHoursTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
  message: 'Expected a 24-hour time as HH:mm',
});

/** Minutes on a normal weekday. 15 minutes is a real answer; 24 hours is not. */
export const weekdayMinutesSchema = z.number().int().min(5).max(720);
