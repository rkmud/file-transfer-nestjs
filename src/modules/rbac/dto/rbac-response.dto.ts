import { ApiProperty } from '@nestjs/swagger';
import { Permission } from '../entities/permission.entity';
import { Role } from '../entities/role.entity';
import { GrantView, UserRoleView } from '../rbac.types';

const uuid = '1a4b1c3e-0d2f-4a6b-8c9d-1e2f3a4b5c6d';

export class RoleResponseDto implements Role {
  @ApiProperty({ format: 'uuid', example: uuid })
  id!: string;

  @ApiProperty({ example: 'admin' })
  name!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Full access to RBAC administration',
  })
  description!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class PermissionResponseDto implements Permission {
  @ApiProperty({ format: 'uuid', example: uuid })
  id!: string;

  @ApiProperty({ example: 'rbac' })
  name!: string;

  @ApiProperty({ type: [String], example: ['read', 'create'] })
  actions!: string[];

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class GrantResponseDto implements GrantView {
  @ApiProperty({ format: 'uuid', example: uuid })
  id!: string;

  @ApiProperty({ format: 'uuid', example: uuid })
  roleId!: string;

  @ApiProperty({ example: 'admin' })
  roleName!: string;

  @ApiProperty({ format: 'uuid', example: uuid })
  permissionId!: string;

  @ApiProperty({ example: 'rbac' })
  permissionName!: string;

  @ApiProperty({
    type: [String],
    nullable: true,
    description: 'null means every action of the permission is granted',
    example: ['read'],
  })
  actions!: string[] | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class UserRoleResponseDto implements UserRoleView {
  @ApiProperty({ format: 'uuid', example: uuid })
  id!: string;

  @ApiProperty({ format: 'uuid', example: uuid })
  userId!: string;

  @ApiProperty({ format: 'uuid', example: uuid })
  roleId!: string;

  @ApiProperty({ example: 'admin' })
  roleName!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}
