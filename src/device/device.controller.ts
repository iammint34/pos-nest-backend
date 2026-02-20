import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DeviceService } from './device.service';
import { RegisterDeviceDto, DeviceConfigResponseDto } from './dto/register-device.dto';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Device')
@Controller('device')
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  @Post('register')
  @Public()
  @ApiOperation({ summary: 'Register device with Portal' })
  @ApiResponse({ status: 201, description: 'Device registered successfully' })
  @ApiResponse({ status: 400, description: 'Invalid registration code' })
  async registerDevice(
    @Body() dto: RegisterDeviceDto,
  ): Promise<DeviceConfigResponseDto> {
    return this.deviceService.registerDevice(dto);
  }

  @Get('config')
  @Public()
  @ApiOperation({ summary: 'Get device configuration' })
  @ApiResponse({ status: 200, description: 'Device configuration' })
  @ApiResponse({ status: 404, description: 'Device not registered' })
  async getDeviceConfig(): Promise<DeviceConfigResponseDto> {
    return this.deviceService.getDeviceConfig();
  }

  @Get('status')
  @Public()
  @ApiOperation({ summary: 'Check device registration status' })
  @ApiResponse({ status: 200, description: 'Registration status' })
  async getRegistrationStatus() {
    const isRegistered = await this.deviceService.isRegistered();
    return { isRegistered };
  }

  @Post('verify-portal')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify device is still registered on Portal' })
  @ApiResponse({ status: 200, description: 'Verification result' })
  async verifyWithPortal() {
    return this.deviceService.verifyWithPortal();
  }

  @Delete('unregister')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unregister device' })
  @ApiResponse({ status: 200, description: 'Device unregistered' })
  async unregisterDevice() {
    return this.deviceService.unregisterDevice();
  }
}
