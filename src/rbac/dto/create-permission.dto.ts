import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { RBAC_NAME_MAX_LENGTH, RBAC_NAME_PATTERN } from '../rbac.constants';

export class CreatePermissionDto {
  @ApiProperty({
    description: 'Unique permission (resource) name',
    example: 'rbac',
    maxLength: RBAC_NAME_MAX_LENGTH,
    pattern: RBAC_NAME_PATTERN.source,
  })
  @Matches(RBAC_NAME_PATTERN, {
    message: 'Permission name may contain only letters, digits and _ . : -',
  })
  @MaxLength(RBAC_NAME_MAX_LENGTH, {
    message: `Permission name must be at most ${RBAC_NAME_MAX_LENGTH} characters long`,
  })
  @IsNotEmpty({ message: 'Permission name should not be empty' })
  @IsString({ message: 'Permission name must be a string' })
  readonly name!: string;

  @ApiPropertyOptional({
    description: 'Actions the permission supports',
    example: ['read', 'create', 'update', 'delete'],
    type: [String],
  })
  @Matches(RBAC_NAME_PATTERN, {
    each: true,
    message: 'Action may contain only letters, digits and _ . : -',
  })
  @MaxLength(RBAC_NAME_MAX_LENGTH, {
    each: true,
    message: `Action must be at most ${RBAC_NAME_MAX_LENGTH} characters long`,
  })
  @IsString({ each: true, message: 'Action must be a string' })
  @ArrayUnique({ message: 'Actions must not contain duplicates' })
  @IsArray({ message: 'Actions must be an array' })
  @IsOptional()
  readonly actions?: string[];
}
