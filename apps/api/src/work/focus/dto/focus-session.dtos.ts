import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// =============================================================================
// Bodies and queries for `/focus-sessions*` (issue #110, epic E07)
// =============================================================================
//
// None of these can set `outcome`, `actualMinutes` or `endedAt` other than
// through `stop`. A session is a RECORD of a stretch of work; a body that could
// write its duration would be a second, unvalidated way around the timer, and
// the timer is the only thing that makes the number honest.
// =============================================================================

export const startFocusSessionSchema = z.object({
  commitmentId: z.string().uuid(),

  /** 180 minutes is three hours: past that it is a day, not a focus session. */
  plannedMinutes: z.number().int().min(1).max(180),

  /** PRD §27's one sentence above the timer. Rendered as text, never HTML. */
  instruction: z.string().trim().min(1).max(240).nullish(),

  /**
   * "Stop the other one and start this." Explicit rather than implicit: a
   * client that silently took over would end somebody's running session
   * because a stale tab woke up.
   */
  takeOver: z.boolean().nullish(),
});

export class StartFocusSessionDto extends createZodDto(startFocusSessionSchema) {}

export const extendFocusSessionSchema = z.object({
  /** "Continue another 15?" — 60 is the ceiling on a single extension. */
  minutes: z.number().int().min(1).max(60),
});

export class ExtendFocusSessionDto extends createZodDto(extendFocusSessionSchema) {}

export const focusSessionNoteSchema = z.object({
  text: z.string().trim().min(1).max(280),
});

export class FocusSessionNoteDto extends createZodDto(focusSessionNoteSchema) {}

export const stopFocusSessionSchema = z.object({
  /**
   * Lower case on the wire, `FocusSessionOutcome` in the database. The three
   * are not a ranking: `abandoned` still writes TIMER evidence, because
   * starting is the behaviour the product is trying to reinforce (VISION §10).
   */
  outcome: z.enum(['done', 'partial', 'abandoned']),
  notes: z.string().trim().max(1000).nullish(),
});

export class StopFocusSessionDto extends createZodDto(stopFocusSessionSchema) {}

const isoDateTime = z.string().datetime({ offset: true }).or(z.string().datetime());

export const focusSessionQuerySchema = z.object({
  commitmentId: z.string().uuid().optional(),
  outcomeId: z.string().uuid().optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
});

export class FocusSessionQueryDto extends createZodDto(focusSessionQuerySchema) {}
