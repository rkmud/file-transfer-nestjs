export interface RbacCheck {
  userId: string;
  roles: string[];
  permission: string;
  action?: string;
}

export type GrantedActions = ReadonlySet<string> | null;

export interface RbacConfig {
  permissions: ReadonlyMap<string, ReadonlySet<string>>;
  grants: ReadonlyMap<string, ReadonlyMap<string, GrantedActions>>;
  userRoles: ReadonlyMap<string, readonly string[]>;
}

export type RbacEntity = 'role' | 'permission' | 'grant' | 'userRole';

export type RbacOperation = 'create' | 'update' | 'delete';

export interface RbacAuditContext {
  actorUserId: string;
  operation: RbacOperation;
  entity: RbacEntity;
  entityId?: string;
}

export interface GrantView {
  id: string;
  roleId: string;
  roleName: string;
  permissionId: string;
  permissionName: string;
  actions: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRoleView {
  id: string;
  userId: string;
  roleId: string;
  roleName: string;
  createdAt: Date;
}
