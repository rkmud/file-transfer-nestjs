import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CreateUserDto } from '@/users/dto/create-user.dto';
import { SWAGGER_BEARER_AUTH } from '@/swagger/swagger.constants';
import { AuthService } from './auth.service';
import { TokenPayload } from './auth.types';
import { CurrentUser } from './decorators/current-user.decorator';
import {
  RegistrationResponseDto,
  VerificationRequiredDto,
  VerifyEmailResponseDto,
} from './dto/auth-response.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { AccessTokenGuard } from './guards/access-token.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('/registration')
  @ApiOperation({
    summary: 'Register a user',
    description:
      'Creates the user, issues tokens and sends a one-time code to the email address.',
  })
  @ApiCreatedResponse({
    description: 'User created, verification code sent',
    type: RegistrationResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed or the user already exists',
  })
  registration(@Body() userDto: CreateUserDto) {
    return this.authService.registration(userDto);
  }

  @Post('/verify-email')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth(SWAGGER_BEARER_AUTH)
  @ApiOperation({
    summary: 'Confirm the email address with a one-time code',
  })
  @ApiOkResponse({
    description: 'Email verified, fresh tokens issued',
    type: VerifyEmailResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Code is invalid, expired or the email is already verified',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  verifyEmail(@CurrentUser() user: TokenPayload, @Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(user.sub, dto);
  }

  @Post('/resend-otp')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth(SWAGGER_BEARER_AUTH)
  @ApiOperation({ summary: 'Send a new verification code' })
  @ApiOkResponse({
    description: 'New code sent',
    type: VerificationRequiredDto,
  })
  @ApiBadRequestResponse({
    description: 'Email is already verified or the resend cooldown is active',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  resendOtp(@CurrentUser() user: TokenPayload) {
    return this.authService.resendOtp(user.sub);
  }
}
