import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ProposalSummaryDto } from '../proposals/dto/proposal-response.dto';

export class ConversationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true }) title!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) lastMessageAt!: string;
}

export class ConversationListDto {
  @ApiProperty({ type: [ConversationResponseDto] })
  items!: ConversationResponseDto[];

  @ApiProperty({ nullable: true, description: 'Pass back as ?cursor= for the next page' })
  nextCursor!: string | null;
}

export class CoachMessageDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['USER', 'COACH', 'SYSTEM'] }) role!: string;
  @ApiProperty() content!: string;

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description:
      'The validated coach_reply contract, plus proposal.proposalId when the turn created one. ' +
      'Null on USER and SYSTEM rows and on template fallbacks — a fallback is deliberately ' +
      'indistinguishable from "no contract", because there was no model output.',
  })
  structured!: Record<string, unknown> | null;

  @ApiProperty({ type: [String] }) attachmentIds!: string[];

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description:
      'decision, category and the user-facing note. The rule id and prompt version are not exposed.',
  })
  safety!: Record<string, unknown> | null;

  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class CoachMessageListDto {
  @ApiProperty({ type: [CoachMessageDto] }) items!: CoachMessageDto[];
}

export class SendCoachMessageResponseDto {
  @ApiProperty({ format: 'uuid' }) conversationId!: string;
  @ApiProperty({ type: CoachMessageDto }) userMessage!: CoachMessageDto;
  @ApiProperty({ type: CoachMessageDto }) coachMessage!: CoachMessageDto;

  @ApiPropertyOptional({ type: ProposalSummaryDto })
  proposal?: ProposalSummaryDto;

  @ApiProperty({
    description:
      'True when the reply is a template rather than model output — a provider failure, ' +
      'or output the guard refused. The turn is still a 201.',
  })
  degraded!: boolean;
}

export class SuggestedPromptDto {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  @ApiProperty() text!: string;
}

export class SuggestedPromptsDto {
  @ApiProperty({ type: [SuggestedPromptDto] }) prompts!: SuggestedPromptDto[];
}
