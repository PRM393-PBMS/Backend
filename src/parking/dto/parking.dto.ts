import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateParkingDto {
  @ApiProperty({ example: 'Bãi xe FPT', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiProperty({ example: 'Khu Công nghệ cao, Thủ Đức', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  location!: string;
}

export class UpdateParkingDto {
  @ApiPropertyOptional({ example: 'Bãi xe FPT', maxLength: 255 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    example: 'Khu Công nghệ cao, Thủ Đức',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  location?: string;
}

export class ParkingResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Bãi xe FPT' })
  name!: string;

  @ApiProperty({ example: 'Khu Công nghệ cao, Thủ Đức' })
  location!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class ParkingSlotResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  parkingId!: string;

  @ApiProperty({ format: 'uuid' })
  floorId!: string;

  @ApiProperty({ example: 'B1-A12' })
  slotCode!: string;

  @ApiProperty({ format: 'uuid' })
  vehicleTypeId!: string;

  @ApiProperty({ example: 'Available' })
  status!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  assignedUserId!: string | null;
}

export class ParkingIdParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;
}
