import {
  IsString,
  IsOptional,
  IsNumber,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

// Nested item DTO
export class RewardsTransactionItemDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  amount: number;
}

// DTOs for the desktop app → POS backend communication

export class CreateRewardsTransactionDto {
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @IsString()
  @IsNotEmpty()
  orderNumber: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsString()
  cashierName?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RewardsTransactionItemDto)
  items: RewardsTransactionItemDto[];
}

export class VerifyRedemptionDto {
  @IsString()
  @IsNotEmpty()
  redemptionId: string;
}

// Response types returned by the POS backend to the desktop app

export interface RewardsStatusResponse {
  enabled: boolean;
}

export interface RewardsTransactionResponse {
  success: boolean;
  qrImage?: string; // base64 data URL
  qrExpiresAt?: string; // ISO date
  pointsEarned?: number;
  error?: string;
}

export interface RewardsRedemptionResponse {
  success: boolean;
  redemptionId?: string;
  rewardName?: string;
  rewardType?: string;
  customerFirstName?: string;
  customerLastName?: string;
  pointsSpent?: number;
  status?: string;
  error?: string;
}
