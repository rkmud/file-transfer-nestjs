import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions } from '@nestjs/throttler';
import { ThrottleConfig } from '../config/configuration';

export const createThrottlerOptions = (
  configService: ConfigService,
): ThrottlerModuleOptions => {
  const { ttlSeconds, limit, blockSeconds } =
    configService.getOrThrow<ThrottleConfig>('throttle');

  return {
    throttlers: [
      {
        ttl: ttlSeconds * 1000,
        limit,
        blockDuration: blockSeconds * 1000,
      },
    ],
  };
};
