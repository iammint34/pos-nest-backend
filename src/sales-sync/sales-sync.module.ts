import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SalesSyncController } from './sales-sync.controller';
import { SalesSyncService } from './sales-sync.service';
import { PortalApiModule } from '../portal-api/portal-api.module';
import { DeviceModule } from '../device/device.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [ScheduleModule.forRoot(), PortalApiModule, DeviceModule, InventoryModule],
  controllers: [SalesSyncController],
  providers: [SalesSyncService],
  exports: [SalesSyncService],
})
export class SalesSyncModule {}
