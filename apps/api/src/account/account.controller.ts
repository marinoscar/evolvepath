import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/interfaces/authenticated-user.interface';
import { AccountResetService } from './account-reset.service';
import { AccountDataSummaryDto } from './dto/account-data-summary.dto';
import { AccountResetResultDto } from './dto/account-reset-result.dto';
import { ResetAccountDto } from './dto/reset-account.dto';

// =============================================================================
// AccountController — the "Danger zone" (epic #220)
// =============================================================================
//
// Two operations over the caller's OWN data:
//
//   GET  /api/account/data-summary   what a reset would take, and the phrase
//   POST /api/account/reset          take it
//
// -----------------------------------------------------------------------------
// NO ROUTE ACCEPTS A USER ID — THAT IS THE SECURITY DESIGN
// -----------------------------------------------------------------------------
//
// Every handler resolves the account from `@CurrentUser()` and from NOWHERE
// else. There is no path parameter, no query parameter and no body field naming
// a user, which is the same structural discipline `UserAiKeyController` states
// for the caller's own key, applied here to the caller's own data.
//
// The consequence worth stating outright: an administrator cannot reset another
// user's data through this controller either, and that is enforced
// STRUCTURALLY rather than by a check. There is no permission to relax, because
// there is no parameter naming a target for a relaxed check to admit. Widening
// this into a "reset any user's data" admin action would be a signature change
// with a visible diff at every call site it touched — not a query-string edit
// that slips through review.
//
// `@Auth()` carries NO permissions, for the same reason every other
// caller-scoped module in this API is gated the same way: erasing your own data
// is not a privilege, it is what owning the account already means. Gating it
// with an invented permission string would leave Viewer — the default role in
// this product — unable to make a choice that is structurally theirs alone.
//
// Its own module rather than a route on `SettingsModule` or `UsersModule`:
// `UsersController` is the admin surface, gated on `users:*` and addressing
// other people by id on every route. Putting an `@Auth()`-with-no-permissions,
// self-service-only, irreversible route beside a dozen `users:*`-gated ones
// would make the gate a per-decorator question instead of a per-file one.
// =============================================================================

@ApiTags('Account')
@Controller('account')
export class AccountController {
  constructor(private readonly accountReset: AccountResetService) {}

  @Get('data-summary')
  @Auth()
  @ApiOperation({
    summary: 'Preview what a data reset would erase',
    description:
      'Row counts, per table, for everything `POST /api/account/reset` would ' +
      'erase for **you** — plus the exact confirmation phrase each scope ' +
      'requires. Read-only: this runs `count`, never `delete`, and calling it ' +
      'any number of times changes nothing.\n\n' +
      'This is what the Danger zone screen renders before a caller commits to ' +
      'anything, so the confirmation can say something concrete — "42 ' +
      'commitments, 3 outcomes, 2 photos" — instead of an abstract warning.\n\n' +
      'Tables that cascade from one already listed (`coach_messages` from ' +
      '`coach_conversations`, `set_logs` from `workout_sessions`, ' +
      '`storage_object_chunks` from `storage_objects`) are deliberately not ' +
      'counted separately: they would double-count the same deletions.',
  })
  @ApiResponse({
    status: 200,
    description: 'Per-table row counts for your own data, and the two phrases.',
    type: AccountDataSummaryDto,
  })
  async getDataSummary(@CurrentUser() user: RequestUser) {
    return this.accountReset.summarize(user.id);
  }

  @Post('reset')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Erase your own data — irreversible',
    description:
      'Erases what this application holds about **you**: your Best Self ' +
      'profile, outcomes, plans, routines, commitments, evidence, ' +
      'reflections, focus and workout sessions, coach conversations and ' +
      'memory, weekly reviews and plans, family members and rituals, ' +
      'milestones, notifications, personal access tokens, device sessions, ' +
      'your profile and settings, and any files you uploaded. ' +
      '**This cannot be undone.**\n\n' +
      '`scope` picks how much: `data` keeps your stored OpenAI key; ' +
      '`data_and_key` erases that too, so you set the application up again ' +
      'from the beginning. Your key at OpenAI itself is not affected either ' +
      'way.\n\n' +
      'Your account is untouched by both — your sign-in, your roles, your ' +
      'email address and the devices you are signed in on all survive. This ' +
      'is a data reset, not an account deletion.\n\n' +
      '`confirmationPhrase` must match the scope\'s exact phrase from ' +
      '`GET /api/account/data-summary` (`DELETE MY DATA` for `data`, ' +
      '`DELETE EVERYTHING` for `data_and_key`), **verified here on the ' +
      'server** — a disabled button on a client is not the control, this ' +
      'check is. Nothing is deleted on a mismatch.\n\n' +
      'You will receive an email confirming what was erased. That ' +
      'notification cannot be turned off.',
  })
  @ApiResponse({
    status: 200,
    description: 'What was actually deleted, and whether your key was removed.',
    type: AccountResetResultDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'The confirmation phrase did not match the selected scope. Nothing was deleted.',
  })
  async reset(
    @CurrentUser() user: RequestUser,
    @Body() dto: ResetAccountDto,
  ) {
    return this.accountReset.reset(user, dto.scope, dto.confirmationPhrase);
  }
}
