import { SetMetadata } from '@nestjs/common';
import { RBAC_PERMISSIONS_KEY } from '../rbac.constants';

export const RbacPermissions = (...permissions: string[]) =>
  SetMetadata(RBAC_PERMISSIONS_KEY, permissions);
