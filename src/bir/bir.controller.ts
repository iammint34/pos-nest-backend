import {
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { BirService } from './bir.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from '../auth/guards/auth.guard';

@Controller('bir')
@UseGuards(AuthGuard)
export class BirController {
  constructor(
    private readonly birService: BirService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Get device BIR configuration
   */
  @Get('config')
  async getConfig() {
    return this.birService.getDeviceBirConfig();
  }

  /**
   * Generate Z-Reading (End-of-Day Close)
   * This should be called at the end of business day
   */
  @Post('z-reading')
  async generateZReading(@Request() req: any) {
    // Get the portal user ID for syncing to portal
    let closedBy = 'system';
    if (req.user?.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { portalUserId: true, firstName: true, lastName: true },
      });
      // Use portalUserId for portal sync, with name as fallback display
      closedBy = user?.portalUserId || `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'system';
    }
    return this.birService.generateZReading(closedBy);
  }

  /**
   * Get all Z-Readings (for reporting)
   */
  @Get('z-readings')
  async getZReadings(@Query('limit') limit?: string) {
    return this.prisma.zReading.findMany({
      orderBy: { closedAt: 'desc' },
      take: limit ? parseInt(limit) : 100,
    });
  }

  /**
   * Get electronic journal entries (for audit)
   */
  @Get('journal')
  async getJournalEntries(
    @Query('limit') limit?: string,
    @Query('date') date?: string,
  ) {
    const where: any = {};

    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);

      where.transactionDate = {
        gte: startDate,
        lte: endDate,
      };
    }

    return this.prisma.electronicJournal.findMany({
      where,
      orderBy: { transactionDate: 'desc' },
      take: limit ? parseInt(limit) : 100,
    });
  }

  /**
   * Get grand total log (for audit trail)
   */
  @Get('grand-total-log')
  async getGrandTotalLog(@Query('limit') limit?: string) {
    return this.prisma.grandTotalLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit ? parseInt(limit) : 100,
    });
  }

  /**
   * Verify journal entry integrity
   */
  @Get('journal/verify/:id')
  async verifyJournalEntry(@Query('id') id: string) {
    const isValid = await this.birService.verifyJournalIntegrity(id);
    return { id, isValid };
  }
}
