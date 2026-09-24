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

export interface EmailChangeChallenge {
  requiresConfirmation: true;
  challengeId: string;
  expiresAt: string;
}

export interface EmailChangeConfirmed {
  message: string;
  email: string;
}

export interface DeletionChallenge {
  requiresConfirmation: true;
  challengeId: string;
  expiresAt: string;
  message: string;
}

export interface UserDeleted {
  message: string;
  userId: string;
}

export type DeletionResult = DeletionChallenge | UserDeleted;

export type AvatarFormat = 'jpg' | 'png' | 'webp' | 'gif';
