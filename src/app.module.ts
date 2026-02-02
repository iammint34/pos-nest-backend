import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { DeviceModule } from './device/device.module';
import { PortalApiModule } from './portal-api/portal-api.module';
import { SyncModule } from './sync/sync.module';
import { CategoriesModule } from './categories/categories.module';
import { ItemsModule } from './items/items.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { SalesSyncModule } from './sales-sync/sales-sync.module';
import { ShiftsModule } from './shifts/shifts.module';
import { BirModule } from './bir/bir.module';
import { ReportsModule } from './reports/reports.module';
import { InventoryModule } from './inventory/inventory.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    DeviceModule,
    PortalApiModule,
    SyncModule,
    CategoriesModule,
    ItemsModule,
    OrdersModule,
    PaymentsModule,
    SalesSyncModule,
    ShiftsModule,
    BirModule,
    ReportsModule,
    InventoryModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
