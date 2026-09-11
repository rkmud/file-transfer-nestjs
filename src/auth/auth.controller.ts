import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CreateUserDto } from '@/users/dto/create-user.dto';
import { AuthService } from './auth.service';
import { TokenPayload } from './auth.types';
import { CurrentUser } from './decorators/current-user.decorator';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { AccessTokenGuard } from './guards/access-token.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('/registration')
  registration(@Body() userDto: CreateUserDto) {
    return this.authService.registration(userDto);
  }

  @Post('/verify-email')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard)
  verifyEmail(@CurrentUser() user: TokenPayload, @Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(user.sub, dto);
  }

  @Post('/resend-otp')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard)
  resendOtp(@CurrentUser() user: TokenPayload) {
    return this.authService.resendOtp(user.sub);
  }
}
