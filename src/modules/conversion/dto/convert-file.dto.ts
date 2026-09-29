import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ParseBoolean } from '@/common/decorators/parse-boolean.decorator';
import { TEXT_FORMATS } from '../formats/format.types';

export class ConvertFileDto {
  @ApiProperty({ enum: TEXT_FORMATS, example: 'json' })
  @MaxLength(16)
  @IsNotEmpty()
  @IsString()
  targetFormat!: string;

  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    description:
      'Also save the output for later download from the transformation history, for DEFAULT_RETENTION_DAYS. Saving happens in the background and never delays or fails the response.',
  })
  @ParseBoolean()
  @IsOptional()
  @IsBoolean()
  save?: boolean;
}

export class ConvertFileBodyDto extends ConvertFileDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'Non-empty CSV, JSON, XML or YAML file (UTF-8)',
  })
  file!: unknown;
}

export class ConversionDirectionsResponseDto {
  @ApiProperty({ enum: TEXT_FORMATS, example: 'csv' })
  source!: string;

  @ApiProperty({
    enum: TEXT_FORMATS,
    isArray: true,
    example: ['json', 'xml', 'yaml'],
  })
  target!: string[];
}
