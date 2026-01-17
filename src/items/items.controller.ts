import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ItemsService } from './items.service';

@ApiTags('Items')
@Controller('items')
@ApiBearerAuth()
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all active items' })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiResponse({ status: 200, description: 'List of items' })
  async findAll(
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
  ) {
    return this.itemsService.findAll({ categoryId, search });
  }

  @Get('search')
  @ApiOperation({ summary: 'Search items by name or SKU' })
  @ApiQuery({ name: 'q', required: true })
  @ApiResponse({ status: 200, description: 'Search results' })
  async search(@Query('q') query: string) {
    return this.itemsService.search(query || '');
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get item statistics' })
  @ApiResponse({ status: 200, description: 'Item statistics' })
  async getStats() {
    return this.itemsService.getStats();
  }

  @Get('sku/:sku')
  @ApiOperation({ summary: 'Get item by SKU' })
  @ApiResponse({ status: 200, description: 'Item details' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  async findBySku(@Param('sku') sku: string) {
    return this.itemsService.findBySku(sku);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get item by ID' })
  @ApiResponse({ status: 200, description: 'Item details' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  async findOne(@Param('id') id: string) {
    return this.itemsService.findOne(id);
  }
}
