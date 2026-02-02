import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { ShiftsModule } from '../shifts/shifts.module';
import { BirModule } from '../bir/bir.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [ShiftsModule, BirModule, InventoryModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
