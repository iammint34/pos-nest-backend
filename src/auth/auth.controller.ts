import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  LoginDto,
  PinLoginDto,
  LoginResponseDto,
  ChangePasswordDto,
  SetPinDto,
} from './dto/auth.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser, CurrentUserData } from './decorators/current-user.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Public()
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(dto);
  }

  @Post('login/pin')
  @Public()
  @ApiOperation({ summary: 'Quick login with PIN' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid PIN' })
  async loginWithPin(@Body() dto: PinLoginDto): Promise<LoginResponseDto> {
    return this.authService.loginWithPin(dto);
  }

  @Post('logout')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout current session' })
  @ApiResponse({ status: 200, description: 'Logout successful' })
  async logout(@CurrentUser() user: CurrentUserData): Promise<{ message: string }> {
    await this.authService.logout(user.sessionId);
    return { message: 'Logged out successfully' };
  }

  @Post('logout/all')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout all sessions' })
  @ApiResponse({ status: 200, description: 'All sessions logged out' })
  async logoutAll(@CurrentUser() user: CurrentUserData): Promise<{ message: string }> {
    await this.authService.logoutAll(user.userId);
    return { message: 'All sessions logged out successfully' };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user info' })
  @ApiResponse({ status: 200, description: 'Current user info' })
  async getCurrentUser(@CurrentUser() user: CurrentUserData) {
    return this.authService.getCurrentUser(user.userId);
  }

  @Post('change-password')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change password' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  async changePassword(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.changePassword(user.userId, dto);
    return { message: 'Password changed successfully' };
  }

  @Post('pin')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set quick login PIN' })
  @ApiResponse({ status: 200, description: 'PIN set successfully' })
  async setPin(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: SetPinDto,
  ): Promise<{ message: string }> {
    await this.authService.setPin(user.userId, dto);
    return { message: 'PIN set successfully' };
  }

  @Delete('pin')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove quick login PIN' })
  @ApiResponse({ status: 200, description: 'PIN removed successfully' })
  async removePin(@CurrentUser() user: CurrentUserData): Promise<{ message: string }> {
    await this.authService.removePin(user.userId);
    return { message: 'PIN removed successfully' };
  }

  @Get('users')
  @Public()
  @ApiOperation({ summary: 'Get list of active users for login selection' })
  @ApiResponse({ status: 200, description: 'List of active users' })
  async getActiveUsers() {
    return this.authService.getActiveUsers();
  }
}
