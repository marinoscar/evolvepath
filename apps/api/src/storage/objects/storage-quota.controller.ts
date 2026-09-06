import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiDataResponse } from '../../common/decorators/api-data-response.decorator';
import { StorageQuotaResponseDto } from './dto/storage-quota-response.dto';
import { StorageQuotaService } from './storage-quota.service';

/**
 * `GET /api/storage/quota` (issue #87).
 *
 * Its own controller rather than a route on `ObjectsController`, because that
 * one is mounted at `storage/objects` and this endpoint is about the caller,
 * not about an object. Nesting it there would have made the path
 * `/storage/objects/quota` — a route the picker's "you have used all of your
 * storage" message would read as being about one object.
 */
@ApiTags('Storage')
@Controller('storage')
@Auth()
export class StorageQuotaController {
  constructor(private readonly quota: StorageQuotaService) {}

  @Get('quota')
  @ApiOperation({
    summary: 'Get storage quota',
    description:
      'Bytes used, the per-user ceiling, and what is left. All three are ' +
      'strings — `storage_objects.size` is a BigInt. `quotaBytes` and ' +
      '`remainingBytes` are null when STORAGE_USER_QUOTA_BYTES is 0, so a ' +
      'client renders "unlimited" rather than a meaningless bar.',
  })
  @ApiDataResponse(StorageQuotaResponseDto, { description: 'Quota' })
  async getQuota(
    @CurrentUser('id') userId: string,
  ): Promise<{ data: StorageQuotaResponseDto }> {
    const result = await this.quota.describe(userId);
    return { data: result as StorageQuotaResponseDto };
  }
}
