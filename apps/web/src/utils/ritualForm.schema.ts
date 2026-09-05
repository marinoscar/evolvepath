import { z } from 'zod';

import type { RitualInput, RitualRecurrence } from '../types';

/**
 * The ritual editor's form, mirroring `createRitualSchema` on the API.
 *
 * Client-side validation is a COURTESY, never the rule: the server re-checks
 * all of it, and the behaviour lint in particular is enforced there whether or
 * not this schema ran. What this buys is that the user learns their minimum is
 * longer than their ideal while the two fields are still on screen.
 */
export const ritualFormSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the ritual a name').max(120),
    purpose: z.string().trim().max(300).optional(),
    familyMemberId: z.string().nullable().optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one day'),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm'),
    everyNWeeks: z.union([z.literal(1), z.literal(2), z.literal(4)]),
    idealMinutes: z.number().int().min(5).max(240),
    minimumMinutes: z.number().int().min(1).max(240),
    fallbackBehavior: z.string().trim().max(200).optional(),
    outcomeId: z.string().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    // The minimum version is what keeps a ritual alive on a bad day; a minimum
    // longer than the ideal makes the bad-day path the harder one.
    if (value.minimumMinutes > value.idealMinutes) {
      ctx.addIssue({
        code: 'custom',
        path: ['minimumMinutes'],
        message: 'The minimum cannot be longer than the ideal',
      });
    }
  });

export type RitualFormValues = z.infer<typeof ritualFormSchema>;

export const DEFAULT_RITUAL_FORM: RitualFormValues = {
  title: '',
  purpose: '',
  familyMemberId: null,
  weekdays: [],
  time: '18:30',
  everyNWeeks: 1,
  idealMinutes: 45,
  minimumMinutes: 10,
  fallbackBehavior: '',
  outcomeId: null,
};

/** The form's flat shape, as the nested body the API takes. */
export function toRitualInput(values: RitualFormValues): RitualInput {
  const recurrence: RitualRecurrence = {
    weekdays: [...values.weekdays].sort((a, b) => a - b),
    time: values.time,
    everyNWeeks: values.everyNWeeks,
  };

  return {
    title: values.title.trim(),
    purpose: values.purpose?.trim() ? values.purpose.trim() : null,
    familyMemberId: values.familyMemberId ?? null,
    recurrence,
    idealMinutes: values.idealMinutes,
    minimumMinutes: values.minimumMinutes,
    fallbackBehavior: values.fallbackBehavior?.trim() ? values.fallbackBehavior.trim() : null,
    outcomeId: values.outcomeId ?? null,
  };
}

/** A stored ritual, as the form that edits it. */
export function toRitualForm(ritual: {
  title: string;
  purpose: string | null;
  familyMemberId: string | null;
  recurrence: RitualRecurrence;
  idealMinutes: number;
  minimumMinutes: number;
  fallbackBehavior: string | null;
}): RitualFormValues {
  return {
    title: ritual.title,
    purpose: ritual.purpose ?? '',
    familyMemberId: ritual.familyMemberId,
    weekdays: [...ritual.recurrence.weekdays],
    time: ritual.recurrence.time,
    everyNWeeks: ritual.recurrence.everyNWeeks,
    idealMinutes: ritual.idealMinutes,
    minimumMinutes: ritual.minimumMinutes,
    fallbackBehavior: ritual.fallbackBehavior ?? '',
    // Not editable after creation: the routine link is created with the ritual
    // and moving it would mean rehoming a routine across plan versions.
    outcomeId: null,
  };
}
