import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ShiftsModule } from '../shifts/shifts.module';
import { BirModule } from '../bir/bir.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [ShiftsModule, BirModule, InventoryModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
