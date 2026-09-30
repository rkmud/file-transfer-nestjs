import { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import configuration from '@/core/config/configuration';
import { LocalStorageService } from './storage/local-storage.service';
import { StorageService } from './storage/storage.service';
import { TransformationHistoryModule } from './transformation-history.module';

const storageFactory = (): FactoryProvider<StorageService> =>
  (
    Reflect.getMetadata('providers', TransformationHistoryModule) as unknown[]
  ).find(
    (provider): provider is FactoryProvider<StorageService> =>
      typeof provider === 'object' &&
      provider !== null &&
      (provider as FactoryProvider).provide === StorageService,
  )!;

const configWith = (backend: string) =>
  ({
    getOrThrow: jest.fn(() => ({ backend, localDir: 'storage/test' })),
  }) as unknown as ConfigService;

describe('TransformationHistoryModule StorageService factory', () => {
  const previous = process.env.STORAGE_BACKEND;

  afterEach(() => {
    if (previous === undefined) delete process.env.STORAGE_BACKEND;
    else process.env.STORAGE_BACKEND = previous;
  });

  it('injects ConfigService', () => {
    expect(storageFactory().inject).toEqual([ConfigService]);
  });

  it('resolves LOCAL_STORAGE to LocalStorageService', () => {
    const config = configWith('LOCAL_STORAGE');
    const storage = storageFactory().useFactory(config);

    expect(storage).toBeInstanceOf(LocalStorageService);
    expect(config.getOrThrow).toHaveBeenCalledWith('transformationStorage');
  });

  it('returns no backend for an unknown value (config validation guards it)', () => {
    expect(storageFactory().useFactory(configWith('S3'))).toBeUndefined();
  });

  it('defaults STORAGE_BACKEND to LOCAL_STORAGE', () => {
    delete process.env.STORAGE_BACKEND;

    expect(configuration().transformationStorage.backend).toBe('LOCAL_STORAGE');
  });

  it('fails at startup (config load) for an unknown STORAGE_BACKEND', () => {
    process.env.STORAGE_BACKEND = 'S3';

    expect(() => configuration()).toThrow(
      'STORAGE_BACKEND must be one of LOCAL_STORAGE, got "S3"',
    );
  });
});
