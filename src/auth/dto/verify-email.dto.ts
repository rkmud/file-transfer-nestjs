import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class VerifyEmailDto {
  @Matches(/^\d{6}$/, { message: 'Otp should be 6 digits' })
  @IsNotEmpty({ message: 'Otp is required' })
  @IsString({ message: 'Otp must be a string' })
  readonly otp!: string;
}
