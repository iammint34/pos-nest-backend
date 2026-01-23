import {
  Controller,
  Get,
  Post,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { SalesSyncService } from './sales-sync.service';
import { ManagerOnly } from '../auth/decorators/roles.decorator';

@ApiTags('Sales Sync')
@Controller('sales-sync')
@ApiBearerAuth()
export class SalesSyncController {
  constructor(private readonly salesSyncService: SalesSyncService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get sync queue status' })
  @ApiResponse({ status: 200, description: 'Queue status' })
  async getQueueStatus() {
    return this.salesSyncService.getQueueStatus();
  }

  @Post('trigger')
  @ManagerOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually trigger sync (Manager only)' })
  @ApiResponse({ status: 200, description: 'Sync result' })
  async triggerSync() {
    return this.salesSyncService.triggerSync();
  }

  @Get('failed')
  @ApiOperation({ summary: 'Get failed sync items' })
  @ApiResponse({ status: 200, description: 'Failed items' })
  async getFailedItems() {
    return this.salesSyncService.getFailedItems();
  }

  @Post('retry/:id')
  @ManagerOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry a failed sync item (Manager only)' })
  @ApiResponse({ status: 200, description: 'Item queued for retry' })
  async retryFailedItem(@Param('id') id: string) {
    return this.salesSyncService.retryFailedItem(id);
  }
}
