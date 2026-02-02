import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MovementType, MovementSyncStatus } from '@prisma/client';
import { AdjustInventoryDto, AdjustmentType } from './dto/adjust-inventory.dto';
import { randomUUID } from 'crypto';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Deduct stock when an order is completed (SOLD movement)
   */
  async deductStock(
    itemId: string,
    quantity: number,
    orderId: string,
    userId?: string,
  ) {
    const inventory = await this.getOrCreateInventory(itemId);

    if (!inventory.isTracked) {
      this.logger.debug(`Inventory not tracked for item ${itemId}, skipping deduction`);
      return null;
    }

    const previousQuantity = inventory.currentQuantity;
    const newQuantity = Math.max(0, previousQuantity - quantity);

    const [updatedInventory, movement] = await this.prisma.$transaction([
      this.prisma.branchInventory.update({
        where: { id: inventory.id },
        data: { currentQuantity: newQuantity },
      }),
      this.prisma.inventoryMovement.create({
        data: {
          movementId: randomUUID(),
          branchInventoryId: inventory.id,
          itemId,
          movementType: MovementType.SOLD,
          quantity,
          previousQuantity,
          newQuantity,
          referenceType: 'ORDER',
          referenceId: orderId,
          performedBy: userId,
          performedAt: new Date(),
          syncStatus: MovementSyncStatus.PENDING,
        },
      }),
    ]);

    // Add to sync queue
    await this.queueMovementForSync(movement.id);

    this.logger.log(`Deducted ${quantity} from item ${itemId}, new qty: ${newQuantity}`);

    return { inventory: updatedInventory, movement };
  }

  /**
   * Restore stock when order is voided or refunded
   */
  async restoreStock(
    itemId: string,
    quantity: number,
    type: 'VOIDED_SALE' | 'REFUNDED',
    referenceId: string,
    userId?: string,
  ) {
    const inventory = await this.getOrCreateInventory(itemId);

    if (!inventory.isTracked) {
      this.logger.debug(`Inventory not tracked for item ${itemId}, skipping restoration`);
      return null;
    }

    const previousQuantity = inventory.currentQuantity;
    const newQuantity = previousQuantity + quantity;
    const movementType = type === 'VOIDED_SALE' ? MovementType.VOIDED_SALE : MovementType.REFUNDED;

    const [updatedInventory, movement] = await this.prisma.$transaction([
      this.prisma.branchInventory.update({
        where: { id: inventory.id },
        data: { currentQuantity: newQuantity },
      }),
      this.prisma.inventoryMovement.create({
        data: {
          movementId: randomUUID(),
          branchInventoryId: inventory.id,
          itemId,
          movementType,
          quantity,
          previousQuantity,
          newQuantity,
          referenceType: type === 'VOIDED_SALE' ? 'VOID' : 'REFUND',
          referenceId,
          performedBy: userId,
          performedAt: new Date(),
          syncStatus: MovementSyncStatus.PENDING,
        },
      }),
    ]);

    // Add to sync queue
    await this.queueMovementForSync(movement.id);

    this.logger.log(`Restored ${quantity} to item ${itemId}, new qty: ${newQuantity}`);

    return { inventory: updatedInventory, movement };
  }

  /**
   * Manual inventory adjustment (for wastage, corrections, etc.)
   */
  async adjustInventory(dto: AdjustInventoryDto, userId?: string) {
    const inventory = await this.getOrCreateInventory(dto.itemId);

    const previousQuantity = inventory.currentQuantity;
    let newQuantity: number;
    let movementType: MovementType;

    switch (dto.adjustmentType) {
      case AdjustmentType.ADJUSTED_UP:
        newQuantity = previousQuantity + dto.quantity;
        movementType = MovementType.ADJUSTED_UP;
        break;
      case AdjustmentType.ADJUSTED_DOWN:
        newQuantity = Math.max(0, previousQuantity - dto.quantity);
        movementType = MovementType.ADJUSTED_DOWN;
        break;
      case AdjustmentType.WASTED:
        newQuantity = Math.max(0, previousQuantity - dto.quantity);
        movementType = MovementType.WASTED;
        break;
    }

    const [updatedInventory, movement] = await this.prisma.$transaction([
      this.prisma.branchInventory.update({
        where: { id: inventory.id },
        data: { currentQuantity: newQuantity },
      }),
      this.prisma.inventoryMovement.create({
        data: {
          movementId: randomUUID(),
          branchInventoryId: inventory.id,
          itemId: dto.itemId,
          movementType,
          quantity: dto.quantity,
          previousQuantity,
          newQuantity,
          referenceType: 'ADJUSTMENT',
          reason: dto.reason,
          performedBy: userId,
          performedAt: new Date(),
          syncStatus: MovementSyncStatus.PENDING,
        },
      }),
    ]);

    // Add to sync queue
    await this.queueMovementForSync(movement.id);

    return { inventory: updatedInventory, movement };
  }

  /**
   * Get or create inventory record for an item
   */
  async getOrCreateInventory(itemId: string) {
    // First try to find existing inventory
    let inventory = await this.prisma.branchInventory.findUnique({
      where: { itemId },
    });

    if (!inventory) {
      // Create new inventory record
      inventory = await this.prisma.branchInventory.create({
        data: {
          itemId,
          currentQuantity: 0,
          isTracked: true,
        },
      });
      this.logger.log(`Created new inventory record for item ${itemId}`);
    }

    return inventory;
  }

  /**
   * Get inventory for an item
   */
  async getInventory(itemId: string) {
    return this.prisma.branchInventory.findUnique({
      where: { itemId },
      include: {
        item: { select: { id: true, name: true, sku: true, portalId: true } },
      },
    });
  }

  /**
   * Get all inventory with low stock
   */
  async getLowStockItems() {
    const inventory = await this.prisma.branchInventory.findMany({
      where: {
        isTracked: true,
        lowStockThreshold: { not: null },
      },
      include: {
        item: { select: { id: true, name: true, sku: true } },
      },
    });

    return inventory.filter(
      (inv) => inv.lowStockThreshold !== null && inv.currentQuantity <= inv.lowStockThreshold,
    );
  }

  /**
   * Get movement history for an item
   */
  async getMovementHistory(itemId: string, options: { page?: number; limit?: number } = {}) {
    const inventory = await this.prisma.branchInventory.findUnique({
      where: { itemId },
    });

    if (!inventory) {
      throw new NotFoundException('Inventory not found for this item');
    }

    const { page = 1, limit = 50 } = options;

    const [movements, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where: { branchInventoryId: inventory.id },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { performedAt: 'desc' },
      }),
      this.prisma.inventoryMovement.count({
        where: { branchInventoryId: inventory.id },
      }),
    ]);

    return {
      data: movements,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update inventory from portal sync
   */
  async upsertFromSync(data: {
    portalId: string;
    itemId: string;
    currentQuantity: number;
    lowStockThreshold?: number;
    isTracked: boolean;
  }) {
    // Find item by portalId first
    const item = await this.prisma.item.findUnique({
      where: { portalId: data.itemId },
    });

    if (!item) {
      this.logger.warn(`Item not found for portalId ${data.itemId}, skipping inventory sync`);
      return null;
    }

    return this.prisma.branchInventory.upsert({
      where: { itemId: item.id },
      create: {
        portalId: data.portalId,
        itemId: item.id,
        currentQuantity: data.currentQuantity,
        lowStockThreshold: data.lowStockThreshold,
        isTracked: data.isTracked,
        syncedAt: new Date(),
      },
      update: {
        portalId: data.portalId,
        lowStockThreshold: data.lowStockThreshold,
        isTracked: data.isTracked,
        syncedAt: new Date(),
        // Note: We don't update currentQuantity from portal sync as POS is source of truth for stock
      },
    });
  }

  /**
   * Get pending movements for sync
   */
  async getPendingMovements() {
    return this.prisma.inventoryMovement.findMany({
      where: { syncStatus: MovementSyncStatus.PENDING },
      include: {
        branchInventory: {
          include: {
            item: { select: { portalId: true } },
          },
        },
      },
      orderBy: { performedAt: 'asc' },
      take: 100, // Batch size
    });
  }

  /**
   * Mark movement as synced
   */
  async markMovementSynced(movementId: string) {
    return this.prisma.inventoryMovement.update({
      where: { id: movementId },
      data: {
        syncStatus: MovementSyncStatus.SYNCED,
        syncedAt: new Date(),
      },
    });
  }

  /**
   * Mark movement as failed
   */
  async markMovementFailed(movementId: string) {
    return this.prisma.inventoryMovement.update({
      where: { id: movementId },
      data: {
        syncStatus: MovementSyncStatus.FAILED,
      },
    });
  }

  /**
   * Queue movement for sync to portal
   */
  private async queueMovementForSync(movementId: string) {
    await this.prisma.syncQueue.create({
      data: {
        operation: 'SYNC_INVENTORY_MOVEMENT',
        entityType: 'InventoryMovement',
        entityId: movementId,
        payload: JSON.stringify({ movementId }),
        status: 'PENDING',
      },
    });
  }
}
