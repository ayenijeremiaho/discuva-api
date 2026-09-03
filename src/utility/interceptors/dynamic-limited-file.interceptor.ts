import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  mixin,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Observable } from 'rxjs';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';

type MulterOptions = NonNullable<Parameters<typeof FileInterceptor>[1]>;
type UploadLimitSettingKey =
  | PlatformSettingKey.MAX_LOGO_UPLOAD_MB
  | PlatformSettingKey.MAX_AVATAR_UPLOAD_MB
  | PlatformSettingKey.MAX_CLASS_MATERIAL_UPLOAD_MB
  | PlatformSettingKey.MAX_FINANCE_PROOF_UPLOAD_MB
  | PlatformSettingKey.MAX_FORM_ATTACHMENT_UPLOAD_MB;

// Like LimitedFileInterceptor, but the enforced limit is a live
// platform-admin setting (PlatformSettingsService.getMaxUploadBytes)
// instead of a fixed number baked in at route-definition time.
//
// Multer's own `limits.fileSize` has to be a static number known when the
// route is decorated — it can't await a DB/cache read per request. So
// `hardCeilingBytes` is what Multer itself enforces while parsing (a
// generous, non-configurable safety net — see UPLOAD_HARD_CEILING_BYTES),
// and the *real*, admin-configured limit is checked afterward against the
// already-parsed file's size, inside intercept(). A file between the live
// limit and the hard ceiling is still fully buffered before being rejected
// — an accepted cost given how small these ceilings are (tens of MB, not
// hundreds) — rather than reimplementing Multer's own streaming internals.
export function DynamicLimitedFileInterceptor(
  fieldName: string,
  settingKey: UploadLimitSettingKey,
  hardCeilingBytes: number,
  extraOptions?: Omit<MulterOptions, 'limits'>,
) {
  const FileInterceptorMixin = FileInterceptor(fieldName, {
    ...extraOptions,
    limits: { fileSize: hardCeilingBytes },
  });

  @Injectable()
  class DynamicInterceptor
    extends (FileInterceptorMixin as any)
    implements NestInterceptor
  {
    // Not a constructor-param property (`private readonly x: T` in the
    // signature) — that shape makes TypeScript infer a private member into
    // this anonymous mixin class's public type (TS4094). A plain field
    // assigned in the body avoids it.
    platformSettingsService: PlatformSettingsService;

    constructor(
      @Inject(PlatformSettingsService)
      platformSettingsService: PlatformSettingsService,
    ) {
      super({});
      this.platformSettingsService = platformSettingsService;
    }

    async intercept(
      context: ExecutionContext,
      next: CallHandler,
    ): Promise<Observable<any>> {
      const limitBytes =
        await this.platformSettingsService.getMaxUploadBytes(settingKey);
      const limitMb = Math.round(limitBytes / (1024 * 1024));

      let observable: Observable<any>;
      try {
        observable = await super.intercept(context, next);
      } catch (err) {
        if (err instanceof PayloadTooLargeException) {
          throw new PayloadTooLargeException(
            `The uploaded file exceeds the maximum allowed size of ${limitMb} MB. Please upload a smaller file.`,
          );
        }
        throw err;
      }

      const request = context.switchToHttp().getRequest();
      const file = request.file as Express.Multer.File | undefined;
      if (file && file.size > limitBytes) {
        throw new PayloadTooLargeException(
          `The uploaded file exceeds the maximum allowed size of ${limitMb} MB. Please upload a smaller file.`,
        );
      }

      return observable;
    }
  }

  return mixin(DynamicInterceptor);
}
