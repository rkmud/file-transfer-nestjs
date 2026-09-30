import { plainToInstance } from 'class-transformer';
import { NormalizeEmail, normalizeEmail } from './normalize-email.decorator';

class Dto {
  @NormalizeEmail()
  email!: unknown;
}

const transform = (email: unknown) => plainToInstance(Dto, { email }).email;

describe('normalizeEmail', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('  John.Doe@Example.COM \t')).toBe(
      'john.doe@example.com',
    );
  });
});

describe('@NormalizeEmail()', () => {
  it.each([
    ['  User@Example.com  ', 'user@example.com'],
    ['UPPER@EXAMPLE.COM', 'upper@example.com'],
    ['already@example.com', 'already@example.com'],
    ['', ''],
  ])('normalizes %p to %p', (input, expected) => {
    expect(transform(input)).toBe(expected);
  });

  it.each([[42], [null], [undefined], [true], [{ a: 1 }], [['A@B.C']]])(
    'passes non-string input %p through unchanged',
    (input) => {
      expect(transform(input)).toEqual(input);
    },
  );
});
