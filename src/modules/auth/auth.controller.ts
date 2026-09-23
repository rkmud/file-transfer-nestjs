import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { CreateUserDto } from '@/modules/users/dto/create-user.dto';
import { SWAGGER_COOKIE_AUTH } from '@/core/swagger/swagger.constants';
import { AuthCookieService } from './auth-cookie.service';
import { REFRESH_TOKEN_COOKIE } from './auth.constants';
import { AuthService } from './auth.service';
import { RequestMeta } from './auth.types';
import { CurrentUser } from '@/common/auth-token/current-user.decorator';
import { TokenPayload } from '@/common/auth-token/auth-token.types';
import {
  LoginResponseDto,
  LogoutResponseDto,
  RefreshResponseDto,
  RegistrationResponseDto,
  VerificationRequiredDto,
  VerifyEmailResponseDto,
} from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { AccessTokenGuard } from '@/common/auth-token/access-token.guard';

@ApiTags('Auth')
@UseGuards(ThrottlerGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private authCookieService: AuthCookieService,
  ) {}

  @Post('/registration')
  @ApiOperation({
    summary: 'Register a user',
    description:
      'Creates the user, sets auth cookies and sends a one-time code to the email address.',
  })
  @ApiCreatedResponse({
    description: 'User created, verification code sent',
    type: RegistrationResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed or the user already exists',
  })
  async registration(
    @Body() userDto: CreateUserDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { tokens, ...body } = await this.authService.registration(userDto);

    this.authCookieService.setAuthCookies(res, tokens);

    return body;
  }

  @Post('/verify-email')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard)
  @ApiCookieAuth(SWAGGER_COOKIE_AUTH)
  @ApiOperation({
    summary: 'Confirm the email address with a one-time code',
  })
  @ApiOkResponse({
    description: 'Email verified, fresh auth cookies set',
    type: VerifyEmailResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Code is invalid, expired or the email is already verified',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async verifyEmail(
    @CurrentUser() user: TokenPayload,
    @Body() dto: VerifyEmailDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { tokens, ...body } = await this.authService.verifyEmail(
      user.sub,
      dto,
    );

    this.authCookieService.setAuthCookies(res, tokens);

    return body;
  }

  @Post('/resend-otp')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard)
  @ApiCookieAuth(SWAGGER_COOKIE_AUTH)
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

  @Post('/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with email and password',
    description: 'Sets HttpOnly access/refresh cookies and returns the user.',
  })
  @ApiOkResponse({ description: 'Signed in', type: LoginResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  @ApiForbiddenResponse({ description: 'Account is temporarily locked' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { tokens, ...body } = await this.authService.login(
      dto,
      this.getRequestMeta(req),
    );

    this.authCookieService.setAuthCookies(res, tokens);

    return body;
  }

  @Post('/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh token cookie for a new token pair',
    description:
      'Reads the refresh_token cookie and, on success, sets a brand-new access/refresh cookie pair.',
  })
  @ApiOkResponse({ description: 'New tokens issued', type: RefreshResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Missing, invalid or expired refresh token',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE] as
      string | undefined;

    if (!refreshToken) {
      this.authCookieService.clearAuthCookies(res);

      throw new UnauthorizedException('Refresh token is required');
    }

    try {
      const { tokens } = await this.authService.refreshTokens(
        refreshToken,
        this.getRequestMeta(req),
      );

      this.authCookieService.setAuthCookies(res, tokens);

      return { message: 'Tokens refreshed' };
    } catch (error) {
      this.authCookieService.clearAuthCookies(res);

      throw error;
    }
  }

  @Post('/logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log out and clear auth cookies',
  })
  @ApiOkResponse({ description: 'Logged out', type: LogoutResponseDto })
  logout(@Res({ passthrough: true }) res: Response) {
    this.authCookieService.clearAuthCookies(res);

    return { message: 'Logged out successfully' };
  }

  private getRequestMeta(req: Request): RequestMeta {
    return {
      ip: req.ip ?? req.socket.remoteAddress ?? 'unknown',
      userAgent: req.headers['user-agent'] ?? 'unknown',
    };
  }
}
