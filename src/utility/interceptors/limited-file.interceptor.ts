import {
  CallHandler,
  ExecutionContext,
  Injectable,
  mixin,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Observable } from 'rxjs';

type MulterOptions = NonNullable<Parameters<typeof FileInterceptor>[1]>;

export function LimitedFileInterceptor(
  fieldName: string,
  limitBytes: number,
  extraOptions?: Omit<MulterOptions, 'limits'>,
) {
  const limitMb = Math.round(limitBytes / (1024 * 1024));
  const FileInterceptorMixin = FileInterceptor(fieldName, {
    ...extraOptions,
    limits: { fileSize: limitBytes },
  });

  @Injectable()
  class LimitedInterceptor
    extends (FileInterceptorMixin as any)
    implements NestInterceptor
  {
    async intercept(
      context: ExecutionContext,
      next: CallHandler,
    ): Promise<Observable<any>> {
      try {
        return await super.intercept(context, next);
      } catch (err) {
        if (err instanceof PayloadTooLargeException) {
          throw new PayloadTooLargeException(
            `The uploaded file exceeds the maximum allowed size of ${limitMb} MB. Please upload a smaller file.`,
          );
        }
        throw err;
      }
    }
  }

  return mixin(LimitedInterceptor);
}
