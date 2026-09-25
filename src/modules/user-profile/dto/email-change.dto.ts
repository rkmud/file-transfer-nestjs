import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';
import { NormalizeEmail } from '@/common/decorators/normalize-email.decorator';
import {
  EmailChangeChallenge,
  EmailChangeConfirmed,
} from '../user-profile.types';

export class RequestEmailChangeDto {
  @ApiProperty({
    description: 'New email address, normalized to lowercase',
    format: 'email',
    example: 'new.email@example.com',
  })
  @IsEmail({}, { message: 'Invalid email' })
  @IsNotEmpty({ message: 'newEmail should not be empty' })
  @NormalizeEmail()
  readonly newEmail!: string;
}

export class ConfirmEmailChangeDto {
  @ApiProperty({
    format: 'uuid',
    example: 'c7b8a9d0-1234-4678-9abc-def012345678',
  })
  @IsUUID('4', { message: 'challengeId must be a valid uuid' })
  @IsNotEmpty({ message: 'challengeId should not be empty' })
  readonly challengeId!: string;

  @ApiProperty({
    description: 'One-time code sent to the new email address',
    example: '849201',
    pattern: '^\\d{6}$',
  })
  @Matches(/^\d{6}$/, { message: 'code should be 6 digits' })
  @IsNotEmpty({ message: 'code is required' })
  @IsString({ message: 'code must be a string' })
  readonly code!: string;
}

export class EmailChangeChallengeResponseDto implements EmailChangeChallenge {
  @ApiProperty({ example: true })
  requiresConfirmation!: true;

  @ApiProperty({
    format: 'uuid',
    example: 'c7b8a9d0-1234-4678-9abc-def012345678',
  })
  challengeId!: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-24T03:20:00.000Z' })
  expiresAt!: string;
}

export class EmailChangeConfirmedResponseDto implements EmailChangeConfirmed {
  @ApiProperty({ example: 'Email updated successfully' })
  message!: string;

  @ApiProperty({ format: 'email', example: 'new.email@example.com' })
  email!: string;
}
