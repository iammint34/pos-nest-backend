import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { PortalApiModule } from '../portal-api/portal-api.module';
import { DeviceModule } from '../device/device.module';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    PortalApiModule,
    DeviceModule,
  ],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
