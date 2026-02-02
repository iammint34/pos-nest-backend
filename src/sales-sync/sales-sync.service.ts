import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PortalApiService } from '../portal-api/portal-api.service';
import { DeviceService } from '../device/device.service';
import { InventoryService } from '../inventory/inventory.service';
import { SyncOrderPayload, SyncShiftPayload, SyncZReadingPayload, SyncInventoryMovementPayload } from '../portal-api/portal-api.types';

@Injectable()
export class SalesSyncService {
  private readonly logger = new Logger(SalesSyncService.name);
  private isSyncing = false;

  constructor(
    private prisma: PrismaService,
    private portalApi: PortalApiService,
    private deviceService: DeviceService,
    private inventoryService: InventoryService,
  ) {}

  /**
   * Scheduled sync task - runs every 15 seconds
   */
  @Cron('*/15 * * * * *')
  async scheduledSync() {
    if (this.isSyncing) {
      return;
    }

    try {
      await this.processSyncQueue();
    } catch (error) {
      this.logger.error(`Scheduled sales sync failed: ${error.message}`);
    }
  }

  /**
   * Manually trigger sync
   */
  async triggerSync() {
    if (this.isSyncing) {
      return { message: 'Sync already in progress' };
    }

    return this.processSyncQueue();
  }

  /**
   * Process sync queue
   */
  async processSyncQueue() {
    this.isSyncing = true;

    try {
      const isRegistered = await this.deviceService.isRegistered();
      if (!isRegistered) {
        this.logger.warn('Device not registered, skipping sync');
        return { synced: 0, failed: 0, message: 'Device not registered' };
      }

      const isOnline = await this.portalApi.checkConnectivity();
      if (!isOnline) {
        this.logger.warn('Portal not reachable, skipping sync');
        return { synced: 0, failed: 0, message: 'Portal offline' };
      }

      const deviceIdentifier = await this.deviceService.getDeviceIdentifier();
      const deviceToken = await this.deviceService.getDeviceToken();

      if (!deviceIdentifier || !deviceToken) {
        return { synced: 0, failed: 0, message: 'Missing device credentials' };
      }

      // Get pending sync items
      const pendingItems = await this.prisma.syncQueue.findMany({
        where: {
          status: 'PENDING',
          attempts: { lt: 5 },
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });

      if (pendingItems.length === 0) {
        return { synced: 0, failed: 0, message: 'No pending items' };
      }

      let synced = 0;
      let failed = 0;

      for (const item of pendingItems) {
        // Mark as in progress
        await this.prisma.syncQueue.update({
          where: { id: item.id },
          data: {
            status: 'IN_PROGRESS',
            lastAttemptAt: new Date(),
            attempts: item.attempts + 1,
          },
        });

        try {
          switch (item.operation) {
            case 'CREATE_ORDER':
              await this.syncOrder(
                item.entityId,
                deviceIdentifier,
                deviceToken,
              );
              break;
            case 'VOID_ORDER':
              await this.syncVoidedOrder(
                item.entityId,
                deviceIdentifier,
                deviceToken,
              );
              break;
            case 'REFUND':
              await this.syncRefund(
                item.entityId,
                deviceIdentifier,
                deviceToken,
              );
              break;
            case 'SYNC_SHIFT':
              await this.syncShift(
                item.entityId,
                deviceIdentifier,
                deviceToken,
              );
              break;
            case 'SYNC_ZREADING':
              await this.syncZReading(
                item.entityId,
                deviceIdentifier,
                deviceToken,
              );
              break;
            case 'SYNC_INVENTORY_MOVEMENT':
              await this.syncInventoryMovement(
                item.entityId,
                deviceIdentifier,
                deviceToken,
              );
              break;
          }

          // Mark as completed
          await this.prisma.syncQueue.update({
            where: { id: item.id },
            data: { status: 'COMPLETED' },
          });

          synced++;
        } catch (error) {
          this.logger.error(
            `Failed to sync ${item.operation} ${item.entityId}: ${error.message}`,
          );

          // Mark as failed or pending (for retry)
          const newStatus = item.attempts >= 4 ? 'FAILED' : 'PENDING';
          await this.prisma.syncQueue.update({
            where: { id: item.id },
            data: {
              status: newStatus,
              errorMessage: error.message,
            },
          });

          failed++;
        }
      }

      // Log sync
      await this.prisma.syncLog.create({
        data: {
          direction: 'POS_TO_PORTAL',
          syncType: 'ORDERS',
          status: failed === 0 ? 'SUCCESS' : synced > 0 ? 'PARTIAL' : 'FAILED',
          itemCount: synced,
          errorMessage: failed > 0 ? `${failed} items failed to sync` : null,
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });

      this.logger.log(
        `Sales sync completed: ${synced} synced, ${failed} failed`,
      );

      return { synced, failed, message: 'Sync completed' };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Sync completed order to Portal
   */
  private async syncOrder(
    orderId: string,
    deviceIdentifier: string,
    deviceToken: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        orderItems: {
          include: {
            item: true,
            discounts: true,
          },
        },
        discounts: true,
        payments: {
          include: { refunds: true },
        },
        user: true,
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    // Build items array and track indices for discounts
    const items = order.orderItems.map((item) => ({
      posItemId: item.id,
      itemId: item.item?.portalId ?? undefined,
      itemName: item.itemName,
      itemSku: item.itemSku ?? undefined,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      discountAmount: Number(item.discountAmount),
      taxAmount: Number(item.taxAmount),
      totalPrice: Number(item.totalPrice),
      notes: item.notes ?? undefined,
      isVoided: item.isVoided,
      voidReason: item.voidReason ?? undefined,
    }));

    // Resolve local user IDs to portal user IDs for discounts and refunds
    const localUserIds = new Set<string>();
    for (const d of order.discounts) {
      if (d.appliedBy) localUserIds.add(d.appliedBy);
    }
    for (const p of order.payments) {
      for (const r of p.refunds) {
        if (r.processedBy) localUserIds.add(r.processedBy);
      }
    }

    const portalUserIdMap = new Map<string, string>();
    if (localUserIds.size > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: Array.from(localUserIds) } },
        select: { id: true, portalUserId: true },
      });
      for (const u of users) {
        portalUserIdMap.set(u.id, u.portalUserId);
      }
    }

    // Map discounts with orderItemIndex instead of posOrderItemId
    const discounts = order.discounts.map((d) => {
      // Find the index of the order item this discount applies to
      const orderItemIndex = d.orderItemId
        ? order.orderItems.findIndex((oi) => oi.id === d.orderItemId)
        : undefined;

      return {
        orderItemIndex:
          orderItemIndex !== undefined && orderItemIndex >= 0
            ? orderItemIndex
            : undefined,
        discountName: d.discountName,
        discountType: d.discountType,
        discountScope: d.discountScope,
        discountValue: Number(d.discountValue),
        discountAmount: Number(d.discountAmount),
        reason: d.reason ?? undefined,
        appliedBy: d.appliedBy ? portalUserIdMap.get(d.appliedBy) : undefined,
      };
    });

    const payload: SyncOrderPayload = {
      posOrderId: order.id,
      orderNumber: order.orderNumber,
      operatorId: order.user?.portalUserId,
      orderType: order.orderType,
      status: order.status,
      customerName: order.customerName ?? undefined,
      customerPhone: order.customerPhone ?? undefined,
      subtotal: Number(order.subtotal),
      discountTotal: Number(order.discountTotal),
      taxTotal: Number(order.taxTotal),
      grandTotal: Number(order.grandTotal),
      // BIR VAT Breakdown
      vatableSales: Number(order.vatableSales) || 0,
      vatAmount: Number(order.vatAmount) || 0,
      vatExemptSales: Number(order.vatExemptSales) || 0,
      zeroRatedSales: Number(order.zeroRatedSales) || 0,
      notes: order.notes ?? undefined,
      posCreatedAt: order.createdAt.toISOString(),
      posClosedAt: order.closedAt?.toISOString(),
      items,
      discounts,
      payments: order.payments.map((p) => ({
        posPaymentId: p.id,
        paymentMethod: p.paymentMethod,
        status: p.status,
        amount: Number(p.amount),
        tipAmount: Number(p.tipAmount),
        changeAmount: Number(p.changeAmount),
        referenceNumber: p.referenceNumber ?? undefined,
        processedAt: p.processedAt.toISOString(),
      })),
      refunds: order.payments.flatMap((p) =>
        p.refunds.map((r) => ({
          posRefundId: r.id,
          posPaymentId: r.paymentId,
          amount: Number(r.amount),
          reason: r.reason ?? undefined,
          refundMethod: r.refundMethod,
          processedBy: r.processedBy ? portalUserIdMap.get(r.processedBy) : undefined,
          processedAt: r.processedAt.toISOString(),
        })),
      ),
    };

    const result = await this.portalApi.syncOrder(
      deviceIdentifier,
      deviceToken,
      payload,
    );

    if (!result.success) {
      throw new Error(result.error || 'Sync failed');
    }

    // Update order with portal ID
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        portalOrderId: result.portalOrderId,
        syncStatus: 'SYNCED',
        syncedAt: new Date(),
      },
    });
  }

  /**
   * Sync voided order to Portal
   */
  private async syncVoidedOrder(
    orderId: string,
    deviceIdentifier: string,
    deviceToken: string,
  ) {
    // For voided orders, sync the same way as completed orders
    // The Portal will handle the VOIDED status
    await this.syncOrder(orderId, deviceIdentifier, deviceToken);
  }

  /**
   * Sync refund to Portal
   */
  private async syncRefund(
    refundId: string,
    deviceIdentifier: string,
    deviceToken: string,
  ) {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: {
        payment: {
          include: { order: true },
        },
      },
    });

    if (!refund) {
      throw new Error('Refund not found');
    }

    // Re-sync the entire order with the refund included
    await this.syncOrder(refund.orderId, deviceIdentifier, deviceToken);
  }

  /**
   * Sync shift to Portal
   */
  private async syncShift(
    shiftId: string,
    deviceIdentifier: string,
    deviceToken: string,
  ) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: {
        operator: true,
        cashMovements: {
          orderBy: { createdAt: 'asc' },
        },
        _count: {
          select: { orders: true },
        },
      },
    });

    if (!shift) {
      throw new Error('Shift not found');
    }

    const payload: SyncShiftPayload = {
      posShiftId: shift.id,
      posOperatorId: shift.operator.portalUserId,
      status: shift.status,
      openedAt: shift.openedAt.toISOString(),
      closedAt: shift.closedAt?.toISOString(),
      openingCash: Number(shift.openingCash),
      closingCash: shift.closingCash ? Number(shift.closingCash) : undefined,
      expectedCash: shift.expectedCash ? Number(shift.expectedCash) : undefined,
      variance: shift.variance ? Number(shift.variance) : undefined,
      notes: shift.notes ?? undefined,
      cashMovements: shift.cashMovements.map((m) => ({
        movementType: m.movementType,
        amount: Number(m.amount),
        referenceType: m.referenceType ?? undefined,
        referenceId: m.referenceId ?? undefined,
        reason: m.reason ?? undefined,
        performedBy: m.performedBy,
        performedAt: m.performedAt.toISOString(),
      })),
      orderCount: shift._count.orders,
    };

    const result = await this.portalApi.syncShift(
      deviceIdentifier,
      deviceToken,
      payload,
    );

    if (!result.success) {
      throw new Error(result.error || 'Shift sync failed');
    }

    // Update shift with portal ID
    await this.prisma.shift.update({
      where: { id: shiftId },
      data: {
        portalShiftId: result.portalShiftId,
        syncStatus: 'SYNCED',
        syncedAt: new Date(),
      },
    });
  }

  /**
   * Sync Z-Reading to Portal
   */
  private async syncZReading(
    zReadingId: string,
    deviceIdentifier: string,
    deviceToken: string,
  ) {
    const zReading = await this.prisma.zReading.findUnique({
      where: { id: zReadingId },
    });

    if (!zReading) {
      throw new Error('Z-Reading not found');
    }

    const payload: SyncZReadingPayload = {
      posZReadingId: zReading.id,
      zCounterNo: zReading.zCounterNo,
      beginningInvoiceNo: zReading.beginningInvoiceNo,
      endingInvoiceNo: zReading.endingInvoiceNo,
      beginningGrandTotal: Number(zReading.beginningGrandTotal),
      endingGrandTotal: Number(zReading.endingGrandTotal),
      grossSales: Number(zReading.grossSales),
      netSales: Number(zReading.netSales),
      vatableSales: Number(zReading.vatableSales),
      vatAmount: Number(zReading.vatAmount),
      vatExemptSales: Number(zReading.vatExemptSales),
      zeroRatedSales: Number(zReading.zeroRatedSales),
      discountTotal: Number(zReading.discountTotal),
      refundTotal: Number(zReading.refundTotal),
      voidTotal: Number(zReading.voidTotal),
      transactionCount: zReading.transactionCount,
      voidCount: zReading.voidCount,
      refundCount: zReading.refundCount,
      closedBy: zReading.closedBy,
      closedAt: zReading.closedAt.toISOString(),
    };

    const result = await this.portalApi.syncZReading(
      deviceIdentifier,
      deviceToken,
      payload,
    );

    if (!result.success) {
      throw new Error(result.error || 'Z-Reading sync failed');
    }

    // Update Z-Reading with portal ID
    await this.prisma.zReading.update({
      where: { id: zReadingId },
      data: {
        portalZReadingId: result.portalZReadingId,
        syncStatus: 'SYNCED',
        syncedAt: new Date(),
      },
    });
  }

  /**
   * Sync inventory movement to Portal
   */
  private async syncInventoryMovement(
    movementId: string,
    deviceIdentifier: string,
    deviceToken: string,
  ) {
    const movement = await this.prisma.inventoryMovement.findUnique({
      where: { id: movementId },
      include: {
        branchInventory: {
          include: {
            item: { select: { portalId: true } },
          },
        },
      },
    });

    if (!movement) {
      throw new Error('Inventory movement not found');
    }

    if (!movement.branchInventory?.item?.portalId) {
      throw new Error('Item not linked to Portal');
    }

    const payload: SyncInventoryMovementPayload = {
      movementId: movement.movementId,
      itemId: movement.branchInventory.item.portalId,
      movementType: movement.movementType,
      quantity: movement.quantity,
      previousQuantity: movement.previousQuantity,
      newQuantity: movement.newQuantity,
      referenceType: movement.referenceType ?? undefined,
      referenceId: movement.referenceId ?? undefined,
      reason: movement.reason ?? undefined,
      performedBy: movement.performedBy ?? undefined,
      performedAt: movement.performedAt.toISOString(),
    };

    const result = await this.portalApi.syncInventoryMovement(
      deviceIdentifier,
      deviceToken,
      payload,
    );

    if (!result.success) {
      throw new Error(result.error || 'Inventory movement sync failed');
    }

    // Mark movement as synced
    await this.inventoryService.markMovementSynced(movementId);
  }

  /**
   * Get sync queue status
   */
  async getQueueStatus() {
    const [pending, inProgress, completed, failed] = await Promise.all([
      this.prisma.syncQueue.count({ where: { status: 'PENDING' } }),
      this.prisma.syncQueue.count({ where: { status: 'IN_PROGRESS' } }),
      this.prisma.syncQueue.count({ where: { status: 'COMPLETED' } }),
      this.prisma.syncQueue.count({ where: { status: 'FAILED' } }),
    ]);

    return {
      pending,
      inProgress,
      completed,
      failed,
      total: pending + inProgress + completed + failed,
    };
  }

  /**
   * Get failed sync items
   */
  async getFailedItems() {
    return this.prisma.syncQueue.findMany({
      where: { status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Retry failed item
   */
  async retryFailedItem(id: string) {
    await this.prisma.syncQueue.update({
      where: { id },
      data: {
        status: 'PENDING',
        attempts: 0,
        errorMessage: null,
      },
    });

    return { message: 'Item queued for retry' };
  }

  /**
   * Clear completed items older than 7 days
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupOldItems() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const result = await this.prisma.syncQueue.deleteMany({
      where: {
        status: 'COMPLETED',
        createdAt: { lt: sevenDaysAgo },
      },
    });

    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} old sync queue items`);
    }
  }
}
