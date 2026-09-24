export const USERS_PERMISSION = 'users';

export const USERS_ACTIONS = {
  read: 'read',
  update: 'update',
  delete: 'delete',
} as const;

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
