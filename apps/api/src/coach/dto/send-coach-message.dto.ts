import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const sendCoachMessageSchema = z.object({
  /** Absent means "start a new thread"; the title comes from the first message. */
  conversationId: z.string().uuid().optional(),
  text: z.string().trim().min(1).max(4000),
  /**
   * Stored objects of the caller's, at most four. Not a foreign key on
   * `coach_messages` — deleting an upload must not delete the message the user
   * sent — so ownership is checked at the boundary instead.
   */
  attachmentIds: z.array(z.string().uuid()).max(4).optional(),
});

export class SendCoachMessageDto extends createZodDto(sendCoachMessageSchema) {}
