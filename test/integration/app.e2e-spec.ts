import { Body, Controller, HttpCode, Module, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';
import { ALL_FEATURE_MODULES, createTestApp, TestApp } from '../setup';

class EchoDto {
  @IsString()
  name!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  count?: number;
}

@Controller('test-echo')
class EchoController {
  @Post()
  @HttpCode(200)
  echo(@Body() dto: EchoDto) {
    return { isDto: dto instanceof EchoDto, body: dto };
  }
}

@Module({ controllers: [EchoController] })
class EchoModule {}

describe('Cross-cutting (001-architecture)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ imports: [...ALL_FEATURE_MODULES, EchoModule] });
  });

  afterAll(() => t.close());

  beforeEach(() => t.reset());

  describe('GET /api/health', () => {
    it('returns 200 ok/up without authentication', async () => {
      const res = await t.http().get('/api/health').expect(200);

      expect(res.body).toEqual({ status: 'ok', database: 'up' });
      expect(t.db.query).toHaveBeenCalledWith('SELECT 1', undefined);
    });

    it('reports database down (still 200) when the query rejects', async () => {
      t.db.query.mockRejectedValueOnce(new Error('connection refused'));

      const res = await t.http().get('/api/health').expect(200);

      expect(res.body).toEqual({ status: 'error', database: 'down' });
    });
  });

  describe('global /api prefix', () => {
    it.each([
      ['get', '/health'],
      ['post', '/auth/login'],
      ['get', '/convert/formats'],
      ['get', '/transformations/history'],
    ] as const)('%s %s without the prefix -> 404', async (method, path) => {
      await t.http()[method](path).expect(404);
    });

    it('the same route is served under /api', async () => {
      await t.http().get('/api/health').expect(200);
    });
  });

  describe('global ValidationPipe', () => {
    it('strips unknown properties (whitelist) and transforms to the DTO', async () => {
      const res = await t
        .http()
        .post('/api/test-echo')
        .send({ name: 'a', count: '5', isAdmin: true, role: 'admin' })
        .expect(200);

      expect(res.body).toEqual({ isDto: true, body: { name: 'a', count: 5 } });
    });

    it('type-invalid body -> 400 with the Nest error shape', async () => {
      const res = await t
        .http()
        .post('/api/test-echo')
        .send({ name: 42, count: 'x' })
        .expect(400);

      expect(res.body).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: expect.arrayContaining([
          'name must be a string',
          'count must be an integer number',
        ]),
      });
    });

    it('stops at the first error per property', async () => {
      const res = await t
        .http()
        .post('/api/auth/login')
        .send({ email: 'not-an-email', password: 123 })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.error).toBe('Bad Request');
      expect(res.body.message).toHaveLength(2);
      expect(res.body.message).toEqual(
        expect.arrayContaining(['Invalid email', 'Password must be a string']),
      );
    });

    it('unknown properties on a real endpoint do not cause a 400', async () => {
      const user = await t.seedUser({ email: 'known@example.com' });

      const res = await t
        .http()
        .post('/api/auth/login')
        .send({
          email: user.email,
          password: 'wrong-password',
          isEmailVerified: true,
        })
        .expect(401);

      expect(res.body.statusCode).toBe(401);
    });
  });
});

describe('Throttling (001-architecture)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ env: { THROTTLE_LIMIT: '2' } });
  });

  afterAll(() => t.close());

  beforeEach(() => t.reset());

  it('exceeding THROTTLE_LIMIT on an auth endpoint -> 429', async () => {
    const attempt = () =>
      t
        .http()
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'whatever' });

    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);

    const blocked = await attempt();

    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ statusCode: 429 });
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('health is not throttled', async () => {
    for (let i = 0; i < 4; i++) {
      await t.http().get('/api/health').expect(200);
    }
  });
});
