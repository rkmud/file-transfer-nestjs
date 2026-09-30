import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { ConversionStorage } from '../services/conversion-storage.service';
import { UploadCleanupInterceptor } from './upload-cleanup.interceptor';

describe('UploadCleanupInterceptor', () => {
  const remove = jest.fn().mockResolvedValue(undefined);
  const interceptor = new UploadCleanupInterceptor({
    remove,
  } as unknown as ConversionStorage);

  const contextFor = (request: object): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  beforeEach(() => remove.mockClear());

  it('removes the uploaded file after a successful handler', async () => {
    const next: CallHandler = { handle: () => of('result') };

    await expect(
      lastValueFrom(
        interceptor.intercept(contextFor({ file: { path: '/x/up' } }), next),
      ),
    ).resolves.toBe('result');
    expect(remove).toHaveBeenCalledWith('/x/up');
  });

  it('removes the uploaded file when the handler fails', async () => {
    const failure = new Error('boom');
    const next: CallHandler = { handle: () => throwError(() => failure) };

    await expect(
      lastValueFrom(
        interceptor.intercept(contextFor({ file: { path: '/x/up2' } }), next),
      ),
    ).rejects.toBe(failure);
    expect(remove).toHaveBeenCalledWith('/x/up2');
  });

  it('passes undefined when the request has no file', async () => {
    const next: CallHandler = { handle: () => of(null) };

    await lastValueFrom(interceptor.intercept(contextFor({}), next));

    expect(remove).toHaveBeenCalledWith(undefined);
  });
});
