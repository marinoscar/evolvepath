// =============================================================================
// Push subscriptions, and the one public route in this epic (issue #64)
// =============================================================================

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import {
  CreatePushSubscriptionDto,
  DeletePushSubscriptionDto,
  PushPublicKeyDto,
  PushSubscriptionListDto,
  type PushSubscriptionSummary,
} from './dto/push-subscription.dto';
import { PushSubscriptionsService } from './push-subscriptions.service';
import { WebPushProvider } from './web-push.provider';

@ApiTags('Notifications')
@Controller('notifications')
export class PushSubscriptionsController {
  constructor(
    private readonly subscriptions: PushSubscriptionsService,
    private readonly webPush: WebPushProvider,
  ) {}

  @Get('push/public-key')
  @Auth()
  @ApiOperation({
    summary: 'The VAPID public key a browser needs to subscribe',
    description:
      '`null` when this deployment has no `WEB_PUSH_*` configuration, which is a valid ' +
      'state: the push channel is simply inactive and users still get the inbox row and ' +
      'the live update. Only the PUBLIC half is ever returned.',
  })
  @ApiResponse({ status: 200, type: PushPublicKeyDto })
  getPublicKey(): { publicKey: string | null } {
    return { publicKey: this.webPush.getPublicKey() };
  }

  @Get('push-subscriptions')
  @Auth()
  @ApiOperation({
    summary: 'The devices this user has subscribed',
    description:
      'Carries the endpoint HOST, never the endpoint and never the keys: a full endpoint ' +
      'is a bearer capability for that device. The host is enough for a human to recognise ' +
      'their own browser and useless to anybody else.',
  })
  @ApiResponse({ status: 200, type: PushSubscriptionListDto })
  async list(
    @CurrentUser('id') userId: string,
  ): Promise<{ items: PushSubscriptionSummary[] }> {
    return { items: await this.subscriptions.list(userId) };
  }

  @Post('push-subscriptions')
  @Auth()
  @ApiOperation({
    summary: 'Register this browser for push',
    description:
      'Upsert on the endpoint. An endpoint already held by another account is RE-OWNED by ' +
      'the caller — one browser profile signed in as somebody else is a real case, and the ' +
      'account that most recently proved it controls the browser is the one whose coaching ' +
      'should reach it.',
  })
  @ApiResponse({ status: 201, description: 'The subscription id' })
  async create(
    @CurrentUser('id') userId: string,
    @Body() body: CreatePushSubscriptionDto,
  ): Promise<{ id: string }> {
    return this.subscriptions.upsert(userId, body);
  }

  @Delete('push-subscriptions')
  @Auth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Stop pushing to this browser',
    description: 'Idempotent, and scoped to the caller’s own rows.',
  })
  @ApiResponse({ status: 204, description: 'Gone, or was never there' })
  async remove(
    @CurrentUser('id') userId: string,
    @Body() body: DeletePushSubscriptionDto,
  ): Promise<void> {
    await this.subscriptions.remove(userId, body.endpoint);
  }

}
