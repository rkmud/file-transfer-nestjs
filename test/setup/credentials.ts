import { hashSync } from 'bcrypt';

/** Test-only credentials. Never used outside the test suite. */
export const TEST_PASSWORD = 'Test-Passw0rd!';

// Cost 4 keeps seeding fast; bcrypt.compare accepts any cost factor.
export const TEST_PASSWORD_HASH = hashSync(TEST_PASSWORD, 4);
