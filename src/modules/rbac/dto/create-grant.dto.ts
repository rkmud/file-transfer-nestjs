import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { RBAC_NAME_MAX_LENGTH, RBAC_NAME_PATTERN } from '../rbac.constants';

export class CreateGrantDto {
  @ApiProperty({
    description: 'Role the permission is granted to',
    format: 'uuid',
    example: '1a4b1c3e-0d2f-4a6b-8c9d-1e2f3a4b5c6d',
  })
  @IsUUID('4', { message: 'roleId must be a valid uuid' })
  @IsNotEmpty({ message: 'roleId should not be empty' })
  readonly roleId!: string;

  @ApiProperty({
    description: 'Permission being granted',
    format: 'uuid',
    example: '2b5c2d4f-1e3a-4b7c-9d0e-2f3a4b5c6d7e',
  })
  @IsUUID('4', { message: 'permissionId must be a valid uuid' })
  @IsNotEmpty({ message: 'permissionId should not be empty' })
  readonly permissionId!: string;

  @ApiPropertyOptional({
    description:
      'Subset of the permission actions to grant. Omitted or empty means every action of the permission is granted.',
    example: ['read'],
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
