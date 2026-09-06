import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import {
  ExtendFocusSessionDto,
  FocusSessionNoteDto,
  FocusSessionQueryDto,
  StartFocusSessionDto,
  StopFocusSessionDto,
} from './dto/focus-session.dtos';
import {
  FocusSessionService,
  type FocusSessionView,
  type StopFocusSessionResult,
} from './focus-session.service';

// =============================================================================
// `/focus-sessions*` (issue #110, epic E07)
// =============================================================================
//
// Six routes over one row. Every one of them loads by `{ id, userId }` and
// answers 404 — never 403 — for somebody else's session.
// =============================================================================

@ApiTags('Work')
@Controller('focus-sessions')
export class FocusSessionController {
  constructor(private readonly sessions: FocusSessionService) {}

  @Post()
  @Auth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Begin a focus session on a work commitment',
    description:
      "Moves the commitment to STARTED through E05's `start` action — the timer columns and " +
      'the `APP_FLOW started` evidence come from there, so starting is recorded exactly once ' +
      'and separately from completing (PRD §104).',
  })
  @ApiResponse({ status: 201, description: 'The session, with the commitment timer' })
  @ApiResponse({ status: 400, description: '`COMMITMENT_NOT_WORK` or `COMMITMENT_NOT_STARTABLE`' })
  @ApiResponse({
    status: 409,
    description:
      '`FOCUS_SESSION_ACTIVE` with `details.activeSessionId`. Send `takeOver: true` to end it ' +
      'as ABANDONED and start this one.',
  })
  async start(
    @CurrentUser('id') userId: string,
    @Body() dto: StartFocusSessionDto,
  ): Promise<FocusSessionView> {
    return this.sessions.start(userId, dto);
  }

  @Get('active')
  @Auth()
  @ApiOperation({
    summary: 'The running session, if there is one',
    description:
      'How a crashed or reloaded client recovers. `serverNow` lets a skewed phone re-anchor ' +
      'the countdown against the server rather than its own clock.',
  })
  @ApiResponse({ status: 200, description: '`{ session, serverNow }`; `session` may be null' })
  async active(
    @CurrentUser('id') userId: string,
  ): Promise<{ session: FocusSessionView | null; serverNow: string }> {
    return this.sessions.getActive(userId);
  }

  @Get()
  @Auth()
  @ApiOperation({ summary: "The caller's focus sessions, newest first" })
  @ApiResponse({ status: 200, description: 'At most 100 sessions' })
  @ApiResponse({ status: 400, description: '`RANGE_TOO_LARGE` — the window exceeds 93 days' })
  async list(
    @CurrentUser('id') userId: string,
    @Query() query: FocusSessionQueryDto,
  ): Promise<{ sessions: FocusSessionView[] }> {
    return this.sessions.list(userId, query);
  }

  @Post(':id/extend')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '"Continue another 15?"',
    description:
      "Raises `plannedMinutes` and `continuedCount`, and grows the commitment's `timerMinutes` " +
      "through E05's `continue` action — the same call the Start screen's 00:00 prompt makes.",
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The extended session' })
  @ApiResponse({ status: 409, description: '`FOCUS_SESSION_ENDED`' })
  async extend(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExtendFocusSessionDto,
  ): Promise<FocusSessionView> {
    return this.sessions.extend(userId, id, dto);
  }

  @Post(':id/note')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record a distraction, the moment it happens',
    description:
      'Persisted server-side rather than held in the page: the user types these while ' +
      'distracted, which is exactly when a tab gets reloaded.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The session with the note appended' })
  @ApiResponse({ status: 400, description: '`TOO_MANY_NOTES` — 20 is the cap' })
  @ApiResponse({ status: 409, description: '`FOCUS_SESSION_ENDED`' })
  async note(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FocusSessionNoteDto,
  ): Promise<FocusSessionView> {
    return this.sessions.addNote(userId, id, dto.text);
  }

  @Post(':id/stop')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'End the session and write its TIMER evidence',
    description:
      "`done` completes the commitment, `partial` partially completes it, and `abandoned` " +
      'PAUSES it — the commitment stays open so Today keeps offering it, and the evidence row ' +
      'is written either way (VISION §10).',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: '`{ session, evidenceId, commitmentStatus, actualMinutes }`' })
  @ApiResponse({ status: 409, description: '`FOCUS_SESSION_ENDED`' })
  async stop(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StopFocusSessionDto,
  ): Promise<StopFocusSessionResult> {
    return this.sessions.stop(userId, id, dto);
  }
}
