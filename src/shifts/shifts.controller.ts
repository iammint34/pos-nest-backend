import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ShiftsService } from './shifts.service';
import {
  OpenShiftDto,
  CloseShiftDto,
  CashInDto,
  CashOutDto,
  PaidOutDto,
  CashDropDto,
  ShiftQueryDto,
} from './dto/shift.dto';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { ManagerOnly } from '../auth/decorators/roles.decorator';

@ApiTags('Shifts')
@Controller('shifts')
@ApiBearerAuth()
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Post('open')
  @ApiOperation({ summary: 'Open a new shift' })
  @ApiResponse({ status: 201, description: 'Shift opened' })
  @ApiResponse({ status: 400, description: 'Already has open shift' })
  async openShift(
    @Body() dto: OpenShiftDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.shiftsService.openShift(dto, user);
  }

  @Post('close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close the current shift' })
  @ApiResponse({ status: 200, description: 'Shift closed with summary' })
  @ApiResponse({ status: 400, description: 'No open shift found' })
  async closeShift(
    @Body() dto: CloseShiftDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.shiftsService.closeShift(dto, user);
  }

  @Get('current')
  @ApiOperation({ summary: 'Get current open shift' })
  @ApiResponse({ status: 200, description: 'Current shift or null' })
  async getCurrentShift(@CurrentUser() user: CurrentUserData) {
    return this.shiftsService.getCurrentShift(user.userId);
  }

  @Post('cash-in')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record cash added to drawer' })
  @ApiResponse({ status: 200, description: 'Cash movement recorded' })
  async cashIn(@Body() dto: CashInDto, @CurrentUser() user: CurrentUserData) {
    return this.shiftsService.cashIn(dto, user);
  }

  @Post('cash-out')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record cash removed from drawer' })
  @ApiResponse({ status: 200, description: 'Cash movement recorded' })
  async cashOut(@Body() dto: CashOutDto, @CurrentUser() user: CurrentUserData) {
    return this.shiftsService.cashOut(dto, user);
  }

  @Post('paid-out')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record paid out (requires reason)' })
  @ApiResponse({ status: 200, description: 'Paid out recorded' })
  async paidOut(@Body() dto: PaidOutDto, @CurrentUser() user: CurrentUserData) {
    return this.shiftsService.paidOut(dto, user);
  }

  @Post('cash-drop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record cash drop to safe' })
  @ApiResponse({ status: 200, description: 'Cash drop recorded' })
  async cashDrop(
    @Body() dto: CashDropDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.shiftsService.cashDrop(dto, user);
  }

  @Get()
  @ManagerOnly()
  @ApiOperation({ summary: 'Get shifts with filters (Manager only)' })
  @ApiResponse({ status: 200, description: 'List of shifts' })
  async getShifts(@Query() query: ShiftQueryDto) {
    return this.shiftsService.getShifts(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get shift by ID' })
  @ApiResponse({ status: 200, description: 'Shift details' })
  @ApiResponse({ status: 404, description: 'Shift not found' })
  async getShiftById(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.shiftsService.getShiftById(id, user);
  }

  @Get(':id/movements')
  @ApiOperation({ summary: 'Get cash movements for shift' })
  @ApiResponse({ status: 200, description: 'List of cash movements' })
  async getMovements(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.shiftsService.getMovements(id, user);
  }

  @Get(':id/summary')
  @ApiOperation({ summary: 'Get shift summary' })
  @ApiResponse({ status: 200, description: 'Shift summary' })
  async getShiftSummary(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.shiftsService.getShiftSummary(id, user);
  }
}
