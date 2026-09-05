import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FamilyMembersService } from './family-members.service';
import {
  CreateFamilyMemberDto,
  FamilyMemberResponseDto,
  UpdateFamilyMemberDto,
} from './dto/family-member.dto';

@ApiTags('Family')
@Controller('family/members')
export class FamilyMembersController {
  constructor(private readonly members: FamilyMembersService) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: 'List the people you share rituals with',
    description:
      'Exactly `id`, `nickname`, `relationship`, `birthday` and `createdAt`. There is nothing ' +
      'else to return: PRD §33 fixes the record, and VISION §50 explains why — the people in ' +
      'it never consented to being modeled.',
  })
  @ApiResponse({ status: 200, type: [FamilyMemberResponseDto] })
  async list(@CurrentUser('id') userId: string): Promise<FamilyMemberResponseDto[]> {
    return this.members.list(userId);
  }

  @Post()
  @Auth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add a family member',
    description:
      'The birthday is a calendar date. Send `1900` as the year when it is unknown; the year is ' +
      'never read or displayed.',
  })
  @ApiResponse({ status: 201, type: FamilyMemberResponseDto })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateFamilyMemberDto,
  ): Promise<FamilyMemberResponseDto> {
    return this.members.create(userId, dto);
  }

  @Patch(':id')
  @Auth()
  @ApiOperation({ summary: 'Update a family member' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: FamilyMemberResponseDto })
  @ApiResponse({ status: 404, description: 'No such member, or not yours' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFamilyMemberDto,
  ): Promise<FamilyMemberResponseDto> {
    return this.members.update(userId, id, dto);
  }

  @Delete(':id')
  @Auth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a family member',
    description:
      'Rituals and past commitments keep their history — the foreign keys are set to null, not ' +
      'cascaded. Only the name goes.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Removed' })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.members.remove(userId, id);
  }
}
