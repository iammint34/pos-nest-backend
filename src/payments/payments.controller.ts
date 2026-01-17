import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import {
  ProcessPaymentDto,
  SplitPaymentDto,
  RefundDto,
  CashPaymentDto,
} from './dto/payment.dto';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';
import { ManagerOnly } from '../auth/decorators/roles.decorator';

@ApiTags('Payments')
@Controller('orders/:orderId/payments')
@ApiBearerAuth()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all payments for an order' })
  @ApiResponse({ status: 200, description: 'List of payments' })
  async getOrderPayments(@Param('orderId') orderId: string) {
    return this.paymentsService.getOrderPayments(orderId);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get payment summary for an order' })
  @ApiResponse({ status: 200, description: 'Payment summary' })
  async getPaymentSummary(@Param('orderId') orderId: string) {
    return this.paymentsService.getPaymentSummary(orderId);
  }

  @Post()
  @ApiOperation({ summary: 'Process a payment' })
  @ApiResponse({ status: 201, description: 'Payment processed' })
  async processPayment(
    @Param('orderId') orderId: string,
    @Body() dto: ProcessPaymentDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.paymentsService.processPayment(orderId, dto, user);
  }

  @Post('cash')
  @ApiOperation({ summary: 'Process cash payment with change calculation' })
  @ApiResponse({ status: 201, description: 'Cash payment processed' })
  async processCashPayment(
    @Param('orderId') orderId: string,
    @Body() dto: CashPaymentDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.paymentsService.processCashPayment(orderId, dto, user);
  }

  @Post('split')
  @ApiOperation({ summary: 'Process split payments' })
  @ApiResponse({ status: 201, description: 'Split payments processed' })
  async processSplitPayments(
    @Param('orderId') orderId: string,
    @Body() dto: SplitPaymentDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.paymentsService.processSplitPayments(orderId, dto, user);
  }

  @Post('refund')
  @ManagerOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Process a refund (Manager only)' })
  @ApiResponse({ status: 200, description: 'Refund processed' })
  async processRefund(
    @Param('orderId') orderId: string,
    @Body() dto: RefundDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.paymentsService.processRefund(orderId, dto, user);
  }
}
