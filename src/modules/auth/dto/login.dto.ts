import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { NormalizeEmail } from '@/common/decorators/normalize-email.decorator';

export class LoginDto {
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
    description: 'Account password',
    example: 'Str0ng!pass',
    format: 'password',
  })
  @IsNotEmpty({ message: 'Password should not be empty' })
  @IsString({ message: 'Password must be a string' })
  readonly password!: string;
}
