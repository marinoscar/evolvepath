import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * What the coach may say about a photo or a video (issue #96, epic #67).
 *
 * EXPLICIT KEYS, no records and no unions of objects: `toStrictJsonSchema`
 * cannot express those and throws at the call site rather than shipping a
 * request OpenAI would reject.
 *
 * `safetyFlag` is the one field with product weight. `seek_professional` is
 * answered with FIXED COPY on the client — not with whatever the model wrote —
 * because the sentence a person reads when they are told to see a professional
 * has to be the same sentence every time, including when the provider is
 * having a bad day (PRD §45, §81).
 */
export const mediaAdviceSchema = z.object({
  summary: z.string().min(1).max(600),
  observations: z.array(z.string().min(1).max(300)).max(8),
  /**
   * At least one. A coaching call that produces observations and no advice is
   * a description, and the user asked a question.
   */
  advice: z.array(z.string().min(1).max(300)).min(1).max(6),
  safetyFlag: z
    .object({
      level: z.enum(['none', 'caution', 'seek_professional']),
      reason: z.string().max(300),
    })
    .nullable(),
});

export type MediaAdvice = z.infer<typeof mediaAdviceSchema>;

/**
 * What lands in `media_attachments.ai_summary`: the validated advice plus
 * enough provenance to answer "which prompt and which model said this?"
 * without joining `ai_invocations` (PRD §128).
 */
export type StoredMediaAdvice = MediaAdvice & {
  askedAt: string;
  question: string | null;
  invocationId: string;
  promptVersion: string;
  model: string;
};

export const askAboutMediaSchema = z.object({
  question: z.string().trim().max(500).optional(),
});

export type AskAboutMediaDto = z.infer<typeof askAboutMediaSchema>;

export class AskAboutMediaBodyDto extends createZodDto(askAboutMediaSchema) {}

/**
 * The response is **always 200**. A provider failure is a result, not an
 * exception (PRD §120) — and `no_user_key` is the one the UI must handle by
 * linking to `/settings/ai-key`, because that is the user's to fix.
 */
export const askAboutMediaResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    advice: mediaAdviceSchema,
    invocationId: z.string(),
    model: z.string(),
    latencyMs: z.number(),
    askedAt: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);

export type AskAboutMediaResult = z.infer<typeof askAboutMediaResponseSchema>;
