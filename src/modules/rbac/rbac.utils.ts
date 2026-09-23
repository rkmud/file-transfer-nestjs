const UNIQUE_VIOLATION = '23505';

/**
 * Pre-checks cannot rule out two concurrent requests inserting the same row,
 * so unique violations coming back from Postgres are mapped to 409 as well.
 */
export const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === UNIQUE_VIOLATION;
