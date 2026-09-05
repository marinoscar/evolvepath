// =============================================================================
// GET / PATCH /api/me/notification-policy (issue #49, epic E12)
// =============================================================================
//
// An own-resource surface with no user id in the path, exactly like
// `/api/me/ai-key`: `@Auth()` and nothing more. There is no permission to
// invent here — a user configuring how often their own coach may interrupt them
// is not an administrative act, and a `notification_policy:*` permission would
// have to be granted to every role to be useful, which is the definition of a
// permission that carries no information.

import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import {
  NotificationPolicyResponseDto,
  PatchNotificationPolicyDto,
  type NotificationPolicyResponse,
} from './dto/notification-policy.dto';
import { NotificationPolicyService } from './notification-policy.service';

@ApiTags('Coaching Notifications')
@Controller('me/notification-policy')
export class NotificationPolicyController {
  constructor(private readonly policy: NotificationPolicyService) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: 'The calling user\'s coaching notification policy',
    description:
      'Quiet hours, the three caps and any muted categories, plus whether the automatic ' +
      'reduction of PRD §61 is currently in force. Never 404: a user who has never opened ' +
      'the settings page gets the defaults, and the profile row is created lazily.',
  })
  @ApiResponse({ status: 200, type: NotificationPolicyResponseDto })
  async get(@CurrentUser('id') userId: string): Promise<NotificationPolicyResponse> {
    return this.policy.get(userId);
  }

  @Patch()
  @Auth()
  @ApiOperation({
    summary: 'Change part of the coaching notification policy',
    description:
      'A merge patch: an absent field is left alone. `quietHours: null` is the explicit ' +
      'clear — the two columns always move together, because a window with one bound has ' +
      'no meaning. Values outside their ranges are 400 with the field named.',
  })
  @ApiResponse({ status: 200, type: NotificationPolicyResponseDto })
  async patch(
    @CurrentUser('id') userId: string,
    @Body() body: PatchNotificationPolicyDto,
  ): Promise<NotificationPolicyResponse> {
    return this.policy.patch(userId, body);
  }
}
