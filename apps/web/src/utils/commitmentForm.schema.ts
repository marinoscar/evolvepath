import { z } from 'zod';

// ===========================================================================
// The quick-add / edit form's contract (epic E05, issue #52)
// ===========================================================================
//
// PURE ZOD, in `utils/` so it can be tested without React. It is a MIRROR of
// `apps/api/src/commitments/dto/create-commitment.dto.ts`, not a replacement:
// the server validates every one of these rules again, and it is the server's
// answer that decides. Validating here buys the user a field-level error
// instead of a round trip and a banner.
// ===========================================================================

/** VISION §28's ladder plus the two lengths a real work block takes. */
export const DURATION_PRESETS = [5, 10, 20, 30, 45, 60] as const;

export const domainValues = ['WORK', 'FAMILY', 'HEALTH'] as const;

const minutes = z.number().int().min(1).max(480);

/**
 * One size of an intention: a title and how long it takes.
 *
 * Both or neither. A title with no duration cannot be sized against the day's
 * budget, and a duration with no title is a number the user never named.
 */
const optionalVersion = z
  .object({
    title: z.string().trim().max(500).optional(),
    minutes: minutes.optional(),
  })
  .refine(
    (value) => (value.title ? value.minutes !== undefined : true),
    { message: 'Say how long this version takes', path: ['minutes'] },
  )
  .refine(
    (value) => (value.minutes !== undefined ? Boolean(value.title) : true),
    { message: 'Give this version a name', path: ['title'] },
  );

export const commitmentFormSchema = z
  .object({
    domain: z.enum(domainValues),
    // Not the label repeated back: an error that echoes the question tells the
    // user nothing they cannot already see.
    title: z.string().trim().min(1, 'Give it a name').max(120),
    outcomeId: z.string().uuid().nullable(),
    /** Local wall-clock from a `datetime-local` input; converted on submit. */
    scheduledStart: z.string().min(1, 'Pick a time'),
    durationMinutes: minutes,
    importance: z.number().int().min(1).max(5),
    short: optionalVersion,
    minimum: optionalVersion,
  })
  .superRefine((value, ctx) => {
    // The ordering that makes the three sizes useful. A "short version" that
    // takes longer than the full one is a typo the next-best-action sizer would
    // happily offer to someone who just said they were depleted.
    if (value.short.minutes !== undefined && value.short.minutes > value.durationMinutes) {
      ctx.addIssue({
        code: 'custom',
        path: ['short', 'minutes'],
        message: 'The short version cannot take longer than the full one',
      });
    }

    const ceiling = value.short.minutes ?? value.durationMinutes;
    if (value.minimum.minutes !== undefined && value.minimum.minutes > ceiling) {
      ctx.addIssue({
        code: 'custom',
        path: ['minimum', 'minutes'],
        message:
          value.short.minutes !== undefined
            ? 'The minimum version cannot take longer than the short one'
            : 'The minimum version cannot take longer than the full one',
      });
    }
  });

export type CommitmentFormValues = z.infer<typeof commitmentFormSchema>;

/** Field path (`short.minutes`) → message, for rendering under each input. */
export type CommitmentFormErrors = Record<string, string>;

export function validateCommitmentForm(values: unknown): CommitmentFormErrors | null {
  const result = commitmentFormSchema.safeParse(values);
  if (result.success) return null;

  const errors: CommitmentFormErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.');
    // First message per field: a stack of three errors under one input is a
    // list to read rather than a thing to fix.
    if (!errors[key]) errors[key] = issue.message;
  }

  return errors;
}

/**
 * Form values → the API's create/patch body.
 *
 * `scheduledStart` is a `datetime-local` string, which has no timezone; `new
 * Date()` reads it in the browser's zone, which is what the user meant by
 * "19:00". The API stores the instant.
 */
export function toCommitmentInput(values: CommitmentFormValues) {
  return {
    domain: values.domain,
    title: values.title.trim(),
    outcomeId: values.outcomeId,
    scheduledStart: new Date(values.scheduledStart).toISOString(),
    importance: values.importance,
    // The full version's title is the commitment's own title unless the user
    // said otherwise — repeating it in a second field would be busywork.
    fullVersion: values.title.trim(),
    fullMinutes: values.durationMinutes,
    shortVersion: values.short.title?.trim() || null,
    shortMinutes: values.short.minutes ?? null,
    minimumVersion: values.minimum.title?.trim() || null,
    minimumMinutes: values.minimum.minutes ?? null,
  };
}

/** Now, rounded up to the next full hour, as a `datetime-local` value. */
export function defaultScheduledStart(now: Date = new Date()): string {
  const when = new Date(now);
  when.setMinutes(0, 0, 0);
  when.setHours(when.getHours() + 1);

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}
