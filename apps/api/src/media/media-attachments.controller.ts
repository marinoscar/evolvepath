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
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiDataResponse } from '../common/decorators/api-data-response.decorator';
import type { RequestUser } from '../auth/interfaces/authenticated-user.interface';
import { MediaAttachmentsService } from './media-attachments.service';
import {
  CreateMediaAttachmentBodyDto,
  CreateMediaAttachmentDto,
  createMediaAttachmentSchema,
} from './dto/create-media-attachment.dto';
import {
  MediaAttachmentListQueryDto,
  MediaAttachmentListResponseDto,
  mediaAttachmentListQuerySchema,
} from './dto/media-attachment-list-query.dto';
import {
  MediaAttachmentResponseDto,
  MediaPreviewQueryDto,
  MediaPreviewResponseDto,
  mediaPreviewQuerySchema,
} from './dto/media-attachment-response.dto';
import {
  AskAboutMediaBodyDto,
  AskAboutMediaDto,
  AskAboutMediaResult,
  askAboutMediaSchema,
} from './dto/media-advice.schema';

/**
 * `/media/attachments` — the product-level view of an upload (issue #83).
 *
 * Every route answers **404** for a foreign id, never 403. See
 * `MediaAttachmentsService` for why that differs from the storage API on
 * purpose.
 */
@ApiTags('Media')
@Controller('media/attachments')
@Auth()
export class MediaAttachmentsController {
  constructor(private readonly media: MediaAttachmentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Attach an upload',
    description:
      'Give an uploaded image or video a purpose and, optionally, a target. ' +
      'One attachment per upload: attaching the same object twice is a 409.',
  })
  @ApiBody({ type: CreateMediaAttachmentBodyDto })
  @ApiDataResponse(MediaAttachmentResponseDto, {
    status: 201,
    description: 'Attachment created',
  })
  @ApiResponse({
    status: 400,
    description:
      'The object is not an image or video, its processing failed, or the target is half-specified',
  })
  @ApiResponse({
    status: 404,
    description: 'The storage object does not exist or is not the caller’s',
  })
  @ApiResponse({ status: 409, description: 'This upload is already attached' })
  async create(
    @Body(new ZodValidationPipe(createMediaAttachmentSchema))
    dto: CreateMediaAttachmentDto,
    @CurrentUser('id') userId: string,
  ): Promise<{ data: MediaAttachmentResponseDto }> {
    const result = await this.media.create(dto, userId);
    return { data: result as MediaAttachmentResponseDto };
  }

  @Get()
  @ApiOperation({
    summary: 'List attachments',
    description: 'The caller’s attachments, newest first.',
  })
  @ApiQuery({ name: 'targetType', required: false, type: String })
  @ApiQuery({ name: 'targetId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'purpose', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiDataResponse(MediaAttachmentResponseDto, {
    pagination: 'nested',
    description: 'Attachments retrieved',
  })
  async list(
    @Query(new ZodValidationPipe(mediaAttachmentListQuerySchema))
    query: MediaAttachmentListQueryDto,
    @CurrentUser('id') userId: string,
  ): Promise<{ data: MediaAttachmentListResponseDto }> {
    const result = await this.media.list(query, userId);
    return { data: result };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get an attachment',
    description:
      'Includes the derived processing state, so a client never has to read ' +
      '`_processing` JSON itself.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiDataResponse(MediaAttachmentResponseDto, { description: 'Attachment' })
  @ApiResponse({ status: 404, description: 'Not found, or not the caller’s' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<{ data: MediaAttachmentResponseDto }> {
    const result = await this.media.getById(id, userId);
    return { data: result as MediaAttachmentResponseDto };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an attachment',
    description:
      'Removes the attachment, its storage object and any derived objects ' +
      '(sampled video frames, normalized AI variants).',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Not found, or not the caller’s' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    await this.media.delete(id, user);
  }

  @Post(':id/ask')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ask the coach about this media',
    description:
      '**Always 200 on the coaching path.** A provider failure, a missing key ' +
      'or output that fails the contract is `{ ok: false, error }` (PRD §120) ' +
      '— the deterministic product keeps working when the model does not. The ' +
      '4xx answers are about the MEDIA, not the model.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: AskAboutMediaBodyDto })
  @ApiResponse({
    status: 200,
    description: 'The coach’s answer, or a readable failure',
  })
  @ApiResponse({ status: 400, description: 'The media failed processing' })
  @ApiResponse({ status: 404, description: 'Not found, or not the caller’s' })
  @ApiResponse({ status: 409, description: 'The media is still processing' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async ask(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(askAboutMediaSchema)) dto: AskAboutMediaDto,
    @CurrentUser('id') userId: string,
  ): Promise<{ data: AskAboutMediaResult }> {
    const result = await this.media.ask(id, userId, dto.question);
    return { data: result };
  }

  @Get(':id/preview')
  @ApiOperation({
    summary: 'Get a signed preview URL',
    description:
      '`original` is the upload; `ai` is the normalized variant when one ' +
      'exists and the original otherwise; `frame` is one sampled frame of a ' +
      'video. The response says which variant was actually served.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiQuery({
    name: 'variant',
    required: false,
    enum: ['original', 'ai', 'frame'],
  })
  @ApiQuery({ name: 'frameIndex', required: false, type: Number })
  @ApiDataResponse(MediaPreviewResponseDto, { description: 'Signed URL' })
  @ApiResponse({
    status: 400,
    description: 'Media is not ready, or the requested frame does not exist',
  })
  @ApiResponse({ status: 404, description: 'Not found, or not the caller’s' })
  async preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(mediaPreviewQuerySchema))
    query: MediaPreviewQueryDto,
    @CurrentUser('id') userId: string,
  ): Promise<{ data: MediaPreviewResponseDto }> {
    const result = await this.media.getPreviewUrl(id, userId, query);
    return { data: result as MediaPreviewResponseDto };
  }
}
