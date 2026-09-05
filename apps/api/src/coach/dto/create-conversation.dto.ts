import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createConversationSchema = z.object({
  title: z.string().trim().max(120).nullish(),
});

export class CreateConversationDto extends createZodDto(createConversationSchema) {}
