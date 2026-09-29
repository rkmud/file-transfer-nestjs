import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ParseBoolean } from '@/common/decorators/parse-boolean.decorator';
import { IMAGE_FORMATS, ImageFormat } from '../images/image-format.types';
import {
  IMAGE_DEFAULT_BACKGROUND,
  IMAGE_DEFAULT_JPEG_QUALITY,
} from '../conversion.constants';

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const DIGITS = /^\d+$/;

const toInteger = ({ value }: TransformFnParams): unknown => {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();

  if (trimmed === '') return undefined;

  return DIGITS.test(trimmed) ? Number(trimmed) : trimmed;
};

const toOptionalString = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export class ConvertImageDto {
  @ApiProperty({ enum: IMAGE_FORMATS, example: 'png' })
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsIn(IMAGE_FORMATS)
  targetFormat!: ImageFormat;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    default: IMAGE_DEFAULT_JPEG_QUALITY,
    description: 'JPEG quality; ignored for other targets',
  })
  @Transform(toInteger)
  @IsOptional()
  @Max(100)
  @Min(1)
  @IsInt()
  quality?: number;

  @ApiPropertyOptional({
    minimum: 1,
    description:
      'Output width for SVG rasterization (max MAX_RASTER_WIDTH); ignored for raster sources',
  })
  @Transform(toInteger)
  @IsOptional()
  @Min(1)
  @IsInt()
  width?: number;

  @ApiPropertyOptional({
    minimum: 1,
    description:
      'Output height for SVG rasterization (max MAX_RASTER_HEIGHT); ignored for raster sources',
  })
  @Transform(toInteger)
  @IsOptional()
  @Min(1)
  @IsInt()
  height?: number;

  @ApiPropertyOptional({
    example: IMAGE_DEFAULT_BACKGROUND,
    default: IMAGE_DEFAULT_BACKGROUND,
    description:
      'Canvas color (#rgb or #rrggbb) for SVG rasterization; ignored for raster sources',
  })
  @Transform(toOptionalString)
  @IsOptional()
  @Matches(HEX_COLOR, { message: 'background must be a #rgb or #rrggbb color' })
  background?: string;

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

export class ConvertImageBodyDto extends ConvertImageDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'Non-empty PNG, JPEG or SVG file',
  })
  file!: unknown;
}

export class ImageConversionDirectionsResponseDto {
  @ApiProperty({ enum: IMAGE_FORMATS, example: 'svg' })
  source!: string;

  @ApiProperty({ enum: IMAGE_FORMATS, isArray: true, example: ['png', 'jpeg'] })
  target!: string[];
}
