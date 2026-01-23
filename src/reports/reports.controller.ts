import {
  Controller,
  Get,
  Query,
  Param,
  UseGuards,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { AuthGuard } from '../auth/guards';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';
import {
  DateRangeDto,
  ReportQueryDto,
  ExportQueryDto,
  ExportFormat,
} from './dto/report.dto';

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  // ==================== X-READING ====================

  @Get('x-reading')
  @ApiOperation({ summary: 'Get X-Reading (current day summary)' })
  async getXReading(@CurrentUser() user: CurrentUserData) {
    return this.reportsService.getXReading(user.userId);
  }

  // ==================== SALES REPORTS ====================

  @Get('sales/daily')
  @ApiOperation({ summary: 'Get daily sales summary' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getDailySales(@Query() dto: DateRangeDto) {
    return this.reportsService.getDailySales(dto);
  }

  @Get('sales/by-category')
  @ApiOperation({ summary: 'Get sales breakdown by category' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getSalesByCategory(@Query() dto: DateRangeDto) {
    return this.reportsService.getSalesByCategory(dto);
  }

  @Get('sales/by-item')
  @ApiOperation({ summary: 'Get sales breakdown by item' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getSalesByItem(@Query() dto: ReportQueryDto) {
    return this.reportsService.getSalesByItem(dto);
  }

  @Get('sales/by-payment-method')
  @ApiOperation({ summary: 'Get sales breakdown by payment method' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getSalesByPaymentMethod(@Query() dto: DateRangeDto) {
    return this.reportsService.getSalesByPaymentMethod(dto);
  }

  @Get('sales/hourly')
  @ApiOperation({ summary: 'Get hourly sales breakdown' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getSalesByHour(@Query() dto: DateRangeDto) {
    return this.reportsService.getSalesByHour(dto);
  }

  // ==================== TRANSACTION REPORTS ====================

  @Get('transactions')
  @ApiOperation({ summary: 'Get transaction history' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getTransactions(@Query() dto: ReportQueryDto) {
    return this.reportsService.getTransactions(dto);
  }

  @Get('voids')
  @ApiOperation({ summary: 'Get voided transactions' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getVoidedTransactions(@Query() dto: ReportQueryDto) {
    return this.reportsService.getVoidedTransactions(dto);
  }

  @Get('discounts')
  @ApiOperation({ summary: 'Get discount report' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getDiscountReport(@Query() dto: DateRangeDto) {
    return this.reportsService.getDiscountReport(dto);
  }

  @Get('refunds')
  @ApiOperation({ summary: 'Get refund report' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getRefundReport(@Query() dto: ReportQueryDto) {
    return this.reportsService.getRefundReport(dto);
  }

  // ==================== SHIFT REPORTS ====================

  @Get('shifts')
  @ApiOperation({ summary: 'Get shift history' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getShiftHistory(@Query() dto: ReportQueryDto) {
    return this.reportsService.getShiftHistory(dto);
  }

  @Get('shifts/:id')
  @ApiOperation({ summary: 'Get detailed shift report' })
  async getShiftReport(@Param('id') id: string) {
    return this.reportsService.getShiftReport(id);
  }

  // ==================== Z-READING REPORTS ====================

  @Get('z-readings')
  @ApiOperation({ summary: 'Get Z-Reading history' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getZReadingHistory(@Query() dto: ReportQueryDto) {
    return this.reportsService.getZReadingHistory(dto);
  }

  // ==================== EXPORT ENDPOINTS ====================

  @Get('sales/daily/export')
  @ApiOperation({ summary: 'Export daily sales to CSV' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'format', required: false, enum: ExportFormat })
  async exportDailySales(@Query() dto: ExportQueryDto, @Res() res: Response) {
    const data = await this.reportsService.getDailySales(dto);

    if (dto.format === ExportFormat.CSV) {
      const csv = this.reportsService.exportToCsv([data], [
        { key: 'periodStart', header: 'Period Start' },
        { key: 'periodEnd', header: 'Period End' },
        { key: 'totalOrders', header: 'Total Orders' },
        { key: 'completedOrders', header: 'Completed Orders' },
        { key: 'voidedOrders', header: 'Voided Orders' },
        { key: 'grossSales', header: 'Gross Sales' },
        { key: 'totalDiscounts', header: 'Total Discounts' },
        { key: 'totalRefunds', header: 'Total Refunds' },
        { key: 'netSales', header: 'Net Sales' },
        { key: 'totalTax', header: 'Total Tax' },
        { key: 'vatableSales', header: 'VATable Sales' },
        { key: 'vatAmount', header: 'VAT Amount' },
        { key: 'vatExemptSales', header: 'VAT Exempt Sales' },
        { key: 'zeroRatedSales', header: 'Zero Rated Sales' },
        { key: 'cashSales', header: 'Cash Sales' },
        { key: 'cardSales', header: 'Card Sales' },
        { key: 'otherSales', header: 'Other Sales' },
        { key: 'averageOrderValue', header: 'Average Order Value' },
      ]);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=daily-sales-${dto.startDate || 'today'}.csv`);
      return res.send(csv);
    }

    return res.json(data);
  }

  @Get('sales/by-category/export')
  @ApiOperation({ summary: 'Export sales by category to CSV' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'format', required: false, enum: ExportFormat })
  async exportSalesByCategory(@Query() dto: ExportQueryDto, @Res() res: Response) {
    const data = await this.reportsService.getSalesByCategory(dto);

    if (dto.format === ExportFormat.CSV) {
      const csv = this.reportsService.exportToCsv(data, [
        { key: 'categoryName', header: 'Category' },
        { key: 'itemCount', header: 'Items' },
        { key: 'quantitySold', header: 'Quantity Sold' },
        { key: 'grossSales', header: 'Gross Sales' },
        { key: 'discounts', header: 'Discounts' },
        { key: 'netSales', header: 'Net Sales' },
        { key: 'percentage', header: 'Percentage (%)' },
      ]);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=sales-by-category-${dto.startDate || 'today'}.csv`);
      return res.send(csv);
    }

    return res.json(data);
  }

  @Get('sales/by-item/export')
  @ApiOperation({ summary: 'Export sales by item to CSV' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'format', required: false, enum: ExportFormat })
  async exportSalesByItem(@Query() dto: ExportQueryDto, @Res() res: Response) {
    // Get all items without pagination for export
    const result = await this.reportsService.getSalesByItem({ ...dto, limit: 10000 });

    if (dto.format === ExportFormat.CSV) {
      const csv = this.reportsService.exportToCsv(result.data, [
        { key: 'itemName', header: 'Item Name' },
        { key: 'itemSku', header: 'SKU' },
        { key: 'categoryName', header: 'Category' },
        { key: 'quantitySold', header: 'Quantity Sold' },
        { key: 'grossSales', header: 'Gross Sales' },
        { key: 'discounts', header: 'Discounts' },
        { key: 'netSales', header: 'Net Sales' },
        { key: 'averagePrice', header: 'Average Price' },
      ]);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=sales-by-item-${dto.startDate || 'today'}.csv`);
      return res.send(csv);
    }

    return res.json(result);
  }

  @Get('transactions/export')
  @ApiOperation({ summary: 'Export transactions to CSV' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'format', required: false, enum: ExportFormat })
  async exportTransactions(@Query() dto: ExportQueryDto, @Res() res: Response) {
    // Get all transactions without pagination for export
    const result = await this.reportsService.getTransactions({ ...dto, limit: 10000 });

    if (dto.format === ExportFormat.CSV) {
      const csv = this.reportsService.exportToCsv(result.data, [
        { key: 'orderNumber', header: 'Order #' },
        { key: 'invoiceNumber', header: 'Invoice #' },
        { key: 'createdAt', header: 'Date/Time' },
        { key: 'orderType', header: 'Order Type' },
        { key: 'status', header: 'Status' },
        { key: 'customerName', header: 'Customer' },
        { key: 'itemCount', header: 'Items' },
        { key: 'subtotal', header: 'Subtotal' },
        { key: 'discountTotal', header: 'Discount' },
        { key: 'taxTotal', header: 'Tax' },
        { key: 'grandTotal', header: 'Total' },
        { key: 'paymentMethod', header: 'Payment Method' },
        { key: 'cashierName', header: 'Cashier' },
      ]);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=transactions-${dto.startDate || 'today'}.csv`);
      return res.send(csv);
    }

    return res.json(result);
  }

  @Get('z-readings/export')
  @ApiOperation({ summary: 'Export Z-Readings to CSV' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'format', required: false, enum: ExportFormat })
  async exportZReadings(@Query() dto: ExportQueryDto, @Res() res: Response) {
    const result = await this.reportsService.getZReadingHistory({ ...dto, limit: 1000 });

    if (dto.format === ExportFormat.CSV) {
      const csv = this.reportsService.exportToCsv(result.data, [
        { key: 'zCounterNo', header: 'Z Counter' },
        { key: 'readingDate', header: 'Date' },
        { key: 'beginningInvoice', header: 'Beginning Invoice' },
        { key: 'endingInvoice', header: 'Ending Invoice' },
        { key: 'transactionCount', header: 'Transactions' },
        { key: 'grossSales', header: 'Gross Sales' },
        { key: 'totalDiscounts', header: 'Discounts' },
        { key: 'totalRefunds', header: 'Refunds' },
        { key: 'totalVoids', header: 'Voids' },
        { key: 'netSales', header: 'Net Sales' },
        { key: 'vatableSales', header: 'VATable Sales' },
        { key: 'vatAmount', header: 'VAT Amount' },
        { key: 'vatExemptSales', header: 'VAT Exempt' },
        { key: 'zeroRatedSales', header: 'Zero Rated' },
        { key: 'openingGrandTotal', header: 'Opening GT' },
        { key: 'closingGrandTotal', header: 'Closing GT' },
      ]);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=z-readings-${dto.startDate || 'all'}.csv`);
      return res.send(csv);
    }

    return res.json(result);
  }
}
