import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CoachConversationsService } from './coach-conversations.service';
import { CoachService } from './coach.service';
import { SUGGESTED_PROMPTS } from './suggested-prompts';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendCoachMessageDto } from './dto/send-coach-message.dto';
import {
  CoachMessageListDto,
  ConversationListDto,
  ConversationResponseDto,
  SendCoachMessageResponseDto,
  SuggestedPromptsDto,
} from './dto/coach-response.dto';

@ApiTags('Coach')
@Controller('coach')
export class CoachController {
  constructor(
    private readonly coach: CoachService,
    private readonly conversations: CoachConversationsService,
  ) {}

  @Post('conversations')
  @Auth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Start a coach conversation',
    description:
      'Rarely needed: sending a message without a conversationId creates one, titled from the ' +
      'first thing the user said.',
  })
  @ApiResponse({ status: 201, type: ConversationResponseDto })
  async createConversation(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateConversationDto,
  ): Promise<ConversationResponseDto> {
    return this.conversations.create(userId, dto.title);
  }

  @Get('conversations')
  @Auth()
  @ApiOperation({ summary: 'List your conversations, most recently used first' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiResponse({ status: 200, type: ConversationListDto })
  async listConversations(
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<ConversationListDto> {
    return this.conversations.list(userId, {
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get('conversations/:id/messages')
  @Auth()
  @ApiOperation({
    summary: 'Read a thread',
    description: 'Ascending by time. `before` takes the page above a message id.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'before', required: false, type: String })
  @ApiResponse({ status: 200, type: CoachMessageListDto })
  @ApiResponse({ status: 404, description: 'No such conversation of yours' })
  async listMessages(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ): Promise<CoachMessageListDto> {
    return this.coach.listMessages(userId, id, {
      limit: limit ? Number(limit) : undefined,
      before,
    });
  }

  @Delete('conversations/:id')
  @Auth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a conversation and its messages',
    description:
      'PRD §84. Messages cascade; a proposal created from one of them does not — its ' +
      'sourceMessageId goes null and the record of the plan change stands.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  async removeConversation(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.conversations.remove(userId, id);
  }

  @Post('messages')
  @Auth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Send a message to the coach',
    description:
      'ALWAYS 201. A provider timeout, a rate limit, a missing key, a schema violation or a ' +
      'reply naming things the user does not have all produce a readable coach message plus ' +
      '`degraded: true` (PRD §120). A safety redirect answers with professional-care copy and ' +
      'never calls the model at all.',
  })
  @ApiResponse({ status: 201, type: SendCoachMessageResponseDto })
  @ApiResponse({ status: 400, description: 'attachment_not_found, or invalid body' })
  @ApiResponse({ status: 404, description: 'No such conversation of yours' })
  async sendMessage(
    @CurrentUser('id') userId: string,
    @Body() dto: SendCoachMessageDto,
  ): Promise<SendCoachMessageResponseDto> {
    return this.coach.sendMessage(userId, dto);
  }

  @Get('suggested-prompts')
  @Auth()
  @ApiOperation({
    summary: 'The chips on the Coach screen',
    description: 'PRD §66, in order. The order is the spec: they run from planning to re-deciding.',
  })
  @ApiResponse({ status: 200, type: SuggestedPromptsDto })
  suggestedPrompts(): SuggestedPromptsDto {
    return { prompts: [...SUGGESTED_PROMPTS] };
  }
}
