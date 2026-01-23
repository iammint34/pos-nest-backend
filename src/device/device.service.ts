import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PortalApiService } from '../portal-api/portal-api.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { randomUUID } from 'crypto';

@Injectable()
export class DeviceService {
  constructor(
    private prisma: PrismaService,
    private portalApi: PortalApiService,
  ) {}

  /**
   * Get device identifier - creates one if it doesn't exist
   */
  private async getOrCreateDeviceIdentifier(): Promise<string> {
    const existing = await this.prisma.deviceConfig.findFirst();
    if (existing) {
      return existing.deviceIdentifier;
    }
    return randomUUID();
  }

  /**
   * Register device with Portal using registration code
   */
  async registerDevice(dto: RegisterDeviceDto) {
    const deviceIdentifier = await this.getOrCreateDeviceIdentifier();

    // Call Portal API to register device
    const registrationResult = await this.portalApi.registerDevice(
      dto.registrationCode,
      deviceIdentifier,
      dto.deviceName,
    );

    // Upsert device config
    const deviceConfig = await this.prisma.deviceConfig.upsert({
      where: { deviceIdentifier },
      create: {
        deviceIdentifier,
        deviceName: dto.deviceName,
        storeId: registrationResult.storeId,
        storeName: registrationResult.storeName,
        branchId: registrationResult.branchId,
        branchName: registrationResult.branchName,
        deviceToken: registrationResult.deviceToken,
        tokenExpiresAt: registrationResult.tokenExpiresAt
          ? new Date(registrationResult.tokenExpiresAt)
          : null,
        isRegistered: true,
      },
      update: {
        deviceName: dto.deviceName,
        storeId: registrationResult.storeId,
        storeName: registrationResult.storeName,
        branchId: registrationResult.branchId,
        branchName: registrationResult.branchName,
        deviceToken: registrationResult.deviceToken,
        tokenExpiresAt: registrationResult.tokenExpiresAt
          ? new Date(registrationResult.tokenExpiresAt)
          : null,
        isRegistered: true,
      },
    });

    return {
      id: deviceConfig.id,
      deviceIdentifier: deviceConfig.deviceIdentifier,
      deviceName: deviceConfig.deviceName,
      storeId: deviceConfig.storeId,
      storeName: deviceConfig.storeName,
      branchId: deviceConfig.branchId,
      branchName: deviceConfig.branchName,
      isRegistered: deviceConfig.isRegistered,
      lastSyncAt: deviceConfig.lastSyncAt,
    };
  }

  /**
   * Get current device configuration
   */
  async getDeviceConfig() {
    const config = await this.prisma.deviceConfig.findFirst();
    if (!config) {
      throw new NotFoundException('Device not registered');
    }
    // Debug: log what's in the database
    console.log('[DEBUG device.service] Raw config from DB:', JSON.stringify({
      vatTin: config.vatTin,
      min: config.min,
      serialNumber: config.serialNumber,
      permitNumber: config.permitNumber,
      ptuNo: config.ptuNo,
      registeredName: config.registeredName,
      registeredAddress: config.registeredAddress,
    }, null, 2));
    return {
      id: config.id,
      deviceIdentifier: config.deviceIdentifier,
      deviceName: config.deviceName,
      storeId: config.storeId,
      storeName: config.storeName,
      branchId: config.branchId,
      branchName: config.branchName,
      isRegistered: config.isRegistered,
      lastSyncAt: config.lastSyncAt,
      // BIR Compliance Fields
      registeredName: config.registeredName,
      registeredAddress: config.registeredAddress,
      vatTin: config.vatTin,
      min: config.min,
      serialNumber: config.serialNumber,
      permitNumber: config.permitNumber,
      ptuNo: config.ptuNo,
      ptuDateIssued: config.ptuDateIssued,
      ptuValidUntil: config.ptuValidUntil,
      accreditationNo: config.accreditationNo,
      isVatRegistered: config.isVatRegistered,
      nextInvoiceNumber: config.nextInvoiceNumber,
      grandTotalAccum: config.grandTotalAccum ? Number(config.grandTotalAccum) : 0,
      zCounterNo: config.zCounterNo,
    };
  }

  /**
   * Check if device is registered
   */
  async isRegistered(): Promise<boolean> {
    const config = await this.prisma.deviceConfig.findFirst();
    return config?.isRegistered ?? false;
  }

  /**
   * Get device token for API calls
   */
  async getDeviceToken(): Promise<string | null> {
    const config = await this.prisma.deviceConfig.findFirst();
    return config?.deviceToken ?? null;
  }

  /**
   * Get device identifier for API calls
   */
  async getDeviceIdentifier(): Promise<string | null> {
    const config = await this.prisma.deviceConfig.findFirst();
    return config?.deviceIdentifier ?? null;
  }

  /**
   * Update last sync timestamp and version
   */
  async updateLastSyncAt(version?: number) {
    const config = await this.prisma.deviceConfig.findFirst();
    if (config) {
      const updateData: { lastSyncAt: Date; lastSyncVersion?: number } = {
        lastSyncAt: new Date(),
      };
      if (version !== undefined) {
        updateData.lastSyncVersion = version;
      }
      await this.prisma.deviceConfig.update({
        where: { id: config.id },
        data: updateData,
      });
    }
  }

  /**
   * Get last sync version
   */
  async getLastSyncVersion(): Promise<number | null> {
    const config = await this.prisma.deviceConfig.findFirst();
    return config?.lastSyncVersion ?? null;
  }

  /**
   * Unregister device (for testing/reset)
   */
  async unregisterDevice() {
    const config = await this.prisma.deviceConfig.findFirst();
    if (!config) {
      throw new NotFoundException('Device not registered');
    }

    // Optionally notify Portal
    try {
      await this.portalApi.unregisterDevice(
        config.deviceIdentifier,
        config.deviceToken,
      );
    } catch (error) {
      // Continue even if Portal API fails
    }

    await this.prisma.deviceConfig.delete({
      where: { id: config.id },
    });

    return { message: 'Device unregistered successfully' };
  }
}
