export const USER_LIST_SORTS = ['created_at', 'last_login', 'email'] as const;
export const USER_LIST_STATUSES = ['active', 'blocked', 'deleted'] as const;
export const SORT_ORDERS = ['asc', 'desc'] as const;

export type UserListSort = (typeof USER_LIST_SORTS)[number];
export type UserListStatus = (typeof USER_LIST_STATUSES)[number];
export type SortOrder = (typeof SORT_ORDERS)[number];

export interface UserListKey {
  value: string | null;
  id: string;
}

export interface UserListQuery {
  q?: string;
  status?: UserListStatus;
  sort: UserListSort;
  order: SortOrder;
  limit: number;
  after?: UserListKey;
}

export interface UserListResult<T> {
  items: T[];
  nextKey: UserListKey | null;
}
