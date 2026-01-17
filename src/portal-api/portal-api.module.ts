import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PortalApiService } from './portal-api.service';

@Module({
  imports: [ConfigModule],
  providers: [PortalApiService],
  exports: [PortalApiService],
})
export class PortalApiModule {}
