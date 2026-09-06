import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const testLoginSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'contributor', 'viewer']).optional().default('viewer'),
  displayName: z.string().optional(),

  /**
   * Seed an OpenAI API key for the user, so the login lands on the app rather
   * than on `/setup/ai-key` (#25, epic #20).
   *
   * `preprocess` because the `/testing/login` page is a NATIVE
   * `<form method="POST">` and Nest's Fastify adapter registers
   * `@fastify/formbody`, so a checked checkbox arrives as the STRING `'on'`,
   * not as `true`. Without this the DTO would reject every form submission that
   * ticked the box. The four accepted truthy spellings cover the form (`'on'`),
   * JSON (`true`), a query-string client (`'true'`) and a shell script (`'1'`);
   * everything else, including an absent field, is false.
   */
  withAiKey: z
    .preprocess(
      (value) =>
        value === true || value === 'true' || value === 'on' || value === '1',
      z.boolean(),
    )
    .optional(),

  /**
   * Mark onboarding finished, so the login lands on the app rather than on the
   * `/onboarding` wizard (#107, epic E04).
   *
   * -----------------------------------------------------------------------------
   * DEFAULTS TO `true`, WHICH IS WHY THIS CANNOT BE A BARE CHECKBOX
   * -----------------------------------------------------------------------------
   * Every pre-existing e2e spec expects to land on `/` and every one of them is
   * about something other than onboarding; making them opt IN would mean editing
   * all of them to keep testing what they already test.
   *
   * An unchecked HTML checkbox sends NOTHING, so "absent" cannot mean both "the
   * default" and "the user unticked it". `TestLoginPage` therefore pairs the
   * checkbox with a hidden `withOnboarding=false` before it — the standard HTML
   * idiom — and the two arrive as an ARRAY when the box is ticked. The LAST
   * value wins, which is exactly that idiom's contract.
   *
   * The truthy spellings match `withAiKey`'s: the form (`'on'`), JSON (`true`),
   * a query-string client (`'true'`) and a shell script (`'1'`).
   */
  withOnboarding: z.preprocess((value) => {
    const raw = Array.isArray(value) ? value[value.length - 1] : value;

    if (raw === undefined || raw === null) return true;

    return raw === true || raw === 'true' || raw === 'on' || raw === '1';
  }, z.boolean()),
});

export class TestLoginDto extends createZodDto(testLoginSchema) {}
