import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDeviceDto {
  @ApiProperty({ description: 'Registration code from Portal' })
  @IsString()
  @IsNotEmpty()
  registrationCode: string;

  @ApiProperty({ description: 'Device name for identification' })
  @IsString()
  @IsNotEmpty()
  deviceName: string;
}

export class DeviceConfigResponseDto {
  id: string;
  deviceIdentifier: string;
  deviceName: string;
  storeId: string;
  storeName: string;
  branchId: string;
  branchName: string;
  isRegistered: boolean;
  lastSyncAt: Date | null;
}
