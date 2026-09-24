import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '@/common/auth-token/access-token.guard';
import { TokenPayload } from '@/common/auth-token/auth-token.types';
import { CurrentUser } from '@/common/auth-token/current-user.decorator';
import { SWAGGER_COOKIE_AUTH } from '@/core/swagger/swagger.constants';
import {
  AdminUserProfileResponseDto,
  UserProfileResponseDto,
} from './dto/user-profile.dto';
import { UserProfileService } from './user-profile.service';
import { AdminUserProfile, UserProfile } from './user-profile.types';

@ApiTags('Users')
@ApiCookieAuth(SWAGGER_COOKIE_AUTH)
@Controller('users')
@UseGuards(ThrottlerGuard, AccessTokenGuard)
export class UserProfileController {
  constructor(private userProfileService: UserProfileService) {}

  @Get(':userId')
  @ApiOperation({
    summary: 'Get a user profile',
    description:
      'Users can read only their own profile. Holders of the users@read permission (admins) can read any profile and also receive security fields.',
  })
  @ApiParam({ name: 'userId', format: 'uuid', description: 'Target user' })
  @ApiExtraModels(UserProfileResponseDto, AdminUserProfileResponseDto)
  @ApiOkResponse({
    description: 'Profile; security fields are included for admins only',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(UserProfileResponseDto) },
        { $ref: getSchemaPath(AdminUserProfileResponseDto) },
      ],
    },
  })
  @ApiBadRequestResponse({ description: 'userId is not a valid uuid' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({
    description: "Attempt to read another user's profile without admin rights",
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  getProfile(
    @CurrentUser() user: TokenPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<UserProfile | AdminUserProfile> {
    return this.userProfileService.getProfile(user.sub, userId);
  }
}
