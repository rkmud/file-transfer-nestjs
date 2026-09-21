import { ApiProperty } from '@nestjs/swagger';
import {
  PublicUser,
  RegistrationResult,
  VerificationRequired,
} from '../auth.types';

export class PublicUserDto implements PublicUser {
  @ApiProperty({
    format: 'uuid',
    example: '3c6d3e5a-2f4b-4c8d-0e1f-3a4b5c6d7e8f',
  })
  id!: string;

  @ApiProperty({ format: 'email', example: 'user@example.com' })
  email!: string;

  @ApiProperty({ example: false })
  isEmailVerified!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class AuthTokensDto {
  @ApiProperty({ description: 'JWT access token' })
  accessToken!: string;

  @ApiProperty({ description: 'JWT refresh token' })
  refreshToken!: string;
}

export class VerificationRequiredDto implements VerificationRequired {
  @ApiProperty({ example: true })
  verificationRequired!: true;

  @ApiProperty({
    description: 'When the one-time code expires',
    format: 'date-time',
    example: '2026-01-01T12:00:00.000Z',
  })
  expiresAt!: string;

  @ApiProperty({ example: 'A new verification code has been sent' })
  message!: string;
}

export class RegistrationResponseDto
  extends AuthTokensDto
  implements RegistrationResult
{
  @ApiProperty({ type: PublicUserDto })
  user!: PublicUserDto;

  @ApiProperty({ example: true })
  verificationRequired!: true;

  @ApiProperty({
    description: 'When the one-time code expires',
    format: 'date-time',
    example: '2026-01-01T12:00:00.000Z',
  })
  expiresAt!: string;

  @ApiProperty({ example: 'Verification code has been sent to your email' })
  message!: string;
}

export class VerifyEmailResponseDto extends AuthTokensDto {
  @ApiProperty({ type: PublicUserDto })
  user!: PublicUserDto;

  @ApiProperty({ example: 'Email verified successfully' })
  message!: string;
}
