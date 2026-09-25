import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  SORT_ORDERS,
  SortOrder,
  USER_LIST_SORTS,
  USER_LIST_STATUSES,
  UserListSort,
  UserListStatus,
} from '@/modules/users/users.types';
import {
  USERS_LIST_CURSOR_MAX_LENGTH,
  USERS_LIST_DEFAULT_LIMIT,
  USERS_LIST_MAX_LIMIT,
  USERS_LIST_SEARCH_MAX_LENGTH,
} from '../user-profile.constants';
import { UserListItem, UserListPage } from '../user-profile.types';
import { AdminUserProfileResponseDto } from './user-profile.dto';

const emptyToUndefined = ({ value }: { value: unknown }) => {
  const trimmed = typeof value === 'string' ? value.trim() : value;

  return trimmed === '' ? undefined : trimmed;
};

export class ListUsersQueryDto {
  @ApiPropertyOptional({
    description: 'Opaque cursor from a previous page (nextCursor)',
    maxLength: USERS_LIST_CURSOR_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @MaxLength(USERS_LIST_CURSOR_MAX_LENGTH)
  @IsString({ message: 'cursor must be a string' })
  readonly cursor?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: USERS_LIST_MAX_LIMIT,
    default: USERS_LIST_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @Max(USERS_LIST_MAX_LIMIT)
  @Min(1)
  @IsInt({ message: 'limit must be an integer' })
  readonly limit: number = USERS_LIST_DEFAULT_LIMIT;

  @ApiPropertyOptional({
    description:
      'Case-insensitive search by email, first name, last name or exact id',
    maxLength: USERS_LIST_SEARCH_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @MaxLength(USERS_LIST_SEARCH_MAX_LENGTH)
  @IsString({ message: 'q must be a string' })
  readonly q?: string;

  @ApiPropertyOptional({
    enum: USER_LIST_STATUSES,
    description:
      'blocked: lockedUntil is in the future; active: not locked; deleted: always empty (accounts are hard-deleted)',
  })
  @IsOptional()
  @IsIn(USER_LIST_STATUSES)
  readonly status?: UserListStatus;

  @ApiPropertyOptional({ enum: USER_LIST_SORTS, default: 'created_at' })
  @IsOptional()
  @IsIn(USER_LIST_SORTS)
  readonly sort: UserListSort = 'created_at';

  @ApiPropertyOptional({ enum: SORT_ORDERS, default: 'desc' })
  @IsOptional()
  @IsIn(SORT_ORDERS)
  readonly order: SortOrder = 'desc';
}

export class UserListItemResponseDto
  extends AdminUserProfileResponseDto
  implements UserListItem {}

export class UserListResponseDto implements UserListPage {
  @ApiProperty({ type: [UserListItemResponseDto] })
  items!: UserListItemResponseDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as cursor to fetch the next page; null on the last page',
  })
  nextCursor!: string | null;
}
