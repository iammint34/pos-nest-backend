import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatus, OrderType, DiscountType, DiscountScope, Prisma } from '@prisma/client';
import {
  CreateOrderDto,
  AddOrderItemDto,
  UpdateOrderItemDto,
  VoidOrderItemDto,
  ApplyDiscountDto,
  UpdateOrderDto,
  VoidOrderDto,
  OrderQueryDto,
} from './dto/order.dto';
import { CurrentUserData } from '../auth/decorators/current-user.decorator';
import { ShiftsService } from '../shifts/shifts.service';
import { BirService } from '../bir/bir.service';
import { InventoryService } from '../inventory/inventory.service';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private shiftsService: ShiftsService,
    private birService: BirService,
    private inventoryService: InventoryService,
  ) {}

  /**
   * Generate next order number (includes date prefix for uniqueness)
   * Format: YYYYMMDD-NNN (e.g., 20260122-001)
   */
  private async generateOrderNumber(): Promise<string> {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const dateStr = `${year}${month}${day}`; // Local date YYYYMMDD

    today.setHours(0, 0, 0, 0);

    const lastOrder = await this.prisma.order.findFirst({
      where: {
        createdAt: { gte: today },
      },
      orderBy: { orderNumber: 'desc' },
    });

    let sequence = 1;
    if (lastOrder && lastOrder.orderNumber.startsWith(dateStr)) {
      const parts = lastOrder.orderNumber.split('-');
      if (parts.length === 2) {
        sequence = parseInt(parts[1], 10) + 1;
      }
    }

    return `${dateStr}-${String(sequence).padStart(3, '0')}`;
  }

  /**
   * Create a new order
   */
  async createOrder(dto: CreateOrderDto, user: CurrentUserData) {
    const orderNumber = await this.generateOrderNumber();

    // Get current shift ID if user has one open (optional - backward compatible)
    const shiftId = await this.shiftsService.getOpenShiftId(user.userId);

    const order = await this.prisma.order.create({
      data: {
        orderNumber,
        orderType: dto.orderType || OrderType.DINE_IN,
        status: OrderStatus.OPEN,
        userId: user.userId,
        shiftId,
        operatorId: user.userId,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        notes: dto.notes,
        subtotal: 0,
        discountTotal: 0,
        taxTotal: 0,
        grandTotal: 0,
      },
      include: {
        orderItems: true,
        discounts: true,
        payments: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        shift: {
          select: {
            id: true,
            operatorId: true,
            openedAt: true,
          },
        },
      },
    });

    return order;
  }

  /**
   * Get all open orders
   */
  async getOpenOrders() {
    return this.prisma.order.findMany({
      where: { status: { in: [OrderStatus.OPEN, OrderStatus.HELD] } },
      include: {
        orderItems: {
          where: { isVoided: false },
          include: {
            item: {
              select: { name: true, sku: true },
            },
          },
        },
        user: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Get order by ID
   */
  async getOrderById(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        orderItems: {
          include: {
            item: {
              select: { id: true, name: true, sku: true, price: true },
            },
            discounts: true,
          },
        },
        discounts: true,
        payments: {
          include: { refunds: true },
        },
        user: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  /**
   * Add item to order
   * If the item already exists in the order (and is not voided), increment its quantity
   */
  async addItem(orderId: string, dto: AddOrderItemDto, user: CurrentUserData) {
    const order = await this.getOrderById(orderId);

    if (order.status !== OrderStatus.OPEN) {
      throw new BadRequestException('Can only add items to open orders');
    }

    const item = await this.prisma.item.findUnique({
      where: { id: dto.itemId },
    });

    if (!item || !item.isActive) {
      throw new NotFoundException('Item not found or inactive');
    }

    const quantityToAdd = dto.quantity || 1;
    const unitPrice = item.price;

    // Check if item already exists in the order (and is not voided)
    const existingOrderItem = await this.prisma.orderItem.findFirst({
      where: {
        orderId,
        itemId: dto.itemId,
        isVoided: false,
      },
    });

    let orderItem;

    if (existingOrderItem) {
      // Increment quantity of existing item
      const newQuantity = existingOrderItem.quantity + quantityToAdd;
      const newTotalPrice = Number(unitPrice) * newQuantity;

      orderItem = await this.prisma.orderItem.update({
        where: { id: existingOrderItem.id },
        data: {
          quantity: newQuantity,
          totalPrice: newTotalPrice,
          // Append notes if provided
          notes: dto.notes
            ? existingOrderItem.notes
              ? `${existingOrderItem.notes}; ${dto.notes}`
              : dto.notes
            : existingOrderItem.notes,
        },
        include: {
          item: {
            select: { id: true, name: true, sku: true },
          },
        },
      });
    } else {
      // Create new order item
      const totalPrice = Number(unitPrice) * quantityToAdd;

      orderItem = await this.prisma.orderItem.create({
        data: {
          orderId,
          itemId: item.id,
          itemName: item.name,
          itemSku: item.sku,
          quantity: quantityToAdd,
          unitPrice,
          totalPrice,
          notes: dto.notes,
        },
        include: {
          item: {
            select: { id: true, name: true, sku: true },
          },
        },
      });
    }

    await this.recalculateOrderTotals(orderId);

    return orderItem;
  }

  /**
   * Update order item quantity/notes
   */
  async updateItem(orderId: string, itemId: string, dto: UpdateOrderItemDto, user: CurrentUserData) {
    const order = await this.getOrderById(orderId);

    if (order.status !== OrderStatus.OPEN) {
      throw new BadRequestException('Can only update items in open orders');
    }

    const orderItem = await this.prisma.orderItem.findFirst({
      where: { id: itemId, orderId },
    });

    if (!orderItem) {
      throw new NotFoundException('Order item not found');
    }

    if (orderItem.isVoided) {
      throw new BadRequestException('Cannot update voided item');
    }

    const quantity = dto.quantity || orderItem.quantity;
    const totalPrice = Number(orderItem.unitPrice) * quantity;

    const updated = await this.prisma.orderItem.update({
      where: { id: itemId },
      data: {
        quantity,
        totalPrice,
        notes: dto.notes !== undefined ? dto.notes : orderItem.notes,
      },
      include: {
        item: {
          select: { id: true, name: true, sku: true },
        },
      },
    });

    await this.recalculateOrderTotals(orderId);

    return updated;
  }

  /**
   * Remove item from order (before payment)
   */
  async removeItem(orderId: string, itemId: string, user: CurrentUserData) {
    const order = await this.getOrderById(orderId);

    if (order.status !== OrderStatus.OPEN) {
      throw new BadRequestException('Can only remove items from open orders');
    }

    const orderItem = await this.prisma.orderItem.findFirst({
      where: { id: itemId, orderId },
    });

    if (!orderItem) {
      throw new NotFoundException('Order item not found');
    }

    // Delete associated discounts first
    await this.prisma.orderDiscount.deleteMany({
      where: { orderItemId: itemId },
    });

    await this.prisma.orderItem.delete({
      where: { id: itemId },
    });

    await this.recalculateOrderTotals(orderId);

    return { message: 'Item removed successfully' };
  }

  /**
   * Void an item - marks as voided instead of deleting
   * Permission check handled by PermissionsGuard (supports manager approval via approvedBy)
   */
  async voidItem(orderId: string, itemId: string, dto: VoidOrderItemDto, user: CurrentUserData) {
    const order = await this.getOrderById(orderId);

    const orderItem = await this.prisma.orderItem.findFirst({
      where: { id: itemId, orderId },
    });

    if (!orderItem) {
      throw new NotFoundException('Order item not found');
    }

    if (orderItem.isVoided) {
      throw new BadRequestException('Item already voided');
    }

    const updated = await this.prisma.orderItem.update({
      where: { id: itemId },
      data: {
        isVoided: true,
        voidReason: dto.reason,
        voidedBy: user.userId,
      },
    });

    await this.recalculateOrderTotals(orderId);

    return updated;
  }

  /**
   * Apply discount to order or item (Manager only)
   */
  async applyDiscount(orderId: string, dto: ApplyDiscountDto, user: CurrentUserData) {
    if (user.role !== 'MANAGER') {
      throw new ForbiddenException('Only managers can apply discounts');
    }

    const order = await this.getOrderById(orderId);

    if (order.status !== OrderStatus.OPEN) {
      throw new BadRequestException('Can only apply discounts to open orders');
    }

    // Calculate discount amount
    let discountAmount = 0;

    if (dto.discountScope === DiscountScope.ITEM) {
      if (!dto.orderItemId) {
        throw new BadRequestException('Order item ID required for item discount');
      }

      const orderItem = order.orderItems.find((i) => i.id === dto.orderItemId);
      if (!orderItem) {
        throw new NotFoundException('Order item not found');
      }

      if (dto.discountType === DiscountType.PERCENTAGE) {
        discountAmount = (Number(orderItem.totalPrice) * dto.discountValue) / 100;
      } else {
        discountAmount = Math.min(dto.discountValue, Number(orderItem.totalPrice));
      }
    } else {
      // Order-level discount
      if (dto.discountType === DiscountType.PERCENTAGE) {
        discountAmount = (Number(order.subtotal) * dto.discountValue) / 100;
      } else {
        discountAmount = Math.min(dto.discountValue, Number(order.subtotal));
      }
    }

    const discount = await this.prisma.orderDiscount.create({
      data: {
        orderId,
        orderItemId: dto.orderItemId,
        discountName: dto.discountName,
        discountType: dto.discountType,
        discountScope: dto.discountScope,
        discountValue: dto.discountValue,
        discountAmount,
        reason: dto.reason,
        appliedBy: user.userId,
      },
    });

    await this.recalculateOrderTotals(orderId);

    return discount;
  }

  /**
   * Remove discount
   */
  async removeDiscount(orderId: string, discountId: string, user: CurrentUserData) {
    if (user.role !== 'MANAGER') {
      throw new ForbiddenException('Only managers can remove discounts');
    }

    const discount = await this.prisma.orderDiscount.findFirst({
      where: { id: discountId, orderId },
    });

    if (!discount) {
      throw new NotFoundException('Discount not found');
    }

    await this.prisma.orderDiscount.delete({
      where: { id: discountId },
    });

    await this.recalculateOrderTotals(orderId);

    return { message: 'Discount removed successfully' };
  }

  /**
   * Update order details
   */
  async updateOrder(orderId: string, dto: UpdateOrderDto, user: CurrentUserData) {
    const order = await this.getOrderById(orderId);

    if (order.status !== OrderStatus.OPEN && order.status !== OrderStatus.HELD) {
      throw new BadRequestException('Cannot update completed or voided orders');
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        orderType: dto.orderType,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        notes: dto.notes,
      },
      include: {
        orderItems: true,
        discounts: true,
        user: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
  }

  /**
   * Hold/park order for later
   */
  async holdOrder(orderId: string, user: CurrentUserData) {
    const order = await this.getOrderById(orderId);

    if (order.status !== OrderStatus.OPEN) {
      throw new BadRequestException('Can only hold open orders');
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.HELD },
    });
  }

  /**
   * Resume held order
   */
  async resumeOrder(orderId: string, user: CurrentUserData) {
    const order = await this.getOrderById(orderId);

    if (order.status !== OrderStatus.HELD) {
      throw new BadRequestException('Can only resume held orders');
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.OPEN },
    });
  }

  /**
   * Void entire order
   * Permission check handled by PermissionsGuard (supports manager approval via approvedBy)
   */
  async voidOrder(orderId: string, dto: VoidOrderDto, user: CurrentUserData) {
    const order = await this.getOrderById(orderId);

    if (order.status === OrderStatus.VOIDED) {
      throw new BadRequestException('Order already voided');
    }

    if (order.status === OrderStatus.COMPLETED) {
      throw new BadRequestException('Cannot void completed order. Use refund instead.');
    }

    // Void all items
    await this.prisma.orderItem.updateMany({
      where: { orderId, isVoided: false },
      data: {
        isVoided: true,
        voidReason: dto.reason,
        voidedBy: user.userId,
      },
    });

    // Update order status
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.VOIDED,
        notes: `${order.notes || ''}\n[VOIDED: ${dto.reason}]`.trim(),
      },
      include: {
        orderItems: true,
        discounts: true,
        user: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    // Add to sync queue
    await this.addToSyncQueue(orderId, 'VOID_ORDER');

    return updated;
  }

  /**
   * Get orders with filters
   */
  async getOrders(query: OrderQueryDto) {
    const where: Prisma.OrderWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.userId) {
      where.userId = query.userId;
    }

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) {
        where.createdAt.gte = new Date(query.dateFrom);
      }
      if (query.dateTo) {
        where.createdAt.lte = new Date(query.dateTo);
      }
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          orderItems: {
            where: { isVoided: false },
          },
          user: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get today's sales summary
   */
  async getTodaySummary() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [completedOrders, totalSales, totalItems, voidedOrders] = await Promise.all([
      this.prisma.order.count({
        where: {
          status: OrderStatus.COMPLETED,
          createdAt: { gte: today, lt: tomorrow },
        },
      }),
      this.prisma.order.aggregate({
        where: {
          status: OrderStatus.COMPLETED,
          createdAt: { gte: today, lt: tomorrow },
        },
        _sum: { grandTotal: true },
      }),
      this.prisma.orderItem.count({
        where: {
          isVoided: false,
          order: {
            status: OrderStatus.COMPLETED,
            createdAt: { gte: today, lt: tomorrow },
          },
        },
      }),
      this.prisma.order.count({
        where: {
          status: OrderStatus.VOIDED,
          createdAt: { gte: today, lt: tomorrow },
        },
      }),
    ]);

    return {
      completedOrders,
      totalSales: totalSales._sum.grandTotal || 0,
      totalItems,
      voidedOrders,
      averageOrderValue: completedOrders > 0
        ? Number(totalSales._sum.grandTotal || 0) / completedOrders
        : 0,
    };
  }

  /**
   * Recalculate order totals with VAT breakdown
   */
  private async recalculateOrderTotals(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        orderItems: {
          where: { isVoided: false },
        },
        discounts: true,
      },
    });

    if (!order) return;

    // Calculate subtotal from non-voided items
    const subtotal = order.orderItems.reduce(
      (sum, item) => sum + Number(item.totalPrice),
      0,
    );

    // Calculate total discounts
    const discountTotal = order.discounts.reduce(
      (sum, discount) => sum + Number(discount.discountAmount),
      0,
    );

    // Calculate grand total
    const grandTotal = Math.max(0, subtotal - discountTotal);

    // Get BIR config for VAT settings
    let vatBreakdown = {
      vatableSales: 0,
      vatAmount: 0,
      vatExemptSales: 0,
      zeroRatedSales: 0,
    };

    try {
      const birConfig = await this.birService.getDeviceBirConfig();
      vatBreakdown = this.birService.calculateVatBreakdown(
        grandTotal,
        birConfig.isVatRegistered,
      );
    } catch (error) {
      // Device not configured yet, use default VAT calculation
      vatBreakdown = this.birService.calculateVatBreakdown(grandTotal, true);
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        subtotal,
        discountTotal,
        grandTotal,
        vatableSales: vatBreakdown.vatableSales,
        vatAmount: vatBreakdown.vatAmount,
        vatExemptSales: vatBreakdown.vatExemptSales,
        zeroRatedSales: vatBreakdown.zeroRatedSales,
      },
    });
  }

  /**
   * Finalize order for BIR compliance (called when payment is completed)
   * Generates invoice number, updates grand total accumulator, creates journal entry
   */
  async finalizeOrderForBir(orderId: string, user: CurrentUserData) {
    const order = await this.getOrderById(orderId);

    if (order.invoiceNumber) {
      // Already finalized
      return order;
    }

    // Generate sequential invoice number
    const invoiceNumber = await this.birService.getNextInvoiceNumber();

    // Update the order with invoice number
    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: { invoiceNumber },
      include: {
        orderItems: {
          where: { isVoided: false },
          include: { item: { select: { name: true } } },
        },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // Update non-resettable grand total
    await this.birService.updateGrandTotal(
      orderId,
      invoiceNumber,
      Number(order.grandTotal),
      'SALE',
    );

    // Get BIR config for receipt
    const birConfig = await this.birService.getDeviceBirConfig();

    // Create electronic journal entry
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
      cashierName: `${updatedOrder.user.firstName} ${updatedOrder.user.lastName}`,
      items: updatedOrder.orderItems.map((item) => ({
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
      user.userId,
      `${updatedOrder.user.firstName} ${updatedOrder.user.lastName}`,
    );

    return updatedOrder;
  }

  /**
   * Add order operation to sync queue
   */
  private async addToSyncQueue(orderId: string, operation: 'CREATE_ORDER' | 'VOID_ORDER') {
    const order = await this.getOrderById(orderId);

    await this.prisma.syncQueue.create({
      data: {
        operation,
        entityType: 'Order',
        entityId: orderId,
        payload: JSON.stringify(order),
        status: 'PENDING',
      },
    });
  }
}
