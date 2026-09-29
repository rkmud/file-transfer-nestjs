import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  TRANSFORMATION_HISTORY_CURSOR_MAX_LENGTH,
  TRANSFORMATION_HISTORY_DEFAULT_LIMIT,
  TRANSFORMATION_HISTORY_MAX_LIMIT,
} from '../transformation-history.constants';
import {
  TRANSFORMATION_FORMATS,
  TRANSFORMATION_STATUSES,
  TRANSFORMATION_TYPES,
  TransformationFormat,
  TransformationHistoryItem,
  TransformationHistoryPage,
  TransformationHistoryPageInfo,
  TransformationStatus,
  TransformationType,
} from '../transformation-history.types';

const emptyToUndefined = ({ value }: { value: unknown }) => {
  const trimmed = typeof value === 'string' ? value.trim() : value;

  return trimmed === '' ? undefined : trimmed;
};

const normalizeEnum = ({ value }: { value: unknown }) => {
  const normalized = emptyToUndefined({ value });

  return typeof normalized === 'string' ? normalized.toLowerCase() : normalized;
};

export class TransformationHistoryQueryDto {
  @ApiPropertyOptional({
    description:
      'Opaque Base64URL cursor from a previous page (pageInfo.nextCursor)',
    maxLength: TRANSFORMATION_HISTORY_CURSOR_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @MaxLength(TRANSFORMATION_HISTORY_CURSOR_MAX_LENGTH)
  @IsString({ message: 'cursor must be a string' })
  readonly cursor?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: TRANSFORMATION_HISTORY_MAX_LIMIT,
    default: TRANSFORMATION_HISTORY_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @Max(TRANSFORMATION_HISTORY_MAX_LIMIT)
  @Min(1)
  @IsInt({ message: 'limit must be an integer' })
  readonly limit: number = TRANSFORMATION_HISTORY_DEFAULT_LIMIT;

  @ApiPropertyOptional({
    enum: TRANSFORMATION_TYPES,
    description: 'file: text/data conversion; image: image transformation',
  })
  @IsOptional()
  @Transform(normalizeEnum)
  @IsIn(TRANSFORMATION_TYPES)
  readonly type?: TransformationType;

  @ApiPropertyOptional({ enum: TRANSFORMATION_FORMATS })
  @IsOptional()
  @Transform(normalizeEnum)
  @IsIn(TRANSFORMATION_FORMATS)
  readonly sourceFormat?: TransformationFormat;

  @ApiPropertyOptional({ enum: TRANSFORMATION_FORMATS })
  @IsOptional()
  @Transform(normalizeEnum)
  @IsIn(TRANSFORMATION_FORMATS)
  readonly targetFormat?: TransformationFormat;

  @ApiPropertyOptional({ enum: TRANSFORMATION_STATUSES })
  @IsOptional()
  @Transform(normalizeEnum)
  @IsIn(TRANSFORMATION_STATUSES)
  readonly status?: TransformationStatus;

  @ApiPropertyOptional({
    description: 'Inclusive lower bound, ISO 8601 (e.g. 2026-01-01T00:00:00Z)',
    example: '2026-01-01T00:00:00Z',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsISO8601(
    { strict: true },
    { message: 'createdAtFrom must be an ISO 8601 timestamp' },
  )
  readonly createdAtFrom?: string;

  @ApiPropertyOptional({
    description: 'Inclusive upper bound, ISO 8601 (e.g. 2026-12-31T23:59:59Z)',
    example: '2026-12-31T23:59:59Z',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsISO8601(
    { strict: true },
    { message: 'createdAtTo must be an ISO 8601 timestamp' },
  )
  readonly createdAtTo?: string;
}

export class AdminTransformationHistoryQueryDto extends TransformationHistoryQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Only transformations of this user',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID('all', { message: 'userId must be a UUID' })
  readonly userId?: string;
}

export class TransformationHistoryItemResponseDto implements TransformationHistoryItem {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ enum: TRANSFORMATION_TYPES })
  type!: TransformationType;

  @ApiProperty({
    example: 'svg',
    description: '"unknown" when the source format could not be detected',
  })
  sourceFormat!: string;

  @ApiProperty({ example: 'png' })
  targetFormat!: string;

  @ApiProperty({ enum: TRANSFORMATION_STATUSES })
  status!: TransformationStatus;

  @ApiProperty({ description: 'Source file size in bytes', example: 1048576 })
  fileSize!: number;

  @ApiProperty({ example: 342 })
  durationMs!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'SYNTAX_ERROR',
    description: 'Machine-readable error code; null on success',
  })
  errorCode!: string | null;

  @ApiProperty({
    description:
      'Whether the output is saved and downloadable via .../{id}/download',
  })
  isStored!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When the saved output expires and gets purged; null if it was never saved',
  })
  expiresAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class TransformationHistoryPageInfoResponseDto implements TransformationHistoryPageInfo {
  @ApiProperty({ example: TRANSFORMATION_HISTORY_DEFAULT_LIMIT })
  limit!: number;

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as cursor to fetch the next page; null on the last page',
  })
  nextCursor!: string | null;
}

export class TransformationHistoryResponseDto implements TransformationHistoryPage {
  @ApiProperty({ type: [TransformationHistoryItemResponseDto] })
  items!: TransformationHistoryItemResponseDto[];

  @ApiProperty({ type: TransformationHistoryPageInfoResponseDto })
  pageInfo!: TransformationHistoryPageInfoResponseDto;
}
