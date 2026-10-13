import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map } from 'rxjs';
import { DataEnvelope } from './response';
import { CursorPage } from './pagination';

export const RAW_RESPONSE = 'http:raw-response';
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const targets = [context.getHandler(), context.getClass()];
    const raw = this.reflector.getAllAndOverride<boolean>(
      RAW_RESPONSE,
      targets,
    );
    const response = context
      .switchToHttp()
      .getResponse<{ statusCode: number; headersSent: boolean }>();
    return next.handle().pipe(
      map((value: unknown) => {
        if (
          raw ||
          response.headersSent ||
          response.statusCode === 204 ||
          response.statusCode === 304 ||
          value instanceof StreamableFile ||
          value instanceof CursorPage ||
          value instanceof DataEnvelope
        )
          return value;
        return { data: value ?? null };
      }),
    );
  }
}
