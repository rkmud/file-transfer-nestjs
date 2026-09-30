/** @type {import('jest').Config} */
const tsJest = {
  '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
};

const collectCoverageFrom = [
  '**/*.ts',
  '!test/**',
  '!dist/**',
  '!coverage/**',
  '!**/*.d.ts',
  '!**/*.spec.ts',
  '!**/*.e2e-spec.ts',
  '!main.ts',
  '!src/main.ts',
  '!**/*.module.ts',
  '!**/dto/**',
  '!**/*.entity.ts',
  '!**/database/migrations/**',
  '!**/database/data-source.ts',
  '!**/core/swagger/**',
  '!**/*.types.ts',
  '!**/*.constants.ts',
];

const esmOnlyPackages = ['@nestjs/jwt', '@nestjs/mapped-types'];

const shared = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  transformIgnorePatterns: [
    `/node_modules/(?!(${esmOnlyPackages.join('|')})/)`,
  ],
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setup/env.ts'],
};

module.exports = {
  collectCoverageFrom,
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text-summary', 'lcov', 'html'],
  coverageThreshold: {
    global: { statements: 90, branches: 90, functions: 90, lines: 90 },
  },
  projects: [
    {
      ...shared,
      displayName: 'unit',
      rootDir: 'src',
      roots: ['<rootDir>'],
      testRegex: '.*\\.spec\\.ts$',
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
      transform: {
        '^.+\\.(t|j)s$': [
          'ts-jest',
          { tsconfig: '<rootDir>/../tsconfig.spec.json' },
        ],
      },
      setupFiles: ['<rootDir>/../test/setup/env.ts'],
    },
    {
      ...shared,
      displayName: 'integration',
      rootDir: '.',
      roots: ['<rootDir>/test'],
      testRegex: 'test/.*\\.e2e-spec\\.ts$',
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
      transform: tsJest,
    },
  ],
};
