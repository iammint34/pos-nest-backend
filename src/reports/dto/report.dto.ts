import { IsOptional, IsDateString, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class DateRangeDto {
  @ApiPropertyOptional({ description: 'Start date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class ReportQueryDto extends DateRangeDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 50;
}

export enum ExportFormat {
  JSON = 'json',
  CSV = 'csv',
}

export class ExportQueryDto extends DateRangeDto {
  @ApiPropertyOptional({ enum: ExportFormat, default: ExportFormat.JSON })
  @IsOptional()
  @IsEnum(ExportFormat)
  format?: ExportFormat = ExportFormat.JSON;
}

// Response DTOs
export class SalesSummaryDto {
  totalOrders: number;
  completedOrders: number;
  voidedOrders: number;
  grossSales: number;
  totalDiscounts: number;
  totalRefunds: number;
  netSales: number;
  totalTax: number;
  // VAT Breakdown
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  zeroRatedSales: number;
  // Payment breakdown
  cashSales: number;
  cardSales: number;
  otherSales: number;
  // Averages
  averageOrderValue: number;
  // Period
  periodStart: string;
  periodEnd: string;
}

export class XReadingDto extends SalesSummaryDto {
  generatedAt: string;
  cashierName?: string;
  shiftId?: string;
  openingCash?: number;
  expectedCash?: number;
  // Transaction counts
  firstTransaction?: string;
  lastTransaction?: string;
  transactionCount: number;
}

export class SalesByCategoryDto {
  categoryId: string;
  categoryName: string;
  itemCount: number;
  quantitySold: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  percentage: number;
}

export class SalesByItemDto {
  itemId: string;
  itemName: string;
  itemSku?: string;
  categoryName?: string;
  quantitySold: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  averagePrice: number;
}

export class SalesByPaymentMethodDto {
  paymentMethod: string;
  transactionCount: number;
  totalAmount: number;
  tipAmount: number;
  percentage: number;
}

export class SalesByHourDto {
  hour: number; // 0-23
  hourLabel: string; // "9:00 AM - 10:00 AM"
  orderCount: number;
  totalSales: number;
  itemsSold: number;
}

export class TransactionDto {
  id: string;
  orderNumber: string;
  invoiceNumber?: string;
  orderType: string;
  status: string;
  customerName?: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
  itemCount: number;
  paymentMethod?: string;
  cashierName?: string;
  createdAt: string;
  closedAt?: string;
}

export class VoidedTransactionDto {
  id: string;
  orderNumber: string;
  invoiceNumber?: string;
  originalTotal: number;
  voidReason?: string;
  voidedBy?: string;
  voidedAt: string;
  cashierName?: string;
  itemCount: number;
}

export class DiscountReportDto {
  discountId: string;
  discountName: string;
  discountType: string;
  discountScope: string;
  timesApplied: number;
  totalDiscountAmount: number;
  ordersAffected: number;
}

export class RefundReportDto {
  id: string;
  orderId: string;
  orderNumber: string;
  paymentMethod: string;
  refundMethod: string;
  amount: number;
  reason?: string;
  processedBy?: string;
  processedAt: string;
}

export class ShiftReportDto {
  id: string;
  operatorId: string;
  operatorName: string;
  status: string;
  openedAt: string;
  closedAt?: string;
  duration?: string;
  openingCash: number;
  closingCash?: number;
  expectedCash: number;
  variance?: number;
  // Sales summary
  orderCount: number;
  totalSales: number;
  cashSales: number;
  cardSales: number;
  // Cash movements
  totalCashIn: number;
  totalCashOut: number;
  totalPaidOuts: number;
  totalDrops: number;
  totalRefunds: number;
}

export class PaginatedResponseDto<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
