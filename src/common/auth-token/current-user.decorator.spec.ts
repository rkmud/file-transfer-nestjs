import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser } from './current-user.decorator';
import { TokenPayload } from './auth-token.types';

/* eslint-disable @typescript-eslint/no-explicit-any */

const getFactory = (): ((data: unknown, ctx: ExecutionContext) => unknown) => {
  class Target {
    handler(@CurrentUser() _user: TokenPayload) {
      return _user;
    }
  }

  const metadata = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    Target,
    'handler',
  ) as Record<string, { factory: any }>;

  return Object.values(metadata)[0].factory;
};

const contextFor = (request: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

describe('@CurrentUser()', () => {
  it('returns the payload the guard attached to request.user', () => {
    const payload: TokenPayload = {
      sub: 'user-1',
      email: 'a@example.com',
      type: 'access',
    };
    expect(getFactory()(undefined, contextFor({ user: payload }))).toBe(
      payload,
    );
  });

  it('returns undefined when no guard ran', () => {
    expect(getFactory()(undefined, contextFor({}))).toBeUndefined();
  });
});
