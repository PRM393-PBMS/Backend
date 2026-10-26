import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Max,
  Min,
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

  @ApiPropertyOptional({ example: 10.8411, minimum: -90, maximum: 90, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @ApiPropertyOptional({ example: 106.8099, minimum: -180, maximum: 180, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number | null;

  @ApiPropertyOptional({
    example: '/uploads/parkings/tao-dan.jpg',
    maxLength: 2048,
    nullable: true,
    description: 'Ảnh bãi. Tải file qua POST /parkings/{id}/image hoặc gửi URL có sẵn.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imageUrl?: string | null;

  @ApiPropertyOptional({ example: '24/7', maxLength: 50, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  openingHours?: string | null;
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

  @ApiPropertyOptional({ example: 10.8411, minimum: -90, maximum: 90, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @ApiPropertyOptional({ example: 106.8099, minimum: -180, maximum: 180, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number | null;

  @ApiPropertyOptional({
    example: '/uploads/parkings/tao-dan.jpg',
    maxLength: 2048,
    nullable: true,
    description: 'Ảnh bãi. Tải file qua POST /parkings/{id}/image hoặc gửi URL có sẵn.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imageUrl?: string | null;

  @ApiPropertyOptional({ example: '24/7', maxLength: 50, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  openingHours?: string | null;
}

export class ParkingResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Bãi xe FPT' })
  name!: string;

  @ApiProperty({ example: 'Khu Công nghệ cao, Thủ Đức' })
  location!: string;

  @ApiPropertyOptional({ example: 10.8411, nullable: true })
  latitude!: number | null;

  @ApiPropertyOptional({ example: 106.8099, nullable: true })
  longitude!: number | null;

  @ApiPropertyOptional({ example: '/uploads/parkings/tao-dan.jpg', nullable: true })
  imageUrl!: string | null;

  @ApiPropertyOptional({ example: '24/7', nullable: true })
  openingHours!: string | null;

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
