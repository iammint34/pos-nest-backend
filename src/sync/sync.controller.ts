import {
  Controller,
  Get,
  Post,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SyncService, SyncStatus, SyncResult } from './sync.service';
import { ManagerOnly } from '../auth/decorators/roles.decorator';

@ApiTags('Sync')
@Controller('sync')
@ApiBearerAuth()
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get current sync status' })
  @ApiResponse({ status: 200, description: 'Sync status' })
  async getSyncStatus(): Promise<SyncStatus> {
    return this.syncService.getSyncStatus();
  }

  @Post('trigger')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually trigger sync from Portal' })
  @ApiResponse({ status: 200, description: 'Sync result' })
  @ApiResponse({ status: 400, description: 'Sync already in progress' })
  async triggerSync(): Promise<SyncResult> {
    return this.syncService.triggerSync();
  }

  @Get('history')
  @ApiOperation({ summary: 'Get sync history' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Sync history' })
  async getSyncHistory(@Query('limit') limit?: number) {
    return this.syncService.getSyncHistory(limit || 20);
  }
}
