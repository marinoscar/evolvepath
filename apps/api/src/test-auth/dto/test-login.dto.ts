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
});

export class TestLoginDto extends createZodDto(testLoginSchema) {}
