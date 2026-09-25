import { RBAC_ACTION_SEPARATOR } from '@/modules/rbac/rbac.constants';

export const USERS_PERMISSION = 'users';

export const USERS_ACTIONS = {
  read: 'read',
  update: 'update',
  delete: 'delete',
  list: 'list',
} as const;

export const USERS_LIST_PERMISSION = `${USERS_PERMISSION}${RBAC_ACTION_SEPARATOR}${USERS_ACTIONS.list}`;

export const USERS_LIST_THROTTLE = { limit: 5, ttl: 60_000 } as const;

export const USERS_LIST_DEFAULT_LIMIT = 20;
export const USERS_LIST_MAX_LIMIT = 100;
export const USERS_LIST_SEARCH_MAX_LENGTH = 100;
export const USERS_LIST_CURSOR_MAX_LENGTH = 512;

export const SELF_EDITABLE_FIELDS = [
  'firstName',
  'lastName',
  'phone',
  'bio',
  'locale',
] as const;

export const ADMIN_ONLY_FIELDS = [
  'email',
  'isEmailVerified',
  'failedLoginAttempts',
  'lockedUntil',
  'password',
] as const;

export const AVATAR_FIELD = 'photo';
export const AVATARS_SUBDIR = 'avatars';

export const NAME_MAX_LENGTH = 100;
export const PHONE_MAX_LENGTH = 32;
export const BIO_MAX_LENGTH = 500;
export const LOCALE_MAX_LENGTH = 16;
export const DELETION_REASON_MAX_LENGTH = 500;
