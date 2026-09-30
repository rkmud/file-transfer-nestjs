import { INestApplication, ValidationPipe } from '@nestjs/common';
import { API_PREFIX, configureApp } from './app.setup';

describe('configureApp', () => {
  const build = () =>
    ({
      setGlobalPrefix: jest.fn(),
      use: jest.fn(),
      useGlobalPipes: jest.fn(),
    }) as unknown as jest.Mocked<INestApplication>;

  it('sets the /api prefix, cookie-parser and a whitelisting ValidationPipe', () => {
    const app = build();

    expect(configureApp(app)).toBe(app);
    expect(API_PREFIX).toBe('api');
    expect(app.setGlobalPrefix).toHaveBeenCalledWith('api');
    expect(app.use).toHaveBeenCalledTimes(1);
    expect(app.use).toHaveBeenCalledWith(expect.any(Function));
    expect(app.useGlobalPipes).toHaveBeenCalledTimes(1);

    const [pipe] = (app.useGlobalPipes as jest.Mock).mock.calls[0] as [
      ValidationPipe,
    ];

    expect(pipe).toBeInstanceOf(ValidationPipe);

    const internals = pipe as unknown as {
      isTransformEnabled: boolean;
      validatorOptions: Record<string, unknown>;
    };

    expect(internals.isTransformEnabled).toBe(true);
    expect(internals.validatorOptions).toMatchObject({
      whitelist: true,
      stopAtFirstError: true,
    });
  });

  it('installs a middleware that parses the Cookie header', () => {
    const app = build();

    configureApp(app);

    const [middleware] = (app.use as jest.Mock).mock.calls[0] as [
      (req: any, res: unknown, next: () => void) => void,
    ];
    const req: any = { headers: { cookie: 'access_token=abc; other=1' } };
    const next = jest.fn();

    middleware(req, {}, next);

    expect(next).toHaveBeenCalled();
    expect(req.cookies).toEqual({ access_token: 'abc', other: '1' });
  });
});
