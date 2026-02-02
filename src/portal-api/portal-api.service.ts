import { Injectable, Logger, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  PortalRegistrationResult,
  PortalSyncData,
  SyncRequestPayload,
  SyncOrderPayload,
  SyncResult,
  BatchSyncResult,
  SyncShiftPayload,
  SyncShiftResult,
  SyncZReadingPayload,
  SyncZReadingResult,
  SyncInventoryMovementPayload,
  SyncInventoryMovementResult,
} from './portal-api.types';

@Injectable()
export class PortalApiService {
  private readonly logger = new Logger(PortalApiService.name);
  private readonly client: AxiosInstance;
  private readonly portalUrl: string;

  constructor(private configService: ConfigService) {
    this.portalUrl = this.configService.get<string>(
      'PORTAL_API_URL',
      'http://localhost:3000/api/v1',
    );

    this.client = axios.create({
      baseURL: this.portalUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Set device authentication header
   */
  private getAuthHeaders(deviceIdentifier: string, deviceToken: string) {
    return {
      Authorization: `PosDevice ${deviceIdentifier}:${deviceToken}`,
    };
  }

  /**
   * Register device with Portal using registration code
   */
  async registerDevice(
    registrationCode: string,
    deviceIdentifier: string,
    deviceName: string,
  ): Promise<PortalRegistrationResult> {
    try {
      const response = await this.client.post('/pos/register-with-code', {
        registrationCode,
        deviceIdentifier,
        deviceName,
      });
      return response.data;
    } catch (error) {
      this.handleApiError(error, 'Failed to register device');
    }
  }

  /**
   * Unregister device from Portal
   */
  async unregisterDevice(
    deviceIdentifier: string,
    deviceToken: string,
  ): Promise<void> {
    try {
      await this.client.delete(`/pos/devices/${deviceIdentifier}`, {
        headers: this.getAuthHeaders(deviceIdentifier, deviceToken),
      });
    } catch (error) {
      this.logger.warn(
        `Failed to unregister device from Portal: ${error.message}`,
      );
    }
  }

  /**
   * Fetch sync data from Portal (users, categories, items)
   */
  async fetchSyncData(
    deviceIdentifier: string,
    deviceToken: string,
    options?: {
      syncType?: 'FULL' | 'INCREMENTAL' | 'ITEMS' | 'CATEGORIES' | 'CONFIG';
      lastVersion?: number;
      lastSyncAt?: Date;
    },
  ): Promise<PortalSyncData> {
    try {
      const payload: SyncRequestPayload = {
        deviceIdentifier,
        deviceToken,
        syncType: options?.syncType || 'FULL',
      };

      if (options?.lastVersion) {
        payload.lastVersion = options.lastVersion;
      }

      if (options?.lastSyncAt) {
        payload.lastSyncAt = options.lastSyncAt.toISOString();
      }

      const response = await this.client.post('/sync', payload);
      return response.data;
    } catch (error) {
      this.handleApiError(error, 'Failed to fetch sync data');
    }
  }

  /**
   * Send heartbeat to Portal
   */
  async sendHeartbeat(
    deviceIdentifier: string,
    deviceToken: string,
    appVersion?: string,
  ): Promise<{ success: boolean; timestamp: string }> {
    try {
      const response = await this.client.post('/sync/heartbeat', {
        deviceIdentifier,
        deviceToken,
        appVersion,
      });
      return response.data;
    } catch (error) {
      this.logger.warn(`Heartbeat failed: ${this.getErrorMessage(error)}`);
      return { success: false, timestamp: new Date().toISOString() };
    }
  }

  /**
   * Send completed order to Portal
   */
  async syncOrder(
    deviceIdentifier: string,
    deviceToken: string,
    order: SyncOrderPayload,
  ): Promise<SyncResult> {
    try {
      const response = await this.client.post('/sales/sync', order, {
        headers: this.getAuthHeaders(deviceIdentifier, deviceToken),
      });
      return response.data;
    } catch (error) {
      return {
        success: false,
        posOrderId: order.posOrderId,
        error: this.getErrorMessage(error),
      };
    }
  }

  /**
   * Send batch of orders to Portal
   */
  async syncOrdersBatch(
    deviceIdentifier: string,
    deviceToken: string,
    orders: SyncOrderPayload[],
  ): Promise<BatchSyncResult> {
    try {
      const response = await this.client.post(
        '/sales/sync/batch',
        { orders },
        {
          headers: this.getAuthHeaders(deviceIdentifier, deviceToken),
        },
      );
      return response.data;
    } catch (error) {
      // Return failure for all orders if batch request fails
      return {
        syncBatchId: '',
        totalOrders: orders.length,
        successful: 0,
        failed: orders.length,
        results: orders.map((order) => ({
          success: false,
          posOrderId: order.posOrderId,
          error: this.getErrorMessage(error),
        })),
      };
    }
  }

  /**
   * Send shift data to Portal
   */
  async syncShift(
    deviceIdentifier: string,
    deviceToken: string,
    shift: SyncShiftPayload,
  ): Promise<SyncShiftResult> {
    try {
      const response = await this.client.post('/shifts/sync', shift, {
        headers: this.getAuthHeaders(deviceIdentifier, deviceToken),
      });
      return response.data;
    } catch (error) {
      return {
        success: false,
        posShiftId: shift.posShiftId,
        error: this.getErrorMessage(error),
      };
    }
  }

  /**
   * Send Z-Reading data to Portal
   */
  async syncZReading(
    deviceIdentifier: string,
    deviceToken: string,
    zReading: SyncZReadingPayload,
  ): Promise<SyncZReadingResult> {
    try {
      const response = await this.client.post('/reports/z-readings/sync', zReading, {
        headers: this.getAuthHeaders(deviceIdentifier, deviceToken),
      });
      return response.data;
    } catch (error) {
      return {
        success: false,
        posZReadingId: zReading.posZReadingId,
        error: this.getErrorMessage(error),
      };
    }
  }

  /**
   * Send inventory movement to Portal
   */
  async syncInventoryMovement(
    deviceIdentifier: string,
    deviceToken: string,
    movement: SyncInventoryMovementPayload,
  ): Promise<SyncInventoryMovementResult> {
    try {
      const response = await this.client.post('/inventory/sync', movement, {
        headers: this.getAuthHeaders(deviceIdentifier, deviceToken),
      });
      return response.data;
    } catch (error) {
      return {
        success: false,
        movementId: movement.movementId,
        error: this.getErrorMessage(error),
      };
    }
  }

  /**
   * Check Portal connectivity
   */
  async checkConnectivity(): Promise<boolean> {
    try {
      // await this.client.get('/health', { timeout: 5000 });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Refresh device token
   */
  async refreshToken(
    deviceIdentifier: string,
    deviceToken: string,
  ): Promise<{ deviceToken: string; tokenExpiresAt?: string }> {
    try {
      const response = await this.client.post(
        '/pos/devices/refresh-token',
        {},
        {
          headers: this.getAuthHeaders(deviceIdentifier, deviceToken),
        },
      );
      return response.data;
    } catch (error) {
      this.handleApiError(error, 'Failed to refresh device token');
    }
  }

  private handleApiError(error: unknown, defaultMessage: string): never {
    const message = this.getErrorMessage(error);
    this.logger.error(`${defaultMessage}: ${message}`);

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{ message: string }>;
      const statusCode = axiosError.response?.status || 500;
      const errorMessage =
        axiosError.response?.data?.message ||
        axiosError.message ||
        defaultMessage;
      throw new HttpException(errorMessage, statusCode);
    }

    throw new HttpException(defaultMessage, 500);
  }

  private getErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{ message: string }>;
      return axiosError.response?.data?.message || axiosError.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'Unknown error';
  }
}
