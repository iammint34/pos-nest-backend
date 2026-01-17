import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ItemsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get all active items
   */
  async findAll(options?: { categoryId?: string; search?: string }) {
    const where: any = { isActive: true };

    if (options?.categoryId) {
      if (options.categoryId === 'uncategorized') {
        where.categoryId = null;
      } else {
        where.categoryId = options.categoryId;
      }
    }

    if (options?.search) {
      where.OR = [
        { name: { contains: options.search } },
        { sku: { contains: options.search } },
        { description: { contains: options.search } },
      ];
    }

    return this.prisma.item.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  /**
   * Get item by ID
   */
  async findOne(id: string) {
    const item = await this.prisma.item.findUnique({
      where: { id },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('Item not found');
    }

    return item;
  }

  /**
   * Search items by name or SKU
   */
  async search(query: string) {
    return this.prisma.item.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: query } },
          { sku: { contains: query } },
        ],
      },
      orderBy: { name: 'asc' },
      take: 20,
      select: {
        id: true,
        portalId: true,
        sku: true,
        name: true,
        description: true,
        price: true,
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  /**
   * Get item by SKU
   */
  async findBySku(sku: string) {
    const item = await this.prisma.item.findFirst({
      where: { sku, isActive: true },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('Item not found');
    }

    return item;
  }

  /**
   * Get item statistics
   */
  async getStats() {
    const [totalItems, activeItems, categoriesCount] = await Promise.all([
      this.prisma.item.count(),
      this.prisma.item.count({ where: { isActive: true } }),
      this.prisma.category.count({ where: { isActive: true } }),
    ]);

    return {
      totalItems,
      activeItems,
      inactiveItems: totalItems - activeItems,
      categoriesCount,
    };
  }
}
