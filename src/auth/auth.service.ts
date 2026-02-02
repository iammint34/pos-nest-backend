import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, PinLoginDto, LoginResponseDto, ChangePasswordDto, SetPinDto, ManagerOverrideDto, ManagerOverrideResponseDto } from './dto/auth.dto';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

@Injectable()
export class AuthService {
  private readonly sessionExpiryHours: number;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.sessionExpiryHours = this.configService.get<number>(
      'SESSION_EXPIRY_HOURS',
      8,
    );
  }

  /**
   * Login with email and password
   */
  async login(dto: LoginDto): Promise<LoginResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('User account is disabled');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.createSession(user.id);
  }

  /**
   * Quick login with PIN
   */
  async loginWithPin(dto: PinLoginDto): Promise<LoginResponseDto> {
    const user = await this.prisma.user.findFirst({
      where: { pin: dto.pin, isActive: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid PIN');
    }

    return this.createSession(user.id);
  }

  /**
   * Create a new session for user
   */
  private async createSession(userId: string): Promise<LoginResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const token = randomUUID();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + this.sessionExpiryHours);

    const session = await this.prisma.userSession.create({
      data: {
        userId,
        token,
        expiresAt,
      },
    });

    // Update last login
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });

    return {
      accessToken: token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        permissions: user.permissions ? JSON.parse(user.permissions) : [],
      },
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Logout - invalidate session
   */
  async logout(sessionId: string): Promise<void> {
    await this.prisma.userSession.delete({
      where: { id: sessionId },
    }).catch(() => {
      // Ignore if session already deleted
    });
  }

  /**
   * Logout all sessions for user
   */
  async logoutAll(userId: string): Promise<void> {
    await this.prisma.userSession.deleteMany({
      where: { userId },
    });
  }

  /**
   * Get current user info
   */
  async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  /**
   * Change user password
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const newPasswordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    // Invalidate all other sessions
    await this.prisma.userSession.deleteMany({
      where: { userId },
    });
  }

  /**
   * Set quick login PIN
   */
  async setPin(userId: string, dto: SetPinDto): Promise<void> {
    // Check if PIN is already used by another user
    const existingUser = await this.prisma.user.findFirst({
      where: { pin: dto.pin, id: { not: userId } },
    });

    if (existingUser) {
      throw new BadRequestException('PIN is already in use by another user');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { pin: dto.pin },
    });
  }

  /**
   * Remove quick login PIN
   */
  async removePin(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { pin: null },
    });
  }

  /**
   * Get all active users (for PIN selection)
   */
  async getActiveUsers() {
    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        pin: true,
      },
      orderBy: { firstName: 'asc' },
    });

    // Return users with hasPin flag (don't expose actual PIN)
    return users.map(user => ({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      hasPin: !!user.pin,
    }));
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    const result = await this.prisma.userSession.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
    return result.count;
  }

  /**
   * Verify manager credentials for override/approval
   * Does not create a session, just verifies credentials and permission
   */
  async verifyManagerOverride(dto: ManagerOverrideDto): Promise<ManagerOverrideResponseDto> {
    let user;

    // Authenticate via PIN or email/password
    if (dto.pin) {
      user = await this.prisma.user.findFirst({
        where: { pin: dto.pin, isActive: true },
      });
      if (!user) {
        throw new UnauthorizedException('Invalid PIN');
      }
    } else if (dto.email && dto.password) {
      user = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (!user) {
        throw new UnauthorizedException('Invalid email or password');
      }
      if (!user.isActive) {
        throw new UnauthorizedException('User account is disabled');
      }
      const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid email or password');
      }
    } else {
      throw new BadRequestException('Either PIN or email/password is required');
    }

    // Check if user has the required permission
    const permissions: string[] = user.permissions ? JSON.parse(user.permissions) : [];
    const isManager = user.role === 'MANAGER';
    const hasSpecificPermission = permissions.includes(dto.requiredPermission);
    const hasPermission = isManager || hasSpecificPermission;

    if (!hasPermission) {
      throw new UnauthorizedException(
        `Access denied. ${user.firstName} ${user.lastName} (${user.role}) does not have permission to approve this action. Please use a Manager account.`
      );
    }

    return {
      approved: true,
      manager: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };
  }
}
