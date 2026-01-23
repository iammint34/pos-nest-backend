import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import * as crypto from 'crypto';

const VAT_RATE = 0.12; // 12% VAT

export interface VatBreakdown {
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  zeroRatedSales: number;
}

export interface ReceiptData {
  // Header
  registeredName: string;
  registeredAddress: string;
  vatTin: string;
  min: string;
  ptuNo: string;
  ptuDateIssued: string;
  ptuValidUntil: string;

  // Transaction
  invoiceNumber: string;
  transactionDate: Date;
  cashierName: string;

  // Items
  items: {
    name: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }[];

  // Totals
  subtotal: number;
  discountTotal: number;
  grandTotal: number;

  // VAT Breakdown
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  zeroRatedSales: number;

  // B2B Info (optional)
  customerTin?: string;
  customerBusinessName?: string;
  customerBusinessAddress?: string;

  // Footer
  isVatRegistered: boolean;
}

@Injectable()
export class BirService {
  constructor(private prisma: PrismaService) {}

  /**
   * Calculate VAT breakdown from grand total
   * For VAT-registered businesses, the grand total is VAT-inclusive
   */
  calculateVatBreakdown(
    grandTotal: number,
    isVatRegistered: boolean = true,
    isVatExempt: boolean = false,
    isZeroRated: boolean = false,
  ): VatBreakdown {
    if (!isVatRegistered || isZeroRated) {
      // Zero-rated sales (export, etc.)
      return {
        vatableSales: 0,
        vatAmount: 0,
        vatExemptSales: 0,
        zeroRatedSales: grandTotal,
      };
    }

    if (isVatExempt) {
      // VAT-exempt sales (senior citizen, PWD, etc.)
      return {
        vatableSales: 0,
        vatAmount: 0,
        vatExemptSales: grandTotal,
        zeroRatedSales: 0,
      };
    }

    // Standard VAT calculation (VAT-inclusive)
    // grandTotal = vatableSales + vatAmount
    // grandTotal = vatableSales * 1.12
    // vatableSales = grandTotal / 1.12
    const vatableSales = Number((grandTotal / (1 + VAT_RATE)).toFixed(2));
    const vatAmount = Number((grandTotal - vatableSales).toFixed(2));

    return {
      vatableSales,
      vatAmount,
      vatExemptSales: 0,
      zeroRatedSales: 0,
    };
  }

  /**
   * Get next invoice number (sequential, non-resettable)
   * Format: SI-XXXXXX (e.g., SI-000001)
   */
  async getNextInvoiceNumber(): Promise<string> {
    // Use a transaction to ensure atomicity
    const result = await this.prisma.$transaction(async (tx) => {
      const config = await tx.deviceConfig.findFirst();
      if (!config) {
        throw new BadRequestException('Device not configured');
      }

      const nextNumber = config.nextInvoiceNumber;

      // Update the counter
      await tx.deviceConfig.update({
        where: { id: config.id },
        data: { nextInvoiceNumber: nextNumber + 1 },
      });

      // Format as SI-XXXXXX
      return `SI-${String(nextNumber).padStart(6, '0')}`;
    });

    return result;
  }

  /**
   * Update grand total accumulator (non-resettable)
   */
  async updateGrandTotal(
    orderId: string,
    invoiceNumber: string,
    amount: number,
    transactionType: 'SALE' | 'VOID' | 'REFUND',
  ): Promise<Decimal> {
    // Determine the adjustment amount
    let adjustment = amount;
    if (transactionType === 'VOID' || transactionType === 'REFUND') {
      adjustment = -amount; // Subtract for voids and refunds
    }

    // Use a transaction to ensure atomicity
    const result = await this.prisma.$transaction(async (tx) => {
      const config = await tx.deviceConfig.findFirst();
      if (!config) {
        throw new BadRequestException('Device not configured');
      }

      const currentTotal = Number(config.grandTotalAccum);
      const newTotal = currentTotal + adjustment;

      // Update the accumulator
      await tx.deviceConfig.update({
        where: { id: config.id },
        data: { grandTotalAccum: newTotal },
      });

      // Create an immutable log entry
      await tx.grandTotalLog.create({
        data: {
          orderId,
          invoiceNumber,
          amount: adjustment,
          runningTotal: newTotal,
          transactionType,
        },
      });

      return new Decimal(newTotal);
    });

    return result;
  }

  /**
   * Create electronic journal entry (immutable receipt archive)
   */
  async createJournalEntry(
    orderId: string,
    invoiceNumber: string,
    transactionType: 'SALE' | 'VOID' | 'REFUND',
    receiptData: ReceiptData,
    operatorId: string,
    operatorName: string,
  ): Promise<void> {
    // Serialize receipt data to JSON
    const receiptContent = JSON.stringify(receiptData);

    // Create SHA-256 hash for integrity verification
    const receiptHash = crypto
      .createHash('sha256')
      .update(receiptContent)
      .digest('hex');

    await this.prisma.electronicJournal.create({
      data: {
        orderId,
        invoiceNumber,
        transactionType,
        receiptContent,
        receiptHash,
        grandTotal: receiptData.grandTotal,
        vatAmount: receiptData.vatAmount,
        operatorId,
        operatorName,
        transactionDate: receiptData.transactionDate,
      },
    });
  }

  /**
   * Get device BIR configuration
   */
  async getDeviceBirConfig() {
    const config = await this.prisma.deviceConfig.findFirst();
    if (!config) {
      throw new BadRequestException('Device not configured');
    }

    return {
      registeredName: config.registeredName || config.storeName || '',
      registeredAddress: config.registeredAddress || '',
      vatTin: config.vatTin || '',
      isVatRegistered: config.isVatRegistered,
      min: config.min || '',
      serialNumber: config.serialNumber || '',
      permitNumber: config.permitNumber || '',
      ptuNo: config.ptuNo || '',
      ptuDateIssued: config.ptuDateIssued || '',
      ptuValidUntil: config.ptuValidUntil || 'No Expiry',
      accreditationNo: config.accreditationNo || '',
      grandTotalAccum: Number(config.grandTotalAccum),
      nextInvoiceNumber: config.nextInvoiceNumber,
      zCounterNo: config.zCounterNo,
    };
  }

  /**
   * Get today's first invoice number (for Z-Reading)
   */
  async getTodayFirstInvoice(): Promise<string | null> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const firstOrder = await this.prisma.order.findFirst({
      where: {
        invoiceNumber: { not: null },
        createdAt: { gte: today },
        status: 'COMPLETED',
      },
      orderBy: { createdAt: 'asc' },
      select: { invoiceNumber: true },
    });

    return firstOrder?.invoiceNumber || null;
  }

  /**
   * Get today's last invoice number (for Z-Reading)
   */
  async getTodayLastInvoice(): Promise<string | null> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lastOrder = await this.prisma.order.findFirst({
      where: {
        invoiceNumber: { not: null },
        createdAt: { gte: today },
        status: 'COMPLETED',
      },
      orderBy: { createdAt: 'desc' },
      select: { invoiceNumber: true },
    });

    return lastOrder?.invoiceNumber || null;
  }

  /**
   * Generate Z-Reading (End-of-Day Close)
   */
  async generateZReading(closedBy: string): Promise<any> {
    const config = await this.prisma.deviceConfig.findFirst();
    if (!config) {
      throw new BadRequestException('Device not configured');
    }

    // Get the last Z-Reading to determine beginning values
    const lastZReading = await this.prisma.zReading.findFirst({
      orderBy: { zCounterNo: 'desc' },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get today's completed orders
    const todayOrders = await this.prisma.order.findMany({
      where: {
        status: 'COMPLETED',
        closedAt: { gte: today },
      },
    });

    // Get today's voided orders
    const voidedOrders = await this.prisma.order.findMany({
      where: {
        status: 'VOIDED',
        updatedAt: { gte: today },
      },
    });

    // Get today's refunds
    const refunds = await this.prisma.refund.findMany({
      where: {
        createdAt: { gte: today },
      },
    });

    // Calculate totals
    const grossSales = todayOrders.reduce((sum, o) => sum + Number(o.grandTotal), 0);
    const vatableSales = todayOrders.reduce((sum, o) => sum + Number(o.vatableSales), 0);
    const vatAmount = todayOrders.reduce((sum, o) => sum + Number(o.vatAmount), 0);
    const vatExemptSales = todayOrders.reduce((sum, o) => sum + Number(o.vatExemptSales), 0);
    const zeroRatedSales = todayOrders.reduce((sum, o) => sum + Number(o.zeroRatedSales), 0);
    const discountTotal = todayOrders.reduce((sum, o) => sum + Number(o.discountTotal), 0);

    const voidTotal = voidedOrders.reduce((sum, o) => sum + Number(o.grandTotal), 0);
    const refundTotal = refunds.reduce((sum, r) => sum + Number(r.amount), 0);

    const netSales = grossSales - refundTotal;

    // Get invoice range
    const beginningInvoiceNo = await this.getTodayFirstInvoice() || 'N/A';
    const endingInvoiceNo = await this.getTodayLastInvoice() || 'N/A';

    // Grand total tracking
    const beginningGrandTotal = lastZReading
      ? Number(lastZReading.endingGrandTotal)
      : 0;
    const endingGrandTotal = Number(config.grandTotalAccum);

    // Z-Counter (increments with each Z-Reading)
    const newZCounterNo = config.zCounterNo + 1;

    // Create Z-Reading record and queue for sync
    const zReading = await this.prisma.$transaction(async (tx) => {
      // Update Z-Counter in config
      await tx.deviceConfig.update({
        where: { id: config.id },
        data: { zCounterNo: newZCounterNo },
      });

      // Create Z-Reading
      const newZReading = await tx.zReading.create({
        data: {
          zCounterNo: newZCounterNo,
          beginningInvoiceNo,
          endingInvoiceNo,
          beginningGrandTotal,
          endingGrandTotal,
          grossSales,
          netSales,
          vatableSales,
          vatAmount,
          vatExemptSales,
          zeroRatedSales,
          discountTotal,
          refundTotal,
          voidTotal,
          transactionCount: todayOrders.length,
          voidCount: voidedOrders.length,
          refundCount: refunds.length,
          closedBy,
          closedAt: new Date(),
        },
      });

      // Queue Z-Reading for sync to Portal
      await tx.syncQueue.create({
        data: {
          operation: 'SYNC_ZREADING',
          entityType: 'ZReading',
          entityId: newZReading.id,
          payload: JSON.stringify(newZReading),
        },
      });

      return newZReading;
    });

    return zReading;
  }

  /**
   * Verify electronic journal integrity
   */
  async verifyJournalIntegrity(journalId: string): Promise<boolean> {
    const entry = await this.prisma.electronicJournal.findUnique({
      where: { id: journalId },
    });

    if (!entry) {
      return false;
    }

    // Recalculate hash
    const calculatedHash = crypto
      .createHash('sha256')
      .update(entry.receiptContent)
      .digest('hex');

    return calculatedHash === entry.receiptHash;
  }
}
