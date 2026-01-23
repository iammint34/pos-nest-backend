import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import {
  DateRangeDto,
  ReportQueryDto,
  SalesSummaryDto,
  XReadingDto,
  SalesByCategoryDto,
  SalesByItemDto,
  SalesByPaymentMethodDto,
  SalesByHourDto,
  TransactionDto,
  VoidedTransactionDto,
  DiscountReportDto,
  RefundReportDto,
  ShiftReportDto,
} from './dto/report.dto';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get date range for queries
   */
  private getDateRange(dto: DateRangeDto): { start: Date; end: Date } {
    const now = new Date();
    let start: Date;
    let end: Date;

    if (dto.startDate) {
      start = new Date(dto.startDate);
      start.setHours(0, 0, 0, 0);
    } else {
      // Default to today
      start = new Date(now);
      start.setHours(0, 0, 0, 0);
    }

    if (dto.endDate) {
      end = new Date(dto.endDate);
      end.setHours(23, 59, 59, 999);
    } else {
      // Default to end of today
      end = new Date(now);
      end.setHours(23, 59, 59, 999);
    }

    return { start, end };
  }

  /**
   * Generate X-Reading (current day summary without reset)
   */
  async getXReading(userId?: string): Promise<XReadingDto> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    // Get all orders for today
    const orders = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: today, lte: endOfDay },
      },
      include: {
        payments: true,
        orderItems: { where: { isVoided: false } },
        user: { select: { firstName: true, lastName: true } },
      },
    });

    const completedOrders = orders.filter(o => o.status === OrderStatus.COMPLETED);
    const voidedOrders = orders.filter(o => o.status === OrderStatus.VOIDED);

    // Calculate totals
    const grossSales = completedOrders.reduce((sum, o) => sum + Number(o.subtotal), 0);
    const totalDiscounts = completedOrders.reduce((sum, o) => sum + Number(o.discountTotal), 0);
    const netSales = completedOrders.reduce((sum, o) => sum + Number(o.grandTotal), 0);
    const totalTax = completedOrders.reduce((sum, o) => sum + Number(o.taxTotal), 0);

    // VAT breakdown
    const vatableSales = completedOrders.reduce((sum, o) => sum + Number(o.vatableSales || 0), 0);
    const vatAmount = completedOrders.reduce((sum, o) => sum + Number(o.vatAmount || 0), 0);
    const vatExemptSales = completedOrders.reduce((sum, o) => sum + Number(o.vatExemptSales || 0), 0);
    const zeroRatedSales = completedOrders.reduce((sum, o) => sum + Number(o.zeroRatedSales || 0), 0);

    // Payment breakdown
    const allPayments = completedOrders.flatMap(o => o.payments).filter(p => p.status === PaymentStatus.COMPLETED);
    const cashSales = allPayments
      .filter(p => p.paymentMethod === PaymentMethod.CASH)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const cardSales = allPayments
      .filter(p => p.paymentMethod === PaymentMethod.CREDIT_CARD || p.paymentMethod === PaymentMethod.DEBIT_CARD)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const otherSales = allPayments
      .filter(p => p.paymentMethod !== PaymentMethod.CASH && p.paymentMethod !== PaymentMethod.CREDIT_CARD && p.paymentMethod !== PaymentMethod.DEBIT_CARD)
      .reduce((sum, p) => sum + Number(p.amount), 0);

    // Refunds
    const refunds = await this.prisma.refund.findMany({
      where: {
        processedAt: { gte: today, lte: endOfDay },
      },
    });
    const totalRefunds = refunds.reduce((sum, r) => sum + Number(r.amount), 0);

    // Get shift info if user has one
    let shiftInfo: { id?: string; openingCash?: number; expectedCash?: number } = {};
    if (userId) {
      const shift = await this.prisma.shift.findFirst({
        where: {
          operatorId: userId,
          openedAt: { gte: today },
        },
        orderBy: { openedAt: 'desc' },
      });
      if (shift) {
        shiftInfo = {
          id: shift.id,
          openingCash: Number(shift.openingCash),
        };
        // Calculate expected cash
        const movements = await this.prisma.cashMovement.findMany({
          where: { shiftId: shift.id },
        });
        let expectedCash = Number(shift.openingCash);
        for (const m of movements) {
          expectedCash += Number(m.amount);
        }
        shiftInfo.expectedCash = expectedCash;
      }
    }

    // Get first and last transaction
    const firstOrder = completedOrders.length > 0
      ? completedOrders.reduce((min, o) => new Date(o.createdAt) < new Date(min.createdAt) ? o : min)
      : null;
    const lastOrder = completedOrders.length > 0
      ? completedOrders.reduce((max, o) => new Date(o.createdAt) > new Date(max.createdAt) ? o : max)
      : null;

    // Get cashier name
    const user = userId ? await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    }) : null;

    return {
      totalOrders: orders.length,
      completedOrders: completedOrders.length,
      voidedOrders: voidedOrders.length,
      grossSales,
      totalDiscounts,
      totalRefunds,
      netSales,
      totalTax,
      vatableSales,
      vatAmount,
      vatExemptSales,
      zeroRatedSales,
      cashSales,
      cardSales,
      otherSales,
      averageOrderValue: completedOrders.length > 0 ? netSales / completedOrders.length : 0,
      periodStart: today.toISOString(),
      periodEnd: endOfDay.toISOString(),
      generatedAt: new Date().toISOString(),
      cashierName: user ? `${user.firstName} ${user.lastName}` : undefined,
      shiftId: shiftInfo.id,
      openingCash: shiftInfo.openingCash,
      expectedCash: shiftInfo.expectedCash,
      firstTransaction: firstOrder?.invoiceNumber || firstOrder?.orderNumber,
      lastTransaction: lastOrder?.invoiceNumber || lastOrder?.orderNumber,
      transactionCount: completedOrders.length,
    };
  }

  /**
   * Get daily sales summary
   */
  async getDailySales(dto: DateRangeDto): Promise<SalesSummaryDto> {
    const { start, end } = this.getDateRange(dto);

    const orders = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: start, lte: end },
      },
      include: {
        payments: true,
      },
    });

    const completedOrders = orders.filter(o => o.status === OrderStatus.COMPLETED);
    const voidedOrders = orders.filter(o => o.status === OrderStatus.VOIDED);

    const grossSales = completedOrders.reduce((sum, o) => sum + Number(o.subtotal), 0);
    const totalDiscounts = completedOrders.reduce((sum, o) => sum + Number(o.discountTotal), 0);
    const netSales = completedOrders.reduce((sum, o) => sum + Number(o.grandTotal), 0);
    const totalTax = completedOrders.reduce((sum, o) => sum + Number(o.taxTotal), 0);

    const vatableSales = completedOrders.reduce((sum, o) => sum + Number(o.vatableSales || 0), 0);
    const vatAmount = completedOrders.reduce((sum, o) => sum + Number(o.vatAmount || 0), 0);
    const vatExemptSales = completedOrders.reduce((sum, o) => sum + Number(o.vatExemptSales || 0), 0);
    const zeroRatedSales = completedOrders.reduce((sum, o) => sum + Number(o.zeroRatedSales || 0), 0);

    const allPayments = completedOrders.flatMap(o => o.payments).filter(p => p.status === PaymentStatus.COMPLETED);
    const cashSales = allPayments
      .filter(p => p.paymentMethod === PaymentMethod.CASH)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const cardSales = allPayments
      .filter(p => p.paymentMethod === PaymentMethod.CREDIT_CARD || p.paymentMethod === PaymentMethod.DEBIT_CARD)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const otherSales = allPayments
      .filter(p => p.paymentMethod !== PaymentMethod.CASH && p.paymentMethod !== PaymentMethod.CREDIT_CARD && p.paymentMethod !== PaymentMethod.DEBIT_CARD)
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const refunds = await this.prisma.refund.findMany({
      where: {
        processedAt: { gte: start, lte: end },
      },
    });
    const totalRefunds = refunds.reduce((sum, r) => sum + Number(r.amount), 0);

    return {
      totalOrders: orders.length,
      completedOrders: completedOrders.length,
      voidedOrders: voidedOrders.length,
      grossSales,
      totalDiscounts,
      totalRefunds,
      netSales,
      totalTax,
      vatableSales,
      vatAmount,
      vatExemptSales,
      zeroRatedSales,
      cashSales,
      cardSales,
      otherSales,
      averageOrderValue: completedOrders.length > 0 ? netSales / completedOrders.length : 0,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
    };
  }

  /**
   * Get sales by category
   */
  async getSalesByCategory(dto: DateRangeDto): Promise<SalesByCategoryDto[]> {
    const { start, end } = this.getDateRange(dto);

    const orderItems = await this.prisma.orderItem.findMany({
      where: {
        isVoided: false,
        order: {
          status: OrderStatus.COMPLETED,
          createdAt: { gte: start, lte: end },
        },
      },
      include: {
        item: {
          include: {
            category: true,
          },
        },
      },
    });

    // Group by category
    const categoryMap = new Map<string, {
      categoryId: string;
      categoryName: string;
      items: Set<string>;
      quantity: number;
      gross: number;
      discounts: number;
      net: number;
    }>();

    for (const oi of orderItems) {
      const categoryId = oi.item?.category?.id || 'uncategorized';
      const categoryName = oi.item?.category?.name || 'Uncategorized';

      if (!categoryMap.has(categoryId)) {
        categoryMap.set(categoryId, {
          categoryId,
          categoryName,
          items: new Set(),
          quantity: 0,
          gross: 0,
          discounts: 0,
          net: 0,
        });
      }

      const cat = categoryMap.get(categoryId)!;
      if (oi.itemId) cat.items.add(oi.itemId);
      cat.quantity += oi.quantity;
      cat.gross += Number(oi.unitPrice) * oi.quantity;
      cat.discounts += Number(oi.discountAmount);
      cat.net += Number(oi.totalPrice);
    }

    const totalNet = Array.from(categoryMap.values()).reduce((sum, c) => sum + c.net, 0);

    return Array.from(categoryMap.values())
      .map(c => ({
        categoryId: c.categoryId,
        categoryName: c.categoryName,
        itemCount: c.items.size,
        quantitySold: c.quantity,
        grossSales: c.gross,
        discounts: c.discounts,
        netSales: c.net,
        percentage: totalNet > 0 ? (c.net / totalNet) * 100 : 0,
      }))
      .sort((a, b) => b.netSales - a.netSales);
  }

  /**
   * Get sales by item
   */
  async getSalesByItem(dto: ReportQueryDto): Promise<{ data: SalesByItemDto[]; meta: any }> {
    const { start, end } = this.getDateRange(dto);
    const page = dto.page || 1;
    const limit = dto.limit || 50;

    const orderItems = await this.prisma.orderItem.findMany({
      where: {
        isVoided: false,
        order: {
          status: OrderStatus.COMPLETED,
          createdAt: { gte: start, lte: end },
        },
      },
      include: {
        item: {
          include: {
            category: true,
          },
        },
      },
    });

    // Group by item
    const itemMap = new Map<string, {
      itemId: string;
      itemName: string;
      itemSku?: string;
      categoryName?: string;
      quantity: number;
      gross: number;
      discounts: number;
      net: number;
    }>();

    for (const oi of orderItems) {
      const itemId = oi.itemId || oi.id;
      const itemName = oi.itemName;

      if (!itemMap.has(itemId)) {
        itemMap.set(itemId, {
          itemId,
          itemName,
          itemSku: oi.item?.sku || oi.itemSku,
          categoryName: oi.item?.category?.name,
          quantity: 0,
          gross: 0,
          discounts: 0,
          net: 0,
        });
      }

      const item = itemMap.get(itemId)!;
      item.quantity += oi.quantity;
      item.gross += Number(oi.unitPrice) * oi.quantity;
      item.discounts += Number(oi.discountAmount);
      item.net += Number(oi.totalPrice);
    }

    const allItems = Array.from(itemMap.values())
      .map(i => ({
        itemId: i.itemId,
        itemName: i.itemName,
        itemSku: i.itemSku,
        categoryName: i.categoryName,
        quantitySold: i.quantity,
        grossSales: i.gross,
        discounts: i.discounts,
        netSales: i.net,
        averagePrice: i.quantity > 0 ? i.net / i.quantity : 0,
      }))
      .sort((a, b) => b.quantitySold - a.quantitySold);

    const total = allItems.length;
    const paginatedData = allItems.slice((page - 1) * limit, page * limit);

    return {
      data: paginatedData,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get sales by payment method
   */
  async getSalesByPaymentMethod(dto: DateRangeDto): Promise<SalesByPaymentMethodDto[]> {
    const { start, end } = this.getDateRange(dto);

    const payments = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.COMPLETED,
        order: {
          status: OrderStatus.COMPLETED,
          createdAt: { gte: start, lte: end },
        },
      },
    });

    // Group by payment method
    const methodMap = new Map<string, { count: number; amount: number; tips: number }>();

    for (const p of payments) {
      const method = p.paymentMethod;
      if (!methodMap.has(method)) {
        methodMap.set(method, { count: 0, amount: 0, tips: 0 });
      }
      const m = methodMap.get(method)!;
      m.count++;
      m.amount += Number(p.amount);
      m.tips += Number(p.tipAmount);
    }

    const totalAmount = Array.from(methodMap.values()).reduce((sum, m) => sum + m.amount, 0);

    return Array.from(methodMap.entries())
      .map(([method, data]) => ({
        paymentMethod: method,
        transactionCount: data.count,
        totalAmount: data.amount,
        tipAmount: data.tips,
        percentage: totalAmount > 0 ? (data.amount / totalAmount) * 100 : 0,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount);
  }

  /**
   * Get sales by hour
   */
  async getSalesByHour(dto: DateRangeDto): Promise<SalesByHourDto[]> {
    const { start, end } = this.getDateRange(dto);

    const orders = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.COMPLETED,
        createdAt: { gte: start, lte: end },
      },
      include: {
        orderItems: { where: { isVoided: false } },
      },
    });

    // Group by hour
    const hourMap = new Map<number, { count: number; sales: number; items: number }>();

    // Initialize all hours
    for (let i = 0; i < 24; i++) {
      hourMap.set(i, { count: 0, sales: 0, items: 0 });
    }

    for (const order of orders) {
      const hour = new Date(order.createdAt).getHours();
      const h = hourMap.get(hour)!;
      h.count++;
      h.sales += Number(order.grandTotal);
      h.items += order.orderItems.reduce((sum, oi) => sum + oi.quantity, 0);
    }

    const formatHour = (h: number): string => {
      const start = h % 12 || 12;
      const end = (h + 1) % 12 || 12;
      const startPeriod = h < 12 ? 'AM' : 'PM';
      const endPeriod = (h + 1) < 12 || (h + 1) === 24 ? 'AM' : 'PM';
      return `${start}:00 ${startPeriod} - ${end}:00 ${endPeriod}`;
    };

    return Array.from(hourMap.entries())
      .map(([hour, data]) => ({
        hour,
        hourLabel: formatHour(hour),
        orderCount: data.count,
        totalSales: data.sales,
        itemsSold: data.items,
      }))
      .sort((a, b) => a.hour - b.hour);
  }

  /**
   * Get transaction history
   */
  async getTransactions(dto: ReportQueryDto): Promise<{ data: TransactionDto[]; meta: any }> {
    const { start, end } = this.getDateRange(dto);
    const page = dto.page || 1;
    const limit = dto.limit || 50;

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          createdAt: { gte: start, lte: end },
        },
        include: {
          orderItems: { where: { isVoided: false } },
          payments: { where: { status: PaymentStatus.COMPLETED } },
          user: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.count({
        where: {
          createdAt: { gte: start, lte: end },
        },
      }),
    ]);

    return {
      data: orders.map(o => ({
        id: o.id,
        orderNumber: o.orderNumber,
        invoiceNumber: o.invoiceNumber || undefined,
        orderType: o.orderType,
        status: o.status,
        customerName: o.customerName || undefined,
        subtotal: Number(o.subtotal),
        discountTotal: Number(o.discountTotal),
        taxTotal: Number(o.taxTotal),
        grandTotal: Number(o.grandTotal),
        itemCount: o.orderItems.reduce((sum, oi) => sum + oi.quantity, 0),
        paymentMethod: o.payments.length > 0 ? o.payments[0].paymentMethod : undefined,
        cashierName: o.user ? `${o.user.firstName} ${o.user.lastName}` : undefined,
        createdAt: o.createdAt.toISOString(),
        closedAt: o.closedAt?.toISOString(),
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get voided transactions
   */
  async getVoidedTransactions(dto: ReportQueryDto): Promise<{ data: VoidedTransactionDto[]; meta: any }> {
    const { start, end } = this.getDateRange(dto);
    const page = dto.page || 1;
    const limit = dto.limit || 50;

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          status: OrderStatus.VOIDED,
          createdAt: { gte: start, lte: end },
        },
        include: {
          orderItems: true,
          user: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.count({
        where: {
          status: OrderStatus.VOIDED,
          createdAt: { gte: start, lte: end },
        },
      }),
    ]);

    return {
      data: orders.map(o => ({
        id: o.id,
        orderNumber: o.orderNumber,
        invoiceNumber: o.invoiceNumber || undefined,
        originalTotal: Number(o.grandTotal),
        voidReason: o.notes || undefined,
        voidedBy: o.user ? `${o.user.firstName} ${o.user.lastName}` : undefined,
        voidedAt: o.closedAt?.toISOString() || o.createdAt.toISOString(),
        cashierName: o.user ? `${o.user.firstName} ${o.user.lastName}` : undefined,
        itemCount: o.orderItems.length,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get discount report
   */
  async getDiscountReport(dto: DateRangeDto): Promise<DiscountReportDto[]> {
    const { start, end } = this.getDateRange(dto);

    const discounts = await this.prisma.orderDiscount.findMany({
      where: {
        order: {
          status: OrderStatus.COMPLETED,
          createdAt: { gte: start, lte: end },
        },
      },
    });

    // Group by discount name
    const discountMap = new Map<string, {
      name: string;
      type: string;
      scope: string;
      count: number;
      total: number;
      orders: Set<string>;
    }>();

    for (const d of discounts) {
      const key = d.discountName;
      if (!discountMap.has(key)) {
        discountMap.set(key, {
          name: d.discountName,
          type: d.discountType,
          scope: d.discountScope,
          count: 0,
          total: 0,
          orders: new Set(),
        });
      }
      const disc = discountMap.get(key)!;
      disc.count++;
      disc.total += Number(d.discountAmount);
      disc.orders.add(d.orderId);
    }

    return Array.from(discountMap.values())
      .map(d => ({
        discountId: d.name, // Using name as ID since discounts don't have separate table
        discountName: d.name,
        discountType: d.type,
        discountScope: d.scope,
        timesApplied: d.count,
        totalDiscountAmount: d.total,
        ordersAffected: d.orders.size,
      }))
      .sort((a, b) => b.totalDiscountAmount - a.totalDiscountAmount);
  }

  /**
   * Get refund report
   */
  async getRefundReport(dto: ReportQueryDto): Promise<{ data: RefundReportDto[]; meta: any }> {
    const { start, end } = this.getDateRange(dto);
    const page = dto.page || 1;
    const limit = dto.limit || 50;

    const [refunds, total] = await Promise.all([
      this.prisma.refund.findMany({
        where: {
          processedAt: { gte: start, lte: end },
        },
        include: {
          payment: true,
        },
        orderBy: { processedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.refund.count({
        where: {
          processedAt: { gte: start, lte: end },
        },
      }),
    ]);

    // Get order numbers for refunds
    const orderIds = [...new Set(refunds.map(r => r.orderId))];
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, orderNumber: true },
    });
    const orderMap = new Map(orders.map(o => [o.id, o.orderNumber]));

    // Get processor names
    const processorIds = [...new Set(refunds.map(r => r.processedBy))];
    const processors = await this.prisma.user.findMany({
      where: { id: { in: processorIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    const processorMap = new Map(processors.map(p => [p.id, `${p.firstName} ${p.lastName}`]));

    return {
      data: refunds.map(r => ({
        id: r.id,
        orderId: r.orderId,
        orderNumber: orderMap.get(r.orderId) || 'Unknown',
        paymentMethod: r.payment.paymentMethod,
        refundMethod: r.refundMethod,
        amount: Number(r.amount),
        reason: r.reason || undefined,
        processedBy: processorMap.get(r.processedBy),
        processedAt: r.processedAt.toISOString(),
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get shift report
   */
  async getShiftReport(shiftId: string): Promise<ShiftReportDto | null> {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: {
        operator: { select: { id: true, firstName: true, lastName: true } },
        cashMovements: true,
        orders: {
          include: {
            payments: { where: { status: PaymentStatus.COMPLETED } },
          },
        },
      },
    });

    if (!shift) return null;

    const completedOrders = shift.orders.filter(o => o.status === OrderStatus.COMPLETED);
    const totalSales = completedOrders.reduce((sum, o) => sum + Number(o.grandTotal), 0);

    const allPayments = completedOrders.flatMap(o => o.payments);
    const cashSales = allPayments
      .filter(p => p.paymentMethod === PaymentMethod.CASH)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const cardSales = allPayments
      .filter(p => p.paymentMethod === PaymentMethod.CREDIT_CARD || p.paymentMethod === PaymentMethod.DEBIT_CARD)
      .reduce((sum, p) => sum + Number(p.amount), 0);

    // Cash movements
    let totalCashIn = 0;
    let totalCashOut = 0;
    let totalPaidOuts = 0;
    let totalDrops = 0;
    let totalRefunds = 0;
    let expectedCash = Number(shift.openingCash);

    for (const m of shift.cashMovements) {
      const amount = Number(m.amount);
      expectedCash += amount;

      switch (m.movementType) {
        case 'CASH_IN':
          totalCashIn += amount;
          break;
        case 'PAID_OUT':
          totalPaidOuts += Math.abs(amount);
          break;
        case 'DROP':
          totalDrops += Math.abs(amount);
          break;
        case 'REFUND':
          totalRefunds += Math.abs(amount);
          break;
      }
    }

    // Calculate duration
    let duration: string | undefined;
    if (shift.closedAt) {
      const durationMs = new Date(shift.closedAt).getTime() - new Date(shift.openedAt).getTime();
      const hours = Math.floor(durationMs / (1000 * 60 * 60));
      const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
      duration = `${hours}h ${minutes}m`;
    }

    return {
      id: shift.id,
      operatorId: shift.operatorId,
      operatorName: `${shift.operator.firstName} ${shift.operator.lastName}`,
      status: shift.status,
      openedAt: shift.openedAt.toISOString(),
      closedAt: shift.closedAt?.toISOString(),
      duration,
      openingCash: Number(shift.openingCash),
      closingCash: shift.closingCash ? Number(shift.closingCash) : undefined,
      expectedCash,
      variance: shift.variance ? Number(shift.variance) : undefined,
      orderCount: completedOrders.length,
      totalSales,
      cashSales,
      cardSales,
      totalCashIn,
      totalCashOut,
      totalPaidOuts,
      totalDrops,
      totalRefunds,
    };
  }

  /**
   * Get shift history
   */
  async getShiftHistory(dto: ReportQueryDto): Promise<{ data: ShiftReportDto[]; meta: any }> {
    const { start, end } = this.getDateRange(dto);
    const page = dto.page || 1;
    const limit = dto.limit || 20;

    const [shifts, total] = await Promise.all([
      this.prisma.shift.findMany({
        where: {
          openedAt: { gte: start, lte: end },
        },
        include: {
          operator: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { orders: true } },
        },
        orderBy: { openedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.shift.count({
        where: {
          openedAt: { gte: start, lte: end },
        },
      }),
    ]);

    const shiftReports = await Promise.all(
      shifts.map(async s => {
        const report = await this.getShiftReport(s.id);
        return report!;
      })
    );

    return {
      data: shiftReports.filter(Boolean),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get Z-Reading history
   */
  async getZReadingHistory(dto: ReportQueryDto): Promise<{ data: any[]; meta: any }> {
    const { start, end } = this.getDateRange(dto);
    const page = dto.page || 1;
    const limit = dto.limit || 20;

    const [zReadings, total] = await Promise.all([
      this.prisma.zReading.findMany({
        where: {
          closedAt: { gte: start, lte: end },
        },
        orderBy: { closedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.zReading.count({
        where: {
          closedAt: { gte: start, lte: end },
        },
      }),
    ]);

    return {
      data: zReadings.map(z => ({
        id: z.id,
        zCounterNo: z.zCounterNo,
        readingDate: z.closedAt.toISOString(),
        beginningInvoice: z.beginningInvoiceNo,
        endingInvoice: z.endingInvoiceNo,
        openingGrandTotal: Number(z.beginningGrandTotal),
        closingGrandTotal: Number(z.endingGrandTotal),
        grossSales: Number(z.grossSales),
        netSales: Number(z.netSales),
        vatableSales: Number(z.vatableSales),
        vatAmount: Number(z.vatAmount),
        vatExemptSales: Number(z.vatExemptSales),
        zeroRatedSales: Number(z.zeroRatedSales),
        totalDiscounts: Number(z.discountTotal),
        totalRefunds: Number(z.refundTotal),
        totalVoids: Number(z.voidTotal),
        transactionCount: z.transactionCount,
        voidCount: z.voidCount,
        refundCount: z.refundCount,
        closedBy: z.closedBy,
        syncStatus: z.syncStatus,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Export data to CSV format
   */
  exportToCsv(data: any[], columns: { key: string; header: string }[]): string {
    const headers = columns.map(c => c.header).join(',');
    const rows = data.map(item =>
      columns.map(c => {
        const value = item[c.key];
        // Escape commas and quotes in values
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value ?? '';
      }).join(',')
    );
    return [headers, ...rows].join('\n');
  }
}
