import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import {
  CreateOrderDto,
  AddOrderItemDto,
  UpdateOrderItemDto,
  VoidOrderItemDto,
  ApplyDiscountDto,
  UpdateOrderDto,
  VoidOrderDto,
  OrderQueryDto,
} from './dto/order.dto';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';
import { ManagerOnly } from '../auth/decorators/roles.decorator';

@ApiTags('Orders')
@Controller('orders')
@ApiBearerAuth()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new order' })
  @ApiResponse({ status: 201, description: 'Order created' })
  async createOrder(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.ordersService.createOrder(dto, user);
  }

  @Get('open')
  @ApiOperation({ summary: 'Get all open/held orders' })
  @ApiResponse({ status: 200, description: 'List of open orders' })
  async getOpenOrders() {
    return this.ordersService.getOpenOrders();
  }

  @Get('summary/today')
  @ApiOperation({ summary: "Get today's sales summary" })
  @ApiResponse({ status: 200, description: 'Sales summary' })
  async getTodaySummary() {
    return this.ordersService.getTodaySummary();
  }

  @Get()
  @ApiOperation({ summary: 'Get orders with filters' })
  @ApiResponse({ status: 200, description: 'List of orders' })
  async getOrders(@Query() query: OrderQueryDto) {
    return this.ordersService.getOrders(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order by ID' })
  @ApiResponse({ status: 200, description: 'Order details' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async getOrderById(@Param('id') id: string) {
    return this.ordersService.getOrderById(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update order details' })
  @ApiResponse({ status: 200, description: 'Order updated' })
  async updateOrder(
    @Param('id') id: string,
    @Body() dto: UpdateOrderDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.ordersService.updateOrder(id, dto, user);
  }

  @Post(':id/items')
  @ApiOperation({ summary: 'Add item to order' })
  @ApiResponse({ status: 201, description: 'Item added' })
  async addItem(
    @Param('id') id: string,
    @Body() dto: AddOrderItemDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.ordersService.addItem(id, dto, user);
  }

  @Put(':id/items/:itemId')
  @ApiOperation({ summary: 'Update order item' })
  @ApiResponse({ status: 200, description: 'Item updated' })
  async updateItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateOrderItemDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.ordersService.updateItem(id, itemId, dto, user);
  }

  @Delete(':id/items/:itemId')
  @ApiOperation({ summary: 'Remove item from order' })
  @ApiResponse({ status: 200, description: 'Item removed' })
  async removeItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.ordersService.removeItem(id, itemId, user);
  }

  @Post(':id/items/:itemId/void')
  @ManagerOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Void an order item (Manager only)' })
  @ApiResponse({ status: 200, description: 'Item voided' })
  async voidItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: VoidOrderItemDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.ordersService.voidItem(id, itemId, dto, user);
  }

  @Post(':id/discounts')
  @ManagerOnly()
  @ApiOperation({ summary: 'Apply discount to order (Manager only)' })
  @ApiResponse({ status: 201, description: 'Discount applied' })
  async applyDiscount(
    @Param('id') id: string,
    @Body() dto: ApplyDiscountDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.ordersService.applyDiscount(id, dto, user);
  }

  @Delete(':id/discounts/:discountId')
  @ManagerOnly()
  @ApiOperation({ summary: 'Remove discount from order (Manager only)' })
  @ApiResponse({ status: 200, description: 'Discount removed' })
  async removeDiscount(
    @Param('id') id: string,
    @Param('discountId') discountId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.ordersService.removeDiscount(id, discountId, user);
  }

  @Post(':id/hold')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hold/park order for later' })
  @ApiResponse({ status: 200, description: 'Order held' })
  async holdOrder(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.ordersService.holdOrder(id, user);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume a held order' })
  @ApiResponse({ status: 200, description: 'Order resumed' })
  async resumeOrder(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.ordersService.resumeOrder(id, user);
  }

  @Post(':id/void')
  @ManagerOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Void entire order (Manager only)' })
  @ApiResponse({ status: 200, description: 'Order voided' })
  async voidOrder(
    @Param('id') id: string,
    @Body() dto: VoidOrderDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.ordersService.voidOrder(id, dto, user);
  }
}
