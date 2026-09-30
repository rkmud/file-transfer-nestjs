import { isUniqueViolation } from '@/modules/rbac/rbac.utils';

describe('isUniqueViolation', () => {
  it.each([
    [{ code: '23505' }, true],
    [{ code: '23503' }, false],
    [null, false],
    ['23505', false],
  ])('%p → %p', (error, expected) => {
    expect(isUniqueViolation(error)).toBe(expected);
  });
});
