import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatus, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import {
  ProcessPaymentDto,
  SplitPaymentDto,
  RefundDto,
  CashPaymentDto,
} from './dto/payment.dto';
import { CurrentUserData } from '../auth/decorators/current-user.decorator';
import { ShiftsService } from '../shifts/shifts.service';
import { BirService } from '../bir/bir.service';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private shiftsService: ShiftsService,
    private birService: BirService,
  ) {}

  /**
   * Process single payment for order
   */
  async processPayment(orderId: string, dto: ProcessPaymentDto, user: CurrentUserData) {
    const order = await this.getOrderWithPayments(orderId);

    if (order.status !== OrderStatus.OPEN && order.status !== OrderStatus.HELD) {
      throw new BadRequestException('Can only pay for open or held orders');
    }

    const totalPaid = this.calculateTotalPaid(order.payments);
    const remaining = Number(order.grandTotal) - totalPaid;

    if (dto.amount > remaining + 0.01) {
      throw new BadRequestException(
        `Payment amount (${dto.amount}) exceeds remaining balance (${remaining})`,
      );
    }

    const tipAmount = dto.tipAmount || 0;
    const changeAmount = 0; // Only for cash payments

    const payment = await this.prisma.payment.create({
      data: {
        orderId,
        paymentMethod: dto.paymentMethod,
        status: PaymentStatus.COMPLETED,
        amount: dto.amount,
        tipAmount,
        changeAmount,
        referenceNumber: dto.referenceNumber,
        processedBy: user.userId,
      },
    });

    // Check if order is fully paid
    const newTotalPaid = totalPaid + dto.amount;
    if (newTotalPaid >= Number(order.grandTotal)) {
      await this.completeOrder(orderId);
    }

    return payment;
  }

  /**
   * Process cash payment with change calculation
   */
  async processCashPayment(orderId: string, dto: CashPaymentDto, user: CurrentUserData) {
    const order = await this.getOrderWithPayments(orderId);

    if (order.status !== OrderStatus.OPEN && order.status !== OrderStatus.HELD) {
      throw new BadRequestException('Can only pay for open or held orders');
    }

    const totalPaid = this.calculateTotalPaid(order.payments);
    const remaining = Number(order.grandTotal) - totalPaid;
    const tipAmount = dto.tipAmount || 0;
    const totalDue = remaining + tipAmount;

    if (dto.amountTendered < totalDue) {
      throw new BadRequestException(
        `Amount tendered (${dto.amountTendered}) is less than total due (${totalDue})`,
      );
    }

    const changeAmount = dto.amountTendered - totalDue;

    const payment = await this.prisma.payment.create({
      data: {
        orderId,
        paymentMethod: PaymentMethod.CASH,
        status: PaymentStatus.COMPLETED,
        amount: remaining, // Actual amount applied to order
        tipAmount,
        changeAmount,
        processedBy: user.userId,
      },
    });

    // Record cash movement for shift tracking
    // First check if order has a shiftId, if not, try to get user's current open shift
    const fullOrder = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { shiftId: true },
    });

    let shiftId = fullOrder?.shiftId;

    // If order doesn't have a shift, try to link it to user's current open shift
    if (!shiftId) {
      shiftId = await this.shiftsService.getOpenShiftId(user.userId);

      // Update the order to link it to the shift for future reference
      if (shiftId) {
        await this.prisma.order.update({
          where: { id: orderId },
          data: { shiftId, operatorId: user.userId },
        });
      }
    }

    if (shiftId) {
      await this.shiftsService.recordCashSale(
        shiftId,
        dto.amountTendered,
        changeAmount,
        tipAmount,
        orderId,
        user.userId,
      );
    }

    await this.completeOrder(orderId);

    return {
      payment,
      amountTendered: dto.amountTendered,
      changeAmount,
    };
  }

  /**
   * Process split payments (multiple payment methods)
   */
  async processSplitPayments(orderId: string, dto: SplitPaymentDto, user: CurrentUserData) {
    const order = await this.getOrderWithPayments(orderId);

    if (order.status !== OrderStatus.OPEN && order.status !== OrderStatus.HELD) {
      throw new BadRequestException('Can only pay for open or held orders');
    }

    const totalPaid = this.calculateTotalPaid(order.payments);
    const remaining = Number(order.grandTotal) - totalPaid;
    const splitTotal = dto.payments.reduce((sum, p) => sum + p.amount, 0);

    if (Math.abs(splitTotal - remaining) > 0.01) {
      throw new BadRequestException(
        `Split payments total (${splitTotal}) must equal remaining balance (${remaining})`,
      );
    }

    // Get shift ID for cash movement recording
    const fullOrder = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { shiftId: true },
    });
    let shiftId = fullOrder?.shiftId;

    // If order doesn't have a shift, try to link it to user's current open shift
    if (!shiftId) {
      shiftId = await this.shiftsService.getOpenShiftId(user.userId);
      if (shiftId) {
        await this.prisma.order.update({
          where: { id: orderId },
          data: { shiftId, operatorId: user.userId },
        });
      }
    }

    const payments = [];

    for (const paymentDto of dto.payments) {
      const payment = await this.prisma.payment.create({
        data: {
          orderId,
          paymentMethod: paymentDto.paymentMethod,
          status: PaymentStatus.COMPLETED,
          amount: paymentDto.amount,
          tipAmount: paymentDto.tipAmount || 0,
          changeAmount: 0,
          referenceNumber: paymentDto.referenceNumber,
          processedBy: user.userId,
        },
      });
      payments.push(payment);

      // Record cash movement if this is a cash payment
      if (paymentDto.paymentMethod === PaymentMethod.CASH && shiftId) {
        const tipAmount = paymentDto.tipAmount || 0;
        await this.shiftsService.recordCashSale(
          shiftId,
          paymentDto.amount + tipAmount, // Cash received (no change in split payments)
          0, // No change given in split payments
          tipAmount,
          orderId,
          user.userId,
        );
      }
    }

    await this.completeOrder(orderId);

    return payments;
  }

  /**
   * Process refund (Manager only)
   */
  async processRefund(orderId: string, dto: RefundDto, user: CurrentUserData) {
    if (user.role !== 'MANAGER') {
      throw new ForbiddenException('Only managers can process refunds');
    }

    const order = await this.getOrderWithPayments(orderId);

    if (order.status !== OrderStatus.COMPLETED) {
      throw new BadRequestException('Can only refund completed orders');
    }

    const payment = order.payments.find((p) => p.id === dto.paymentId);

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    // Calculate already refunded amount for this payment
    const refundedAmount = payment.refunds.reduce(
      (sum, r) => sum + Number(r.amount),
      0,
    );
    const availableForRefund = Number(payment.amount) - refundedAmount;

    if (dto.amount > availableForRefund) {
      throw new BadRequestException(
        `Refund amount (${dto.amount}) exceeds available amount (${availableForRefund})`,
      );
    }

    const refundMethod = dto.refundMethod || payment.paymentMethod;

    const refund = await this.prisma.refund.create({
      data: {
        paymentId: dto.paymentId,
        orderId,
        amount: dto.amount,
        reason: dto.reason,
        refundMethod,
        processedBy: user.userId,
      },
    });

    // Record cash movement if this is a cash refund
    if (refundMethod === PaymentMethod.CASH) {
      const fullOrder = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { shiftId: true },
      });

      // Use order's shiftId or fall back to user's current open shift
      const refundShiftId = fullOrder?.shiftId || await this.shiftsService.getOpenShiftId(user.userId);

      if (refundShiftId) {
        await this.shiftsService.recordCashRefund(
          refundShiftId,
          dto.amount,
          orderId,
          user.userId,
        );
      }
    }

    // Update payment status if fully refunded
    if (dto.amount >= availableForRefund) {
      await this.prisma.payment.update({
        where: { id: dto.paymentId },
        data: { status: PaymentStatus.REFUNDED },
      });
    }

    // Add to sync queue
    await this.addToSyncQueue(orderId, refund.id);

    return refund;
  }

  /**
   * Get payments for an order
   */
  async getOrderPayments(orderId: string) {
    const payments = await this.prisma.payment.findMany({
      where: { orderId },
      include: {
        refunds: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return payments;
  }

  /**
   * Get payment summary for order
   */
  async getPaymentSummary(orderId: string) {
    const order = await this.getOrderWithPayments(orderId);

    const totalPaid = this.calculateTotalPaid(order.payments);
    const totalRefunded = order.payments.reduce((sum, p) =>
      sum + p.refunds.reduce((rSum, r) => rSum + Number(r.amount), 0),
      0,
    );
    const totalTips = order.payments.reduce(
      (sum, p) => sum + Number(p.tipAmount),
      0,
    );

    return {
      orderTotal: Number(order.grandTotal),
      totalPaid,
      totalRefunded,
      totalTips,
      netPaid: totalPaid - totalRefunded,
      remaining: Math.max(0, Number(order.grandTotal) - totalPaid),
      isPaid: totalPaid >= Number(order.grandTotal),
    };
  }

  /**
   * Complete order after full payment (with BIR compliance)
   */
  private async completeOrder(orderId: string, user?: CurrentUserData) {
    // Generate BIR invoice number
    const invoiceNumber = await this.birService.getNextInvoiceNumber();

    // Get order details for journal entry
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        orderItems: {
          where: { isVoided: false },
          include: { item: { select: { name: true } } },
        },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Update order with completion status and invoice number
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.COMPLETED,
        closedAt: new Date(),
        invoiceNumber,
        syncStatus: 'PENDING',
      },
    });

    // Update non-resettable grand total accumulator
    await this.birService.updateGrandTotal(
      orderId,
      invoiceNumber,
      Number(order.grandTotal),
      'SALE',
    );

    // Get BIR config for receipt
    try {
      const birConfig = await this.birService.getDeviceBirConfig();

      // Create electronic journal entry (immutable receipt archive)
      const receiptData = {
        registeredName: birConfig.registeredName,
        registeredAddress: birConfig.registeredAddress,
        vatTin: birConfig.vatTin,
        min: birConfig.min,
        ptuNo: birConfig.ptuNo,
        ptuDateIssued: birConfig.ptuDateIssued,
        ptuValidUntil: birConfig.ptuValidUntil,
        invoiceNumber,
        transactionDate: new Date(),
        cashierName: `${order.user.firstName} ${order.user.lastName}`,
        items: order.orderItems.map((item) => ({
          name: item.itemName,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          totalPrice: Number(item.totalPrice),
        })),
        subtotal: Number(order.subtotal),
        discountTotal: Number(order.discountTotal),
        grandTotal: Number(order.grandTotal),
        vatableSales: Number(order.vatableSales),
        vatAmount: Number(order.vatAmount),
        vatExemptSales: Number(order.vatExemptSales),
        zeroRatedSales: Number(order.zeroRatedSales),
        customerTin: order.customerTin || undefined,
        customerBusinessName: order.customerBusinessName || undefined,
        customerBusinessAddress: order.customerBusinessAddress || undefined,
        isVatRegistered: birConfig.isVatRegistered,
      };

      await this.birService.createJournalEntry(
        orderId,
        invoiceNumber,
        'SALE',
        receiptData,
        order.user.id,
        `${order.user.firstName} ${order.user.lastName}`,
      );
    } catch (error) {
      console.error('Failed to create journal entry:', error);
      // Continue even if journal entry fails - order is still completed
    }

    // Add to sync queue
    await this.prisma.syncQueue.create({
      data: {
        operation: 'CREATE_ORDER',
        entityType: 'Order',
        entityId: orderId,
        payload: JSON.stringify({ orderId }),
        status: 'PENDING',
      },
    });
  }

  /**
   * Get order with payments
   */
  private async getOrderWithPayments(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        payments: {
          include: { refunds: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  /**
   * Calculate total paid amount
   */
  private calculateTotalPaid(payments: { amount: Prisma.Decimal; status: PaymentStatus }[]) {
    return payments
      .filter((p) => p.status === PaymentStatus.COMPLETED)
      .reduce((sum, p) => sum + Number(p.amount), 0);
  }

  /**
   * Add refund to sync queue
   */
  private async addToSyncQueue(orderId: string, refundId: string) {
    await this.prisma.syncQueue.create({
      data: {
        operation: 'REFUND',
        entityType: 'Refund',
        entityId: refundId,
        payload: JSON.stringify({ orderId, refundId }),
        status: 'PENDING',
      },
    });
  }
}
