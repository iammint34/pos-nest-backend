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

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

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

    const refund = await this.prisma.refund.create({
      data: {
        paymentId: dto.paymentId,
        orderId,
        amount: dto.amount,
        reason: dto.reason,
        refundMethod: dto.refundMethod || payment.paymentMethod,
        processedBy: user.userId,
      },
    });

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
   * Complete order after full payment
   */
  private async completeOrder(orderId: string) {
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.COMPLETED,
        closedAt: new Date(),
        syncStatus: 'PENDING',
      },
    });

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
