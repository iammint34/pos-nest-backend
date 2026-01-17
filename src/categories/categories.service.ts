import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get all active categories with item counts
   */
  async findAll() {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: {
          select: { items: { where: { isActive: true } } },
        },
      },
    });

    return categories.map((cat) => ({
      id: cat.id,
      portalId: cat.portalId,
      name: cat.name,
      description: cat.description,
      sortOrder: cat.sortOrder,
      itemCount: cat._count.items,
      syncedAt: cat.syncedAt,
    }));
  }

  /**
   * Get category by ID
   */
  async findOne(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        items: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  /**
   * Get categories with their items
   */
  async getCategoriesWithItems() {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        items: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            portalId: true,
            sku: true,
            name: true,
            description: true,
            price: true,
          },
        },
      },
    });

    // Also get uncategorized items
    const uncategorizedItems = await this.prisma.item.findMany({
      where: { isActive: true, categoryId: null },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        portalId: true,
        sku: true,
        name: true,
        description: true,
        price: true,
      },
    });

    const result = categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      description: cat.description,
      sortOrder: cat.sortOrder,
      items: cat.items,
    }));

    if (uncategorizedItems.length > 0) {
      result.push({
        id: 'uncategorized',
        name: 'Uncategorized',
        description: 'Items without a category',
        sortOrder: 9999,
        items: uncategorizedItems,
      });
    }

    return result;
  }
}
