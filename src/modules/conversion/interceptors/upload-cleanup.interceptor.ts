import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { finalize, Observable } from 'rxjs';
import { ConversionStorage } from '../services/conversion-storage.service';

@Injectable()
export class UploadCleanupInterceptor implements NestInterceptor {
  constructor(private storage: ConversionStorage) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();

    return next
      .handle()
      .pipe(finalize(() => void this.storage.remove(request.file?.path)));
  }
}
