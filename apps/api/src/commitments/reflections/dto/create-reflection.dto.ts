import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const reflectionRelatedTypeSchema = z.enum([
  'commitment',
  'outcome',
  'plan_version',
  'day',
]);

const score = z.number().int().min(1).max(5);

export const createReflectionSchema = z
  .object({
    relatedType: reflectionRelatedTypeSchema,
    relatedId: z.string().uuid().nullish(),
    userText: z.string().trim().max(4000).nullish(),
    frictionTags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
    mood: score.nullish(),
    perceivedDifficulty: score.nullish(),
    satisfaction: score.nullish(),
  })
  .superRefine((value, ctx) => {
    // A reflection about a 'day' is about a date the client already knows;
    // everything else points at a row that must exist and be the caller's.
    if (value.relatedType !== 'day' && !value.relatedId) {
      ctx.addIssue({
        code: 'custom',
        path: ['relatedId'],
        message: `relatedId is required when relatedType is '${value.relatedType}'`,
      });
    }

    // An empty reflection is a row with nothing in it. Refusing it keeps
    // "how many times did you reflect?" a meaningful number.
    const hasContent =
      Boolean(value.userText?.trim()) ||
      value.frictionTags.length > 0 ||
      value.mood != null ||
      value.perceivedDifficulty != null ||
      value.satisfaction != null;

    if (!hasContent) {
      ctx.addIssue({
        code: 'custom',
        message: 'A reflection needs a note, a friction tag or at least one score',
      });
    }
  });

export class CreateReflectionDto extends createZodDto(createReflectionSchema) {}
