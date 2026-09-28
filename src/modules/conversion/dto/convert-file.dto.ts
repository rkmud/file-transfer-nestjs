import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { TEXT_FORMATS } from '../formats/format.types';

export class ConvertFileDto {
  @ApiProperty({ enum: TEXT_FORMATS, example: 'json' })
  @MaxLength(16)
  @IsNotEmpty()
  @IsString()
  targetFormat!: string;
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
