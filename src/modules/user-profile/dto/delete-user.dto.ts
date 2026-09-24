import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { DELETION_REASON_MAX_LENGTH } from '../user-profile.constants';
import { DeletionChallenge, UserDeleted } from '../user-profile.types';

export class DeleteUserDto {
  @ApiPropertyOptional({
    description: 'Admin only: reason recorded in the audit log',
    example: 'Administrative account removal',
    maxLength: DELETION_REASON_MAX_LENGTH,
  })
  @IsOptional()
  @MaxLength(DELETION_REASON_MAX_LENGTH)
  @IsString({ message: 'reason must be a string' })
  readonly reason?: string;
}

export class ConfirmDeletionDto {
  @ApiProperty({
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4', { message: 'challengeId must be a valid uuid' })
  @IsNotEmpty({ message: 'challengeId should not be empty' })
  readonly challengeId!: string;

  @ApiProperty({
    description: 'One-time code sent to the account email',
    example: '123456',
    pattern: '^\\d{6}$',
  })
  @Matches(/^\d{6}$/, { message: 'code should be 6 digits' })
  @IsNotEmpty({ message: 'code is required' })
  @IsString({ message: 'code must be a string' })
  readonly code!: string;
}

export class DeletionChallengeResponseDto implements DeletionChallenge {
  @ApiProperty({ example: true })
  requiresConfirmation!: true;

  @ApiProperty({
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  challengeId!: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-24T03:20:00.000Z' })
  expiresAt!: string;

  @ApiProperty({ example: 'Deletion OTP code sent to your email address' })
  message!: string;
}

export class UserDeletedResponseDto implements UserDeleted {
  @ApiProperty({ example: 'User account deleted' })
  message!: string;

  @ApiProperty({
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  userId!: string;
}
