import { Controller, Get, Post, Body } from '@nestjs/common';
import { RewardsService } from './rewards.service';
import {
  CreateRewardsTransactionDto,
  VerifyRedemptionDto,
  RewardsStatusResponse,
  RewardsTransactionResponse,
  RewardsRedemptionResponse,
} from './rewards.types';

@Controller('rewards')
export class RewardsController {
  constructor(private readonly rewardsService: RewardsService) {}

  @Get('status')
  getStatus(): RewardsStatusResponse {
    return { enabled: this.rewardsService.isEnabled() };
  }

  @Post('transaction')
  createTransaction(
    @Body() dto: CreateRewardsTransactionDto,
  ): Promise<RewardsTransactionResponse> {
    return this.rewardsService.createTransaction(dto);
  }

  @Post('redemptions/verify')
  verifyRedemption(
    @Body() dto: VerifyRedemptionDto,
  ): Promise<RewardsRedemptionResponse> {
    return this.rewardsService.verifyRedemption(dto.redemptionId);
  }
}
