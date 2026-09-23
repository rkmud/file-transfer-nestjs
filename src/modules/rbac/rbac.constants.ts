export const RBAC_PERMISSIONS_KEY = 'rbac:permissions';
export const RBAC_ACTION_SEPARATOR = '@';

export const RBAC_NAME_MAX_LENGTH = 100;
export const RBAC_DESCRIPTION_MAX_LENGTH = 255;

/**
 * Names of permissions, roles and actions are used as identifiers in
 * `resource@action` strings, so the action separator is not allowed inside them.
 */
export const RBAC_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/;

export const RBAC_ADMIN_ROLE = 'admin';
export const RBAC_USER_ROLE = 'user';
export const RBAC_ADMIN_PERMISSION = 'rbac';

export const RBAC_ADMIN_ACTIONS = {
  read: 'read',
  create: 'create',
  update: 'update',
  delete: 'delete',
} as const;

const adminPermission = (action: string): string =>
  `${RBAC_ADMIN_PERMISSION}${RBAC_ACTION_SEPARATOR}${action}`;

export const RBAC_ADMIN_PERMISSIONS = {
  read: adminPermission(RBAC_ADMIN_ACTIONS.read),
  create: adminPermission(RBAC_ADMIN_ACTIONS.create),
  update: adminPermission(RBAC_ADMIN_ACTIONS.update),
  delete: adminPermission(RBAC_ADMIN_ACTIONS.delete),
} as const;
