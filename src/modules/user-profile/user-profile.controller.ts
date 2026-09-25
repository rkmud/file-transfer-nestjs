import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
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
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Response } from 'express';
import { AccessTokenGuard } from '@/common/auth-token/access-token.guard';
import { TokenPayload } from '@/common/auth-token/auth-token.types';
import { CurrentUser } from '@/common/auth-token/current-user.decorator';
import { SWAGGER_COOKIE_AUTH } from '@/core/swagger/swagger.constants';
import { AuthCookieService } from '@/modules/auth/auth-cookie.service';
import { RbacPermissions } from '@/modules/rbac/decorators/rbac-permissions.decorator';
import { RbacGuard } from '@/modules/rbac/guards/rbac.guard';
import {
  ConfirmDeletionDto,
  DeleteUserDto,
  DeletionChallengeResponseDto,
  UserDeletedResponseDto,
} from './dto/delete-user.dto';
import {
  ConfirmEmailChangeDto,
  EmailChangeChallengeResponseDto,
  EmailChangeConfirmedResponseDto,
  RequestEmailChangeDto,
} from './dto/email-change.dto';
import { ListUsersQueryDto, UserListResponseDto } from './dto/list-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  AdminUserProfileResponseDto,
  UserProfileResponseDto,
} from './dto/user-profile.dto';
import {
  AVATAR_FIELD,
  USERS_LIST_PERMISSION,
  USERS_LIST_THROTTLE,
} from './user-profile.constants';
import { UserProfileService } from './user-profile.service';
import {
  AdminUserProfile,
  DeletionResult,
  EmailChangeChallenge,
  EmailChangeConfirmed,
  UserDeleted,
  UserListPage,
  UserProfile,
} from './user-profile.types';

const PROFILE_RESPONSE_SCHEMA = {
  oneOf: [
    { $ref: getSchemaPath(UserProfileResponseDto) },
    { $ref: getSchemaPath(AdminUserProfileResponseDto) },
  ],
};

const DELETION_RESPONSE_SCHEMA = {
  oneOf: [
    { $ref: getSchemaPath(DeletionChallengeResponseDto) },
    { $ref: getSchemaPath(UserDeletedResponseDto) },
  ],
};

@ApiTags('Users')
@ApiCookieAuth(SWAGGER_COOKIE_AUTH)
@Controller('users')
@UseGuards(ThrottlerGuard, AccessTokenGuard)
export class UserProfileController {
  constructor(
    private userProfileService: UserProfileService,
    private authCookieService: AuthCookieService,
  ) {}

  @Get()
  @UseGuards(RbacGuard)
  @RbacPermissions(USERS_LIST_PERMISSION)
  @Throttle({ default: USERS_LIST_THROTTLE })
  @ApiOperation({
    summary: 'List users',
    description:
      'Admins only (users@list). Cursor-paginated user directory with search, status filter and sorting. Rows carry the same fields as an admin profile read, including failedLoginAttempts and lockedUntil.',
  })
  @ApiOkResponse({ type: UserListResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid limit, sort, order, status or malformed cursor',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'The user is not an admin' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  listUsers(
    @CurrentUser() user: TokenPayload,
    @Query() query: ListUsersQueryDto,
  ): Promise<UserListPage> {
    return this.userProfileService.listUsers(user.sub, query);
  }

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

  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a user account',
    description:
      'Self: sends a 6-digit code to the account email and returns a challenge; finish the deletion via /deletion-confirm. Holders of users@delete (admins) delete other users immediately, with an optional audit reason.',
  })
  @ApiParam({ name: 'userId', format: 'uuid', description: 'Target user' })
  @ApiExtraModels(DeletionChallengeResponseDto, UserDeletedResponseDto)
  @ApiOkResponse({
    description: 'Deletion challenge issued, or the account was deleted',
    schema: DELETION_RESPONSE_SCHEMA,
  })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({
    description: "Deleting another user's account without admin rights",
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiConflictResponse({ description: 'Deletion is already in progress' })
  @ApiTooManyRequestsResponse({
    description: 'Resend cooldown or rate limit exceeded',
  })
  @ApiServiceUnavailableResponse({ description: 'Failed to send email' })
  deleteUser(
    @CurrentUser() user: TokenPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: DeleteUserDto,
  ): Promise<DeletionResult> {
    return this.userProfileService.deleteUser(user.sub, userId, dto);
  }

  @Post(':userId/deletion-confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm own account deletion',
    description:
      'Self only. Verifies the code, deletes the account and clears auth cookies.',
  })
  @ApiParam({ name: 'userId', format: 'uuid', description: 'Own user id' })
  @ApiOkResponse({ type: UserDeletedResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid or expired code' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'userId is not the current user' })
  @ApiNotFoundResponse({ description: 'User or challenge not found' })
  @ApiConflictResponse({ description: 'Deletion is already in progress' })
  @ApiTooManyRequestsResponse({
    description: 'Too many invalid attempts or rate limit exceeded',
  })
  async confirmDeletion(
    @CurrentUser() user: TokenPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ConfirmDeletionDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserDeleted> {
    const result = await this.userProfileService.confirmDeletion(
      user.sub,
      userId,
      dto,
    );

    this.authCookieService.clearAuthCookies(res);

    return result;
  }
}
