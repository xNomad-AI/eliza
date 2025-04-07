import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
  IsIP,
  IsFQDN,
} from 'class-validator';

export class UpdateTaskSettingsDto {
  // {
  //   "entryPoint": "example.com",
  //   "ip": "127.0.1.40",
  //   "port": 8001,
  //   "countryCode": "US"
  // }
  @ApiProperty({ required: true })
  @IsFQDN()
  @IsNotEmpty()
  entryPoint: string;

  @ApiProperty({ required: true })
  @IsIP(4)
  @IsNotEmpty()
  ip: string;

  @ApiProperty({ required: true })
  @IsInt()
  @Min(0)
  @Max(65535)
  @IsNotEmpty()
  port: number;

  @ApiProperty({ required: true })
  @IsString()
  @IsNotEmpty()
  countryCode: string;

  @ApiProperty({ required: true })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ required: true })
  @IsString()
  @IsNotEmpty()
  password: string;
}
