import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  RBAC_DESCRIPTION_MAX_LENGTH,
  RBAC_NAME_MAX_LENGTH,
  RBAC_NAME_PATTERN,
} from '../rbac.constants';

export class CreateRoleDto {
  @ApiProperty({
    description: 'Unique role name',
    example: 'admin',
    maxLength: RBAC_NAME_MAX_LENGTH,
    pattern: RBAC_NAME_PATTERN.source,
  })
  @Matches(RBAC_NAME_PATTERN, {
    message: 'Role name may contain only letters, digits and _ . : -',
  })
  @MaxLength(RBAC_NAME_MAX_LENGTH, {
    message: `Role name must be at most ${RBAC_NAME_MAX_LENGTH} characters long`,
  })
  @IsNotEmpty({ message: 'Role name should not be empty' })
  @IsString({ message: 'Role name must be a string' })
  readonly name!: string;

  @ApiPropertyOptional({
    description: 'Human readable description of the role',
    example: 'Full access to RBAC administration',
    maxLength: RBAC_DESCRIPTION_MAX_LENGTH,
  })
  @MaxLength(RBAC_DESCRIPTION_MAX_LENGTH, {
    message: `Description must be at most ${RBAC_DESCRIPTION_MAX_LENGTH} characters long`,
  })
  @IsString({ message: 'Description must be a string' })
  @IsOptional()
  readonly description?: string;
}
