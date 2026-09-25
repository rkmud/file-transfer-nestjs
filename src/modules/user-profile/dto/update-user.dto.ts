import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { NormalizeEmail } from '@/common/decorators/normalize-email.decorator';
import {
  BIO_MAX_LENGTH,
  LOCALE_MAX_LENGTH,
  NAME_MAX_LENGTH,
  PHONE_MAX_LENGTH,
} from '../user-profile.constants';

const EmptyToNull = () =>
  Transform(({ value }: { value: unknown }) =>
    value === '' || value === 'null' ? null : value,
  );

const ToBoolean = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;

    return value;
  });

const ToInt = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value,
  );

const IsPresent = () =>
  ValidateIf((_object: unknown, value: unknown) => value !== undefined);

export class UpdateUserDto {
  @ApiPropertyOptional({ type: String, nullable: true, example: 'Ada' })
  @IsOptional()
  @IsString({ message: 'firstName must be a string' })
  @MaxLength(NAME_MAX_LENGTH)
  @EmptyToNull()
  readonly firstName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Lovelace' })
  @IsOptional()
  @IsString({ message: 'lastName must be a string' })
  @MaxLength(NAME_MAX_LENGTH)
  @EmptyToNull()
  readonly lastName?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '+1 555 123 4567',
  })
  @IsOptional()
  @Matches(/^\+?[0-9 ()-]{3,}$/, { message: 'Invalid phone number' })
  @MaxLength(PHONE_MAX_LENGTH)
  @IsString({ message: 'phone must be a string' })
  @EmptyToNull()
  readonly phone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null })
  @IsOptional()
  @IsString({ message: 'bio must be a string' })
  @MaxLength(BIO_MAX_LENGTH)
  @EmptyToNull()
  readonly bio?: string | null;

  @ApiPropertyOptional({ example: 'en' })
  @IsPresent()
  @Matches(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, {
    message: 'locale must be a BCP 47 language tag, e.g. "en" or "en-US"',
  })
  @MaxLength(LOCALE_MAX_LENGTH)
  @IsString({ message: 'locale must be a string' })
  readonly locale?: string;

  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description:
      'Avatar image (multipart only): JPEG, PNG, WebP or GIF, up to 5 MB',
  })
  readonly photo?: unknown;

  @ApiPropertyOptional({
    format: 'email',
    description: 'Admin only',
    example: 'user@example.com',
  })
  @IsPresent()
  @IsEmail({}, { message: 'Invalid email' })
  @NormalizeEmail()
  readonly email?: string;

  @ApiPropertyOptional({ description: 'Admin only', example: true })
  @IsPresent()
  @IsBoolean({ message: 'isEmailVerified must be a boolean' })
  @ToBoolean()
  readonly isEmailVerified?: boolean;

  @ApiPropertyOptional({ description: 'Admin only', example: 0, minimum: 0 })
  @IsPresent()
  @Min(0)
  @IsInt({ message: 'failedLoginAttempts must be an integer' })
  @ToInt()
  readonly failedLoginAttempts?: number;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Admin only',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'lockedUntil must be an ISO date' })
  @EmptyToNull()
  readonly lockedUntil?: string | null;

  @ApiPropertyOptional({
    description: 'Admin only',
    format: 'password',
    minLength: 8,
  })
  @IsPresent()
  @Matches(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, {
    message: 'Password must contain letters, numbers, and special characters',
  })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @IsString({ message: 'Password must be a string' })
  readonly password?: string;
}
