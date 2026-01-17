import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

// Convenience decorators
export const ManagerOnly = () => Roles(UserRole.MANAGER);
export const StaffOrManager = () => Roles(UserRole.STAFF, UserRole.MANAGER);
