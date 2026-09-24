export interface UserProfile {
  id: string;
  email: string;
  photo: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  bio: string | null;
  locale: string;
  isEmailVerified: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  updatedAt: Date;
}

export interface AdminUserProfile extends UserProfile {
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}
