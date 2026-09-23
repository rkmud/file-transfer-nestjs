import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEmail,
  MinLength,
  Matches,
} from 'class-validator';
import { NormalizeEmail } from '@/common/decorators/normalize-email.decorator';

export class CreateUserDto {
  @ApiProperty({
    description: 'Email address, normalized to lowercase',
    example: 'user@example.com',
    format: 'email',
  })
  @IsEmail({}, { message: 'Invalid email' })
  @IsNotEmpty({ message: 'Email should not be empty' })
  @NormalizeEmail()
  readonly email!: string;

  @ApiProperty({
    description:
      'At least 8 characters, containing letters, numbers and special characters',
    example: 'Str0ng!pass',
    minLength: 8,
    format: 'password',
  })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, {
    message: 'Password must contain letters, numbers, and special characters',
  })
  @MinLength(8, {
    message: 'Password must be at least 8 characters long',
  })
  @IsNotEmpty({ message: 'Password should not be empty' })
  @IsString({ message: 'Password must be a string' })
  readonly password!: string;
}
