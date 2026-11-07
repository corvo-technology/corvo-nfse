import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { catchError, throwError } from 'rxjs';
import { ImportFileTooLargeError } from '../domain/import-error';

/**
 * The upload limit is enforced while the file is received, and that answers a generic payload error.
 * Placed before the file interceptor, this turns it into the import's own `ERROR_IMPORT_FILE_TOO_LARGE`.
 */
@Injectable()
export class MapUploadLimitInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    return next
      .handle()
      .pipe(
        catchError((error: unknown) =>
          throwError(() =>
            error instanceof PayloadTooLargeException
              ? new ImportFileTooLargeError()
              : error,
          ),
        ),
      );
  }
}
