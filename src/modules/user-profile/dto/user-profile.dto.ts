import { ApiProperty } from '@nestjs/swagger';
import { AdminUserProfile, UserProfile } from '../user-profile.types';

export class UserProfileResponseDto implements UserProfile {
  @ApiProperty({
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id!: string;

  @ApiProperty({ format: 'email', example: 'user@example.com' })
  email!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Relative path to the avatar file',
    example: '/static/avatars/550e8400.png',
  })
  photo!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Ada' })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Lovelace' })
  lastName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  bio!: string | null;

  @ApiProperty({ example: 'en' })
  locale!: string;

  @ApiProperty({ example: true })
  isEmailVerified!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastLoginAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class AdminUserProfileResponseDto
  extends UserProfileResponseDto
  implements AdminUserProfile
{
  @ApiProperty({ description: 'Admin only', example: 0 })
  failedLoginAttempts!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Admin only',
  })
  lockedUntil!: Date | null;
}
