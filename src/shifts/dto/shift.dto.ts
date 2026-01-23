import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsNotEmpty,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CashMovementType, ShiftStatus } from '@prisma/client';

export class OpenShiftDto {
  @ApiProperty({ description: 'Opening cash amount in drawer' })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  openingCash: number;

  @ApiPropertyOptional({ description: 'Notes for the shift' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CloseShiftDto {
  @ApiProperty({ description: 'Counted cash amount at closing' })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  closingCash: number;

  @ApiPropertyOptional({ description: 'Notes for shift closing' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CashInDto {
  @ApiProperty({ description: 'Amount to add to drawer' })
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  @ApiPropertyOptional({ description: 'Reason for adding cash' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class CashOutDto {
  @ApiProperty({ description: 'Amount to remove from drawer' })
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  @ApiPropertyOptional({ description: 'Reason for removing cash' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class PaidOutDto {
  @ApiProperty({ description: 'Amount paid out' })
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  @ApiProperty({ description: 'Reason for paid out (required)' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class CashDropDto {
  @ApiProperty({ description: 'Amount dropped to safe' })
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  @ApiPropertyOptional({ description: 'Notes for the drop' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ShiftQueryDto {
  @ApiPropertyOptional({ enum: ShiftStatus })
  @IsOptional()
  @IsEnum(ShiftStatus)
  status?: ShiftStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  operatorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number;
}

export class ShiftSummaryDto {
  totalCashSales: number;
  totalCashRefunds: number;
  totalTips: number;
  totalPaidOuts: number;
  totalDrops: number;
  totalCashIn: number;
  totalCashOut: number;
  expectedCash: number;
  orderCount: number;
}

export class CashMovementResponseDto {
  id: string;
  shiftId: string;
  movementType: CashMovementType;
  amount: number;
  referenceType?: string;
  referenceId?: string;
  reason?: string;
  performedBy: string;
  performedAt: Date;
  createdAt: Date;
}
