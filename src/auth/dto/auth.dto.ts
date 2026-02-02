import { IsString, IsNotEmpty, IsOptional, IsEmail, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ description: 'User email' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'User password' })
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class PinLoginDto {
  @ApiProperty({ description: 'Quick login PIN (6 digits)' })
  @IsString()
  @MinLength(6)
  pin: string;
}

export class LoginResponseDto {
  accessToken: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: 'MANAGER' | 'STAFF';
    permissions: string[];
  };
  expiresAt: Date;
}

export class ChangePasswordDto {
  @ApiProperty({ description: 'Current password' })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ description: 'New password' })
  @IsString()
  @MinLength(6)
  newPassword: string;
}

export class SetPinDto {
  @ApiProperty({ description: 'New PIN for quick login (6 digits)' })
  @IsString()
  @MinLength(6)
  pin: string;
}

export class ManagerOverrideDto {
  @ApiPropertyOptional({ description: 'Manager email (required if not using PIN)' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'Manager password (required if not using PIN)' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional({ description: 'Manager PIN (alternative to email/password)' })
  @IsOptional()
  @IsString()
  pin?: string;

  @ApiProperty({ description: 'Permission code required for this action' })
  @IsString()
  @IsNotEmpty()
  requiredPermission: string;
}

export class ManagerOverrideResponseDto {
  approved: boolean;
  manager: {
    id: string;
    firstName: string;
    lastName: string;
  };
}
