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

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  /**
   * Generate next order number (resets daily)
   */
  private async generateOrderNumber(): Promise<string> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lastOrder = await this.prisma.order.findFirst({
      where: {
        createdAt: { gte: today },
      },
      orderBy: { orderNumber: 'desc' },
    });

    if (!lastOrder) {
      return '001';
    }

    const lastNumber = parseInt(lastOrder.orderNumber, 10);
    return String(lastNumber + 1).padStart(3, '0');
  }

  /**
   * Create a new order
   */
  async createOrder(dto: CreateOrderDto, user: CurrentUserData) {
    const orderNumber = await this.generateOrderNumber();

    const order = await this.prisma.order.create({
      data: {
        orderNumber,
        orderType: dto.orderType || OrderType.DINE_IN,
        status: OrderStatus.OPEN,
        userId: user.userId,
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

    const quantity = dto.quantity || 1;
    const unitPrice = item.price;
    const totalPrice = Number(unitPrice) * quantity;

    const orderItem = await this.prisma.orderItem.create({
      data: {
        orderId,
        itemId: item.id,
        itemName: item.name,
        itemSku: item.sku,
        quantity,
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
   * Void an item (Manager only) - marks as voided instead of deleting
   */
  async voidItem(orderId: string, itemId: string, dto: VoidOrderItemDto, user: CurrentUserData) {
    if (user.role !== 'MANAGER') {
      throw new ForbiddenException('Only managers can void items');
    }

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
   * Void entire order (Manager only)
   */
  async voidOrder(orderId: string, dto: VoidOrderDto, user: CurrentUserData) {
    if (user.role !== 'MANAGER') {
      throw new ForbiddenException('Only managers can void orders');
    }

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
   * Recalculate order totals
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

    // Calculate grand total (no tax for now)
    const grandTotal = Math.max(0, subtotal - discountTotal);

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        subtotal,
        discountTotal,
        grandTotal,
      },
    });
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
