import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({
    description: 'One-time code sent to the email address',
    example: '123456',
    pattern: '^\\d{6}$',
  })
  @Matches(/^\d{6}$/, { message: 'Otp should be 6 digits' })
  @IsNotEmpty({ message: 'Otp is required' })
  @IsString({ message: 'Otp must be a string' })
  readonly otp!: string;
}
