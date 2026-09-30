/**
 * Fakes only `Date` (via Jest modern timers) so time-dependent logic — OTP TTL,
 * lockout windows, RBAC cache TTL, retention `expiresAt` — is deterministic,
 * while real timers, `setImmediate` and `nextTick` keep working for supertest,
 * streams and worker code.
 */
export const DEFAULT_NOW = new Date('2026-01-15T10:00:00.000Z');

export interface FakeClock {
  now(): Date;
  set(date: Date | string): void;
  advance(ms: number): void;
  restore(): void;
}

export const useFakeClock = (start: Date | string = DEFAULT_NOW): FakeClock => {
  jest.useFakeTimers({
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
    now: new Date(start),
  });

  return {
    now: () => new Date(),
    set: (date) => jest.setSystemTime(new Date(date)),
    advance: (ms) => jest.setSystemTime(Date.now() + ms),
    restore: () => jest.useRealTimers(),
  };
};
