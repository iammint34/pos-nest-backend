import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShiftStatus, CashMovementType, Prisma } from '@prisma/client';
import {
  OpenShiftDto,
  CloseShiftDto,
  CashInDto,
  CashOutDto,
  PaidOutDto,
  CashDropDto,
  ShiftQueryDto,
} from './dto/shift.dto';
import { CurrentUserData } from '../auth/decorators/current-user.decorator';

@Injectable()
export class ShiftsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Open a new shift
   */
  async openShift(dto: OpenShiftDto, user: CurrentUserData) {
    // Check if user already has an open shift
    const existingShift = await this.prisma.shift.findFirst({
      where: {
        operatorId: user.userId,
        status: ShiftStatus.OPEN,
      },
    });

    if (existingShift) {
      throw new BadRequestException('You already have an open shift');
    }

    // Create the shift
    const shift = await this.prisma.shift.create({
      data: {
        operatorId: user.userId,
        status: ShiftStatus.OPEN,
        openingCash: dto.openingCash,
        notes: dto.notes,
      },
      include: {
        operator: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    // Record opening float as cash movement
    await this.prisma.cashMovement.create({
      data: {
        shiftId: shift.id,
        movementType: CashMovementType.OPENING_FLOAT,
        amount: dto.openingCash,
        performedBy: user.userId,
      },
    });

    // Add to sync queue to push open shift to portal
    await this.addToSyncQueue(shift.id);

    return shift;
  }

  /**
   * Close the current shift
   */
  async closeShift(dto: CloseShiftDto, user: CurrentUserData) {
    const shift = await this.getOpenShift(user.userId);

    // Calculate expected cash
    const summary = await this.calculateShiftSummary(shift.id);
    const expectedCash = summary.expectedCash;
    const variance = dto.closingCash - expectedCash;

    // Record closing count
    await this.prisma.cashMovement.create({
      data: {
        shiftId: shift.id,
        movementType: CashMovementType.CLOSING_COUNT,
        amount: dto.closingCash,
        performedBy: user.userId,
      },
    });

    // Update shift
    const closedShift = await this.prisma.shift.update({
      where: { id: shift.id },
      data: {
        status: ShiftStatus.CLOSED,
        closedAt: new Date(),
        closingCash: dto.closingCash,
        expectedCash,
        variance,
        notes: dto.notes
          ? `${shift.notes || ''}\n[Closing]: ${dto.notes}`.trim()
          : shift.notes,
        syncStatus: 'PENDING',
      },
      include: {
        operator: {
          select: { id: true, firstName: true, lastName: true },
        },
        cashMovements: true,
      },
    });

    // Add to sync queue
    await this.addToSyncQueue(shift.id);

    return {
      ...closedShift,
      summary,
    };
  }

  /**
   * Get current open shift for user
   */
  async getCurrentShift(userId: string) {
    const shift = await this.prisma.shift.findFirst({
      where: {
        operatorId: userId,
        status: ShiftStatus.OPEN,
      },
      include: {
        operator: {
          select: { id: true, firstName: true, lastName: true },
        },
        cashMovements: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: {
          select: { orders: true },
        },
      },
    });

    if (!shift) {
      return null;
    }

    const summary = await this.calculateShiftSummary(shift.id);

    return {
      ...shift,
      summary,
    };
  }

  /**
   * Record cash in
   */
  async cashIn(dto: CashInDto, user: CurrentUserData) {
    const shift = await this.getOpenShift(user.userId);

    const movement = await this.prisma.cashMovement.create({
      data: {
        shiftId: shift.id,
        movementType: CashMovementType.CASH_IN,
        amount: dto.amount,
        reason: dto.reason,
        performedBy: user.userId,
      },
    });

    return movement;
  }

  /**
   * Record cash out
   */
  async cashOut(dto: CashOutDto, user: CurrentUserData) {
    const shift = await this.getOpenShift(user.userId);

    // Validate sufficient cash in drawer
    const summary = await this.calculateShiftSummary(shift.id);
    if (dto.amount > summary.expectedCash) {
      throw new BadRequestException(
        `Insufficient cash in drawer. Available: ${summary.expectedCash}`,
      );
    }

    const movement = await this.prisma.cashMovement.create({
      data: {
        shiftId: shift.id,
        movementType: CashMovementType.DROP, // Using DROP for general cash out
        amount: -dto.amount, // Negative for outgoing
        reason: dto.reason,
        performedBy: user.userId,
      },
    });

    return movement;
  }

  /**
   * Record paid out (expense)
   */
  async paidOut(dto: PaidOutDto, user: CurrentUserData) {
    const shift = await this.getOpenShift(user.userId);

    // Validate sufficient cash in drawer
    const summary = await this.calculateShiftSummary(shift.id);
    if (dto.amount > summary.expectedCash) {
      throw new BadRequestException(
        `Insufficient cash in drawer. Available: ${summary.expectedCash}`,
      );
    }

    const movement = await this.prisma.cashMovement.create({
      data: {
        shiftId: shift.id,
        movementType: CashMovementType.PAID_OUT,
        amount: -dto.amount, // Negative for outgoing
        reason: dto.reason,
        performedBy: user.userId,
      },
    });

    return movement;
  }

  /**
   * Record cash drop to safe
   */
  async cashDrop(dto: CashDropDto, user: CurrentUserData) {
    const shift = await this.getOpenShift(user.userId);

    // Validate sufficient cash in drawer
    const summary = await this.calculateShiftSummary(shift.id);
    if (dto.amount > summary.expectedCash) {
      throw new BadRequestException(
        `Insufficient cash in drawer. Available: ${summary.expectedCash}`,
      );
    }

    const movement = await this.prisma.cashMovement.create({
      data: {
        shiftId: shift.id,
        movementType: CashMovementType.DROP,
        amount: -dto.amount, // Negative for outgoing
        reason: dto.notes || 'Cash drop to safe',
        performedBy: user.userId,
      },
    });

    return movement;
  }

  /**
   * Get cash movements for a shift
   */
  async getMovements(shiftId: string, user: CurrentUserData) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found');
    }

    // Only allow viewing own shifts or if manager
    if (shift.operatorId !== user.userId && user.role !== 'MANAGER') {
      throw new BadRequestException('Cannot view other users shifts');
    }

    return this.prisma.cashMovement.findMany({
      where: { shiftId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Get shift summary
   */
  async getShiftSummary(shiftId: string, user: CurrentUserData) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: {
        operator: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found');
    }

    // Only allow viewing own shifts or if manager
    if (shift.operatorId !== user.userId && user.role !== 'MANAGER') {
      throw new BadRequestException('Cannot view other users shifts');
    }

    const summary = await this.calculateShiftSummary(shiftId);

    return {
      shift,
      summary,
    };
  }

  /**
   * Get shift by ID
   */
  async getShiftById(shiftId: string, user: CurrentUserData) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: {
        operator: {
          select: { id: true, firstName: true, lastName: true },
        },
        cashMovements: {
          orderBy: { createdAt: 'asc' },
        },
        orders: {
          select: {
            id: true,
            orderNumber: true,
            grandTotal: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found');
    }

    // Only allow viewing own shifts or if manager
    if (shift.operatorId !== user.userId && user.role !== 'MANAGER') {
      throw new BadRequestException('Cannot view other users shifts');
    }

    const summary = await this.calculateShiftSummary(shiftId);

    return {
      ...shift,
      summary,
    };
  }

  /**
   * Get shifts with filters (Manager only)
   */
  async getShifts(query: ShiftQueryDto) {
    const where: Prisma.ShiftWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.operatorId) {
      where.operatorId = query.operatorId;
    }

    if (query.dateFrom || query.dateTo) {
      where.openedAt = {};
      if (query.dateFrom) {
        where.openedAt.gte = new Date(query.dateFrom);
      }
      if (query.dateTo) {
        where.openedAt.lte = new Date(query.dateTo);
      }
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const [shifts, total] = await Promise.all([
      this.prisma.shift.findMany({
        where,
        include: {
          operator: {
            select: { id: true, firstName: true, lastName: true },
          },
          _count: {
            select: { orders: true, cashMovements: true },
          },
        },
        orderBy: { openedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.shift.count({ where }),
    ]);

    return {
      data: shifts,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Record cash sale movement (called from payments service)
   */
  async recordCashSale(
    shiftId: string,
    amount: number,
    changeAmount: number,
    tipAmount: number,
    orderId: string,
    userId: string,
  ) {
    const movements = [];

    // Record cash received
    movements.push(
      this.prisma.cashMovement.create({
        data: {
          shiftId,
          movementType: CashMovementType.CASH_SALE,
          amount: amount + tipAmount, // Total cash received before change
          referenceType: 'Order',
          referenceId: orderId,
          performedBy: userId,
        },
      }),
    );

    // Record change given (negative)
    if (changeAmount > 0) {
      movements.push(
        this.prisma.cashMovement.create({
          data: {
            shiftId,
            movementType: CashMovementType.CHANGE_GIVEN,
            amount: -changeAmount,
            referenceType: 'Order',
            referenceId: orderId,
            performedBy: userId,
          },
        }),
      );
    }

    // Record tip if any
    if (tipAmount > 0) {
      movements.push(
        this.prisma.cashMovement.create({
          data: {
            shiftId,
            movementType: CashMovementType.TIP_CASH,
            amount: tipAmount,
            referenceType: 'Order',
            referenceId: orderId,
            performedBy: userId,
          },
        }),
      );
    }

    await Promise.all(movements);
  }

  /**
   * Record cash refund movement (called from payments service)
   */
  async recordCashRefund(
    shiftId: string,
    amount: number,
    orderId: string,
    userId: string,
  ) {
    await this.prisma.cashMovement.create({
      data: {
        shiftId,
        movementType: CashMovementType.REFUND,
        amount: -amount, // Negative - cash goes out
        referenceType: 'Order',
        referenceId: orderId,
        performedBy: userId,
      },
    });
  }

  /**
   * Calculate shift summary
   */
  private async calculateShiftSummary(shiftId: string) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found');
    }

    const movements = await this.prisma.cashMovement.findMany({
      where: { shiftId },
    });

    let totalCashSales = 0;
    let totalChangeGiven = 0;
    let totalCashRefunds = 0;
    let totalTips = 0;
    let totalPaidOuts = 0;
    let totalDrops = 0;
    let totalCashIn = 0;

    for (const m of movements) {
      const amount = Number(m.amount);
      switch (m.movementType) {
        case CashMovementType.CASH_SALE:
          totalCashSales += amount;
          break;
        case CashMovementType.CHANGE_GIVEN:
          totalChangeGiven += Math.abs(amount);
          break;
        case CashMovementType.REFUND:
          totalCashRefunds += Math.abs(amount);
          break;
        case CashMovementType.TIP_CASH:
          totalTips += amount;
          break;
        case CashMovementType.PAID_OUT:
          totalPaidOuts += Math.abs(amount);
          break;
        case CashMovementType.DROP:
          totalDrops += Math.abs(amount);
          break;
        case CashMovementType.CASH_IN:
          totalCashIn += amount;
          break;
      }
    }

    // Calculate expected cash in drawer
    const openingCash = Number(shift.openingCash);
    const expectedCash =
      openingCash +
      totalCashSales -
      totalChangeGiven -
      totalCashRefunds -
      totalPaidOuts -
      totalDrops +
      totalCashIn;

    // Get order count
    const orderCount = await this.prisma.order.count({
      where: { shiftId },
    });

    return {
      openingCash,
      totalCashSales,
      totalChangeGiven,
      totalCashRefunds,
      totalTips,
      totalPaidOuts,
      totalDrops,
      totalCashIn,
      expectedCash,
      orderCount,
    };
  }

  /**
   * Get open shift or throw error
   */
  private async getOpenShift(userId: string) {
    const shift = await this.prisma.shift.findFirst({
      where: {
        operatorId: userId,
        status: ShiftStatus.OPEN,
      },
    });

    if (!shift) {
      throw new BadRequestException('No open shift found. Please open a shift first.');
    }

    return shift;
  }

  /**
   * Add shift to sync queue
   */
  private async addToSyncQueue(shiftId: string) {
    await this.prisma.syncQueue.create({
      data: {
        operation: 'SYNC_SHIFT',
        entityType: 'Shift',
        entityId: shiftId,
        payload: JSON.stringify({ shiftId }),
        status: 'PENDING',
      },
    });
  }

  /**
   * Get open shift ID for order creation (utility for orders service)
   */
  async getOpenShiftId(userId: string): Promise<string | null> {
    const shift = await this.prisma.shift.findFirst({
      where: {
        operatorId: userId,
        status: ShiftStatus.OPEN,
      },
      select: { id: true },
    });

    return shift?.id || null;
  }
}
