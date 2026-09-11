import { Transform } from 'class-transformer';

export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();

export const NormalizeEmail = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  );
