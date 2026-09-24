import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '@/common/auth-token/access-token.guard';
import { TokenPayload } from '@/common/auth-token/auth-token.types';
import { CurrentUser } from '@/common/auth-token/current-user.decorator';
import { SWAGGER_COOKIE_AUTH } from '@/core/swagger/swagger.constants';
import {
  ConfirmEmailChangeDto,
  EmailChangeChallengeResponseDto,
  EmailChangeConfirmedResponseDto,
  RequestEmailChangeDto,
} from './dto/email-change.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  AdminUserProfileResponseDto,
  UserProfileResponseDto,
} from './dto/user-profile.dto';
import { AVATAR_FIELD } from './user-profile.constants';
import { UserProfileService } from './user-profile.service';
import {
  AdminUserProfile,
  EmailChangeChallenge,
  EmailChangeConfirmed,
  UserProfile,
} from './user-profile.types';

const PROFILE_RESPONSE_SCHEMA = {
  oneOf: [
    { $ref: getSchemaPath(UserProfileResponseDto) },
    { $ref: getSchemaPath(AdminUserProfileResponseDto) },
  ],
};

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
    schema: PROFILE_RESPONSE_SCHEMA,
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

  @Patch(':userId')
  @UseInterceptors(FileInterceptor(AVATAR_FIELD))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({
    summary: 'Update a user profile',
    description:
      'Users can update firstName, lastName, phone, bio, locale and photo on their own profile; sending admin-only fields returns 403. Holders of users@update (admins) can update any field of any user, including email, isEmailVerified, failedLoginAttempts, lockedUntil and password. Roles are managed separately under /admin/rbac/users/:userId/roles.',
  })
  @ApiParam({ name: 'userId', format: 'uuid', description: 'Target user' })
  @ApiExtraModels(UserProfileResponseDto, AdminUserProfileResponseDto)
  @ApiOkResponse({
    description: 'Updated profile',
    schema: PROFILE_RESPONSE_SCHEMA,
  })
  @ApiBadRequestResponse({ description: 'Validation failed or empty update' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({
    description:
      "Updating another user's profile, or a user sending admin-only fields",
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiConflictResponse({ description: 'Email is already in use' })
  @ApiPayloadTooLargeResponse({ description: 'Avatar exceeds 5 MB' })
  @ApiUnsupportedMediaTypeResponse({
    description: 'Avatar is not JPEG, PNG, WebP or GIF',
  })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  updateProfile(
    @CurrentUser() user: TokenPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserDto,
    @UploadedFile() photo?: Express.Multer.File,
  ): Promise<UserProfile | AdminUserProfile> {
    return this.userProfileService.updateProfile(user.sub, userId, dto, photo);
  }

  @Post(':userId/email-change')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start an email change',
    description:
      'Self only. Sends a 6-digit code to the new address; confirm it via /email-change/confirm.',
  })
  @ApiParam({ name: 'userId', format: 'uuid', description: 'Own user id' })
  @ApiOkResponse({ type: EmailChangeChallengeResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid email or same as current' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'userId is not the current user' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiConflictResponse({ description: 'Email is already in use' })
  @ApiTooManyRequestsResponse({
    description: 'Resend cooldown or rate limit exceeded',
  })
  @ApiServiceUnavailableResponse({ description: 'Failed to send email' })
  requestEmailChange(
    @CurrentUser() user: TokenPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: RequestEmailChangeDto,
  ): Promise<EmailChangeChallenge> {
    return this.userProfileService.requestEmailChange(user.sub, userId, dto);
  }

  @Post(':userId/email-change/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm an email change',
    description: 'Self only. Verifies the code and switches the email.',
  })
  @ApiParam({ name: 'userId', format: 'uuid', description: 'Own user id' })
  @ApiOkResponse({ type: EmailChangeConfirmedResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid or expired code' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'userId is not the current user' })
  @ApiNotFoundResponse({ description: 'User or challenge not found' })
  @ApiConflictResponse({ description: 'Email is already in use' })
  @ApiTooManyRequestsResponse({
    description: 'Too many invalid attempts or rate limit exceeded',
  })
  confirmEmailChange(
    @CurrentUser() user: TokenPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ConfirmEmailChangeDto,
  ): Promise<EmailChangeConfirmed> {
    return this.userProfileService.confirmEmailChange(user.sub, userId, dto);
  }
}
