import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { CurrentUserData } from '../decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no permissions specified, allow access
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as CurrentUserData;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Check if request body has approvedBy (manager override)
    const body = request.body;
    if (body?.approvedBy) {
      const isApprovalValid = await this.validateManagerApproval(
        body.approvedBy,
        requiredPermissions,
      );
      if (isApprovalValid) {
        return true;
      }
    }

    // If no permissions synced yet, fall back to role-based check:
    // MANAGER gets all permissions, STAFF gets none of the gated ones
    if (!user.permissions || user.permissions.length === 0) {
      if (user.role === 'MANAGER') {
        return true;
      }
      throw new ForbiddenException(
        `Access denied. Required permissions: ${requiredPermissions.join(', ')}`,
      );
    }

    // Check if user has any of the required permissions
    const hasPermission = requiredPermissions.some((p) =>
      user.permissions.includes(p),
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        `Access denied. Required permissions: ${requiredPermissions.join(', ')}`,
      );
    }

    return true;
  }

  /**
   * Validate that the approving manager has the required permission
   */
  private async validateManagerApproval(
    managerId: string,
    requiredPermissions: string[],
  ): Promise<boolean> {
    try {
      const manager = await this.prisma.user.findUnique({
        where: { id: managerId },
        select: {
          id: true,
          role: true,
          permissions: true,
          isActive: true,
        },
      });

      if (!manager || !manager.isActive) {
        return false;
      }

      // Managers have all permissions by default
      if (manager.role === 'MANAGER') {
        return true;
      }

      // Check specific permissions
      const managerPermissions: string[] = manager.permissions
        ? JSON.parse(manager.permissions)
        : [];

      return requiredPermissions.some((p) => managerPermissions.includes(p));
    } catch {
      return false;
    }
  }
}
