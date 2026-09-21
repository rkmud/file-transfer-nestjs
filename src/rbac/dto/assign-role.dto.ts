import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class AssignRoleDto {
  @ApiProperty({
    description: 'Role to assign to the user',
    format: 'uuid',
    example: '1a4b1c3e-0d2f-4a6b-8c9d-1e2f3a4b5c6d',
  })
  @IsUUID('4', { message: 'roleId must be a valid uuid' })
  @IsNotEmpty({ message: 'roleId should not be empty' })
  readonly roleId!: string;
}
