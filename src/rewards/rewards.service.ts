import { Injectable, Logger, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateRewardsTransactionDto,
  RewardsTransactionResponse,
  RewardsRedemptionResponse,
} from './rewards.types';

@Injectable()
export class RewardsService {
  private readonly logger = new Logger(RewardsService.name);
  private readonly client: AxiosInstance;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    const baseURL = this.configService.get<string>(
      'REWARDS_API_URL',
      'https://api-staging.chixinasal.com/api/v1',
    );
    const apiKey = this.configService.get<string>('REWARDS_API_KEY', '');

    this.client = axios.create({
      baseURL,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
    });
  }

  /**
   * Check if rewards integration is enabled
   */
  isEnabled(): boolean {
    return (
      this.configService.get<string>('REWARDS_ENABLED', 'false') === 'true'
    );
  }

  /**
   * Create a rewards transaction (earn points).
   * Never throws — returns { success: false, error } so payment flow isn't blocked.
   */
  async createTransaction(
    dto: CreateRewardsTransactionDto,
  ): Promise<RewardsTransactionResponse> {
    if (!this.isEnabled()) {
      return { success: false, error: 'Rewards not enabled' };
    }

    try {
      // Get branch code from device config
      const deviceConfig = await this.prisma.deviceConfig.findFirst();
      const branchCode = deviceConfig?.branchId || '';

      const payload = {
        posTransactionRef: dto.orderId,
        orderAmount: dto.amount,
        branchCode,
        items: dto.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          price: item.amount,
        })),
      };

      const response = await this.requestWithRetry(() =>
        this.client.post('/transactions', payload),
      );

      const data = response.data?.data || response.data;
      return {
        success: true,
        qrImage: data.qrImage,
        qrExpiresAt: data.qrCode?.expiresAt,
        pointsEarned: data.pointsEarned,
      };
    } catch (error) {
      // 409 Conflict = duplicate / idempotent — treat as success.
      // Per API docs, 409 returns { statusCode, message, error } with no data/QR.
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        this.logger.log(
          `Rewards transaction duplicate for order ${dto.orderId} (409)`,
        );
        return { success: true };
      }

      const message = this.getErrorMessage(error);
      this.logger.error(
        `Rewards transaction failed for order ${dto.orderId}: ${message}`,
      );
      return { success: false, error: message };
    }
  }

  /**
   * Verify a reward redemption.
   * Throws on error — the cashier needs the result before proceeding.
   */
  async verifyRedemption(
    redemptionId: string,
  ): Promise<RewardsRedemptionResponse> {
    if (!this.isEnabled()) {
      throw new HttpException('Rewards not enabled', 400);
    }

    try {
      const response = await this.client.post(
        `/redemptions/${redemptionId}/verify`,
      );

      const data = response.data?.data || response.data;
      return {
        success: true,
        redemptionId,
        rewardName: data.reward?.name,
        rewardType: data.reward?.type,
        customerFirstName: data.customer?.firstName,
        customerLastName: data.customer?.lastName,
        pointsSpent: data.pointsSpent,
        status: data.status,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.logger.error(
        `Rewards redemption verification failed for ${redemptionId}: ${message}`,
      );
      throw new HttpException(
        message,
        axios.isAxiosError(error) ? error.response?.status || 500 : 500,
      );
    }
  }

  /**
   * Exponential backoff retry for 5xx errors (3 retries: 5s, 10s, 20s)
   */
  private async requestWithRetry<T>(
    fn: () => Promise<T>,
    retries = 3,
  ): Promise<T> {
    const delays = [5000, 10000, 20000];

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const is5xx =
          axios.isAxiosError(error) &&
          error.response?.status &&
          error.response.status >= 500;

        if (!is5xx || attempt === retries) {
          throw error;
        }

        const delay = delays[attempt] || 20000;
        this.logger.warn(
          `Rewards API 5xx error, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${retries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Should never reach here, but TypeScript needs it
    throw new Error('Max retries exceeded');
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
