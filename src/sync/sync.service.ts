import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PortalApiService } from '../portal-api/portal-api.service';
import { DeviceService } from '../device/device.service';
import {
  PortalUser,
  PortalCategory,
  PortalItem,
  DeletedRecord,
  PortalBirConfig,
} from '../portal-api/portal-api.types';

export interface SyncStatus {
  lastSyncAt: Date | null;
  isOnline: boolean;
  pendingOrders: number;
}

export interface SyncStats {
  created: number;
  updated: number;
  deleted: number;
  errors: number;
}

export interface SyncResult {
  success: boolean;
  version?: number;
  usersSync: SyncStats;
  categoriesSync: SyncStats;
  itemsSync: SyncStats;
  syncedAt: Date;
  errorMessage?: string;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private isSyncing = false;

  constructor(
    private prisma: PrismaService,
    private portalApi: PortalApiService,
    private deviceService: DeviceService,
    private configService: ConfigService,
  ) {}

  /**
   * Get current sync status
   */
  async getSyncStatus(): Promise<SyncStatus> {
    const isRegistered = await this.deviceService.isRegistered();

    if (!isRegistered) {
      return {
        lastSyncAt: null,
        isOnline: false,
        pendingOrders: 0,
      };
    }

    const deviceConfig = await this.prisma.deviceConfig.findFirst();
    const isOnline = await this.portalApi.checkConnectivity();
    const pendingOrders = await this.prisma.syncQueue.count({
      where: { status: 'PENDING' },
    });

    return {
      lastSyncAt: deviceConfig?.lastSyncAt ?? null,
      isOnline,
      pendingOrders,
    };
  }

  /**
   * Manually trigger full sync
   */
  async triggerSync(): Promise<SyncResult> {
    if (this.isSyncing) {
      throw new BadRequestException('Sync already in progress');
    }

    return this.performSync();
  }

  /**
   * Scheduled sync task
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async scheduledSync() {
    const syncInterval = this.configService.get<number>(
      'SYNC_INTERVAL_MS',
      60000,
    );

    // Check if enough time has passed since last sync
    const deviceConfig = await this.prisma.deviceConfig.findFirst();
    if (deviceConfig?.lastSyncAt) {
      const timeSinceLastSync = Date.now() - deviceConfig.lastSyncAt.getTime();
      if (timeSinceLastSync < syncInterval) {
        return;
      }
    }

    if (this.isSyncing) {
      return;
    }

    try {
      await this.performSync();
    } catch (error) {
      this.logger.error(`Scheduled sync failed: ${error.message}`);
    }
  }

  /**
   * Perform full sync from Portal
   */
  private async performSync(): Promise<SyncResult> {
    this.isSyncing = true;
    const syncStartedAt = new Date();

    const result: SyncResult = {
      success: false,
      usersSync: { created: 0, updated: 0, deleted: 0, errors: 0 },
      categoriesSync: { created: 0, updated: 0, deleted: 0, errors: 0 },
      itemsSync: { created: 0, updated: 0, deleted: 0, errors: 0 },
      syncedAt: syncStartedAt,
    };

    try {
      const isRegistered = await this.deviceService.isRegistered();
      if (!isRegistered) {
        result.errorMessage = 'Device not registered';
        await this.logSync(
          'PORTAL_TO_POS',
          'ALL',
          'FAILED',
          result.errorMessage,
          syncStartedAt,
        );
        return result;
      }

      const deviceIdentifier = await this.deviceService.getDeviceIdentifier();
      const deviceToken = await this.deviceService.getDeviceToken();

      if (!deviceIdentifier || !deviceToken) {
        result.errorMessage = 'Missing device credentials';
        await this.logSync(
          'PORTAL_TO_POS',
          'ALL',
          'FAILED',
          result.errorMessage,
          syncStartedAt,
        );
        return result;
      }

      // Always do a full sync to get all data
      // Fetch sync data from Portal
      const syncData = await this.portalApi.fetchSyncData(
        deviceIdentifier,
        deviceToken,
        {
          syncType: 'FULL',
          // Don't send lastVersion or lastSyncAt to ensure full sync
        },
      );

      this.logger.log(
        `Portal sync response: success=${syncData.success}, version=${syncData.version}, users=${syncData.users?.length ?? 0}, categories=${syncData.categories?.length ?? 0}, items=${syncData.items?.length ?? 0}`,
      );

      // Debug: log first item if any
      if (syncData.items && syncData.items.length > 0) {
        this.logger.log(
          `First item sample: ${JSON.stringify(syncData.items[0])}`,
        );
      } else {
        this.logger.warn(
          'No items returned from Portal - check if items exist in Portal with isActive=true',
        );
      }

      if (!syncData.success) {
        result.errorMessage = 'Portal sync returned unsuccessful response';
        await this.logSync(
          'PORTAL_TO_POS',
          'ALL',
          'FAILED',
          result.errorMessage,
          syncStartedAt,
        );
        return result;
      }

      // Sync users (upserts)
      if (syncData.users && syncData.users.length > 0) {
        result.usersSync = await this.syncUsers(syncData.users);
      }

      // Handle deleted users
      if (syncData.deletedUsers && syncData.deletedUsers.length > 0) {
        result.usersSync.deleted = await this.handleDeletedUsers(
          syncData.deletedUsers,
        );
      }

      // Sync categories (upserts)
      if (syncData.categories && syncData.categories.length > 0) {
        result.categoriesSync = await this.syncCategories(syncData.categories);
      }

      // Handle deleted categories
      if (syncData.deletedCategories && syncData.deletedCategories.length > 0) {
        result.categoriesSync.deleted = await this.handleDeletedCategories(
          syncData.deletedCategories,
        );
      }

      // Sync items (upserts)
      if (syncData.items && syncData.items.length > 0) {
        result.itemsSync = await this.syncItems(syncData.items);
      }

      // Handle deleted items
      if (syncData.deletedItems && syncData.deletedItems.length > 0) {
        result.itemsSync.deleted = await this.handleDeletedItems(
          syncData.deletedItems,
        );
      }

      // Sync BIR configuration from Portal
      if (syncData.birConfig) {
        await this.syncBirConfig(syncData.birConfig, syncData.storeName, syncData.branchName);
        this.logger.log('BIR configuration synced from Portal');
      }

      // Update last sync timestamp and version
      await this.deviceService.updateLastSyncAt(syncData.version);

      result.success = true;
      result.version = syncData.version;
      result.syncedAt = new Date();

      const totalItems =
        result.usersSync.created +
        result.usersSync.updated +
        result.usersSync.deleted +
        result.categoriesSync.created +
        result.categoriesSync.updated +
        result.categoriesSync.deleted +
        result.itemsSync.created +
        result.itemsSync.updated +
        result.itemsSync.deleted;

      await this.logSync(
        'PORTAL_TO_POS',
        'ALL',
        'SUCCESS',
        null,
        syncStartedAt,
        totalItems,
      );

      this.logger.log(
        `Sync completed (v${syncData.version}): ` +
          `Users(+${result.usersSync.created}/~${result.usersSync.updated}/-${result.usersSync.deleted}), ` +
          `Categories(+${result.categoriesSync.created}/~${result.categoriesSync.updated}/-${result.categoriesSync.deleted}), ` +
          `Items(+${result.itemsSync.created}/~${result.itemsSync.updated}/-${result.itemsSync.deleted})`,
      );
    } catch (error) {
      result.errorMessage = error.message;
      this.logger.error(`Sync failed: ${error.message}`);
      await this.logSync(
        'PORTAL_TO_POS',
        'ALL',
        'FAILED',
        error.message,
        syncStartedAt,
      );
    } finally {
      this.isSyncing = false;
    }

    return result;
  }

  /**
   * Sync users from Portal
   */
  private async syncUsers(users: PortalUser[]): Promise<SyncStats> {
    const stats: SyncStats = { created: 0, updated: 0, deleted: 0, errors: 0 };

    for (const portalUser of users) {
      try {
        const existingUser = await this.prisma.user.findUnique({
          where: { portalUserId: portalUser.id },
        });

        if (existingUser) {
          await this.prisma.user.update({
            where: { id: existingUser.id },
            data: {
              email: portalUser.email,
              passwordHash: portalUser.passwordHash,
              firstName: portalUser.firstName,
              lastName: portalUser.lastName,
              role: portalUser.role,
              pin: portalUser.pin,
              isActive: portalUser.isActive,
              syncedAt: new Date(),
            },
          });
          stats.updated++;
        } else {
          await this.prisma.user.create({
            data: {
              portalUserId: portalUser.id,
              email: portalUser.email,
              passwordHash: portalUser.passwordHash,
              firstName: portalUser.firstName,
              lastName: portalUser.lastName,
              role: portalUser.role,
              pin: portalUser.pin,
              isActive: portalUser.isActive,
              syncedAt: new Date(),
            },
          });
          stats.created++;
        }
      } catch (error) {
        this.logger.error(
          `Failed to sync user ${portalUser.id}: ${error.message}`,
        );
        stats.errors++;
      }
    }

    return stats;
  }

  /**
   * Handle deleted/deactivated users from Portal
   */
  private async handleDeletedUsers(
    deletedUsers: DeletedRecord[],
  ): Promise<number> {
    let deletedCount = 0;

    for (const deleted of deletedUsers) {
      try {
        const user = await this.prisma.user.findUnique({
          where: { portalUserId: deleted.id },
        });

        if (user) {
          // Soft delete by setting isActive to false
          await this.prisma.user.update({
            where: { id: user.id },
            data: {
              isActive: false,
              syncedAt: new Date(),
            },
          });
          deletedCount++;
        }
      } catch (error) {
        this.logger.error(
          `Failed to handle deleted user ${deleted.id}: ${error.message}`,
        );
      }
    }

    return deletedCount;
  }

  /**
   * Sync categories from Portal
   */
  private async syncCategories(
    categories: PortalCategory[],
  ): Promise<SyncStats> {
    const stats: SyncStats = { created: 0, updated: 0, deleted: 0, errors: 0 };

    for (const portalCategory of categories) {
      try {
        const existingCategory = await this.prisma.category.findUnique({
          where: { portalId: portalCategory.id },
        });

        if (existingCategory) {
          await this.prisma.category.update({
            where: { id: existingCategory.id },
            data: {
              name: portalCategory.name,
              description: portalCategory.description,
              sortOrder: portalCategory.sortOrder,
              isActive: portalCategory.isActive,
              syncedAt: new Date(),
            },
          });
          stats.updated++;
        } else {
          await this.prisma.category.create({
            data: {
              portalId: portalCategory.id,
              name: portalCategory.name,
              description: portalCategory.description,
              sortOrder: portalCategory.sortOrder,
              isActive: portalCategory.isActive,
              syncedAt: new Date(),
            },
          });
          stats.created++;
        }
      } catch (error) {
        this.logger.error(
          `Failed to sync category ${portalCategory.id}: ${error.message}`,
        );
        stats.errors++;
      }
    }

    return stats;
  }

  /**
   * Handle deleted/deactivated categories from Portal
   */
  private async handleDeletedCategories(
    deletedCategories: DeletedRecord[],
  ): Promise<number> {
    let deletedCount = 0;

    for (const deleted of deletedCategories) {
      try {
        const category = await this.prisma.category.findUnique({
          where: { portalId: deleted.id },
        });

        if (category) {
          // Soft delete by setting isActive to false
          await this.prisma.category.update({
            where: { id: category.id },
            data: {
              isActive: false,
              syncedAt: new Date(),
            },
          });
          deletedCount++;
        }
      } catch (error) {
        this.logger.error(
          `Failed to handle deleted category ${deleted.id}: ${error.message}`,
        );
      }
    }

    return deletedCount;
  }

  /**
   * Sync items from Portal
   */
  private async syncItems(items: PortalItem[]): Promise<SyncStats> {
    const stats: SyncStats = { created: 0, updated: 0, deleted: 0, errors: 0 };

    for (const portalItem of items) {
      try {
        // Find local category by portal ID
        let localCategoryId: string | null = null;
        if (portalItem.categoryId) {
          const category = await this.prisma.category.findUnique({
            where: { portalId: portalItem.categoryId },
          });
          localCategoryId = category?.id ?? null;
        }

        const existingItem = await this.prisma.item.findUnique({
          where: { portalId: portalItem.id },
        });

        if (existingItem) {
          await this.prisma.item.update({
            where: { id: existingItem.id },
            data: {
              categoryId: localCategoryId,
              sku: portalItem.sku,
              name: portalItem.name,
              description: portalItem.description,
              price: portalItem.price,
              isActive: portalItem.isActive,
              isAvailable: portalItem.isAvailable,
              version: portalItem.version,
              syncedAt: new Date(),
            },
          });
          stats.updated++;
        } else {
          await this.prisma.item.create({
            data: {
              portalId: portalItem.id,
              categoryId: localCategoryId,
              sku: portalItem.sku,
              name: portalItem.name,
              description: portalItem.description,
              price: portalItem.price,
              isActive: portalItem.isActive,
              isAvailable: portalItem.isAvailable,
              version: portalItem.version,
              syncedAt: new Date(),
            },
          });
          stats.created++;
        }
      } catch (error) {
        this.logger.error(
          `Failed to sync item ${portalItem.id}: ${error.message}`,
        );
        stats.errors++;
      }
    }

    return stats;
  }

  /**
   * Handle deleted/deactivated items from Portal
   */
  private async handleDeletedItems(
    deletedItems: DeletedRecord[],
  ): Promise<number> {
    let deletedCount = 0;

    for (const deleted of deletedItems) {
      try {
        const item = await this.prisma.item.findUnique({
          where: { portalId: deleted.id },
        });

        if (item) {
          // Soft delete by setting isActive to false
          await this.prisma.item.update({
            where: { id: item.id },
            data: {
              isActive: false,
              isAvailable: false,
              syncedAt: new Date(),
            },
          });
          deletedCount++;
        }
      } catch (error) {
        this.logger.error(
          `Failed to handle deleted item ${deleted.id}: ${error.message}`,
        );
      }
    }

    return deletedCount;
  }

  /**
   * Sync BIR configuration from Portal
   */
  private async syncBirConfig(
    birConfig: PortalBirConfig,
    storeName?: string,
    branchName?: string,
  ): Promise<void> {
    try {
      const deviceConfig = await this.prisma.deviceConfig.findFirst();

      if (!deviceConfig) {
        this.logger.warn('No device config found, cannot sync BIR config');
        return;
      }

      await this.prisma.deviceConfig.update({
        where: { id: deviceConfig.id },
        data: {
          // Store-level BIR info
          storeName: storeName || deviceConfig.storeName,
          branchName: branchName || deviceConfig.branchName,
          registeredName: birConfig.registeredName || deviceConfig.registeredName,
          registeredAddress: birConfig.registeredAddress || deviceConfig.registeredAddress,
          vatTin: birConfig.vatTin || deviceConfig.vatTin,
          isVatRegistered: birConfig.isVatRegistered,
          // Branch-level PTU info
          ptuNo: birConfig.ptuNo || deviceConfig.ptuNo,
          ptuDateIssued: birConfig.ptuDateIssued || deviceConfig.ptuDateIssued,
          ptuValidUntil: birConfig.ptuValidUntil || deviceConfig.ptuValidUntil,
          accreditationNo: birConfig.accreditationNo || deviceConfig.accreditationNo,
          // Device-level MIN info
          min: birConfig.min || deviceConfig.min,
          serialNumber: birConfig.serialNumber || deviceConfig.serialNumber,
          permitNumber: birConfig.permitNumber || deviceConfig.permitNumber,
        },
      });

      this.logger.log(
        `BIR config synced: PTU=${birConfig.ptuNo}, MIN=${birConfig.min}, VAT TIN=${birConfig.vatTin}`,
      );
    } catch (error) {
      this.logger.error(`Failed to sync BIR config: ${error.message}`);
    }
  }

  /**
   * Log sync operation
   */
  private async logSync(
    direction: 'PORTAL_TO_POS' | 'POS_TO_PORTAL',
    syncType: string,
    status: 'SUCCESS' | 'FAILED' | 'PARTIAL',
    errorMessage: string | null,
    startedAt: Date,
    itemCount?: number,
  ): Promise<void> {
    await this.prisma.syncLog.create({
      data: {
        direction,
        syncType,
        status,
        errorMessage,
        startedAt,
        completedAt: new Date(),
        itemCount,
      },
    });
  }

  /**
   * Get sync history
   */
  async getSyncHistory(limit: number = 20) {
    return this.prisma.syncLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
