import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import 'multer';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { DynamicLimitedFileInterceptor } from '../../utility/interceptors/dynamic-limited-file.interceptor';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';
import { UPLOAD_HARD_CEILING_BYTES } from '../../platform-admin/constant/known-platform-settings.constant';
import { Public } from '../../auth/decorator/public.decorator';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { Tenant } from '../entity/tenant.entity';
import { UpdateTenantProfileDto } from '../dto/update-tenant-profile.dto';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import { AccountTypeService } from '../../account-type/account-type.service';
import { TenantAssetService } from '../service/tenant-asset.service';
import { isBranch, withNetworkBranding } from '../util/network-branding';
import { phoneRegionFromLocale } from '../../utility/decorators/normalize-phone.decorator';
import { TenantProfileService } from '../service/tenant-profile.service';
import { TenantReportService } from '../service/tenant-report.service';
import { CreateTenantReportDto } from '../dto/tenant-report.dto';
import { OrganisationTypeEnum } from '../enum/organisation-type.enum';
import { Throttle } from '@nestjs/throttler';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';

function imageOnlyFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) {
  if (!file.mimetype.startsWith('image/')) {
    return cb(new BadRequestException('Only image files are allowed'), false);
  }
  cb(null, true);
}

// Bypasses JWT auth but still goes through TenantMiddleware — the frontend
// calls this on mount to get branding for the current subdomain before a
// user is authenticated (docs/MULTI_TENANT_MIGRATION.md §4.7).
@Controller('tenant')
export class TenantInfoController {
  constructor(
    private readonly cloudinaryService: CloudinaryService,
    private readonly accountTypes: AccountTypeService,
    private readonly config: ConfigService,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    private readonly tenantAssetService: TenantAssetService,
    private readonly tenantProfileService: TenantProfileService,
    private readonly tenantReports: TenantReportService,
  ) {}

  // Open to anyone, so someone being misled can report without an account.
  @Public()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('report')
  async report(@Body() dto: CreateTenantReportDto) {
    const tenant = await this.currentTenantOrThrow();
    await this.tenantReports.create(tenant, dto.reason, dto.reporterEmail);
  }

  @Public()
  @Get('info')
  async getInfo() {
    return this.toProfile(await this.currentTenantOrThrow());
  }

  // Tenant self-service counterpart to platform-admin's
  // PATCH /platform/tenants/:id (docs/MULTI_TENANT_MIGRATION.md §Phase 6c's
  // deferred write side, now built) — lets a church admin edit their own
  // profile instead of going through platform support for every change.
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHURCH_PROFILE_WRITE)
  @Patch('info')
  async updateInfo(
    @Body() dto: UpdateTenantProfileDto,
    @CurrentAdmin() admin: Admin,
  ) {
    const tenant = await this.tenantProfileService.updateProfile(dto, {
      adminId: admin.id,
      memberId: admin.member?.id,
    });
    return this.toProfile(tenant);
  }

  // Mirrors MemberController's POST members/me/photo — same size/mimetype
  // limits, same "delete the previous asset only after the new one is
  // safely saved" ordering, so a failed re-upload never leaves a tenant
  // with no logo at all.
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHURCH_PROFILE_WRITE)
  @Post('logo')
  @UseInterceptors(
    DynamicLimitedFileInterceptor(
      'logo',
      PlatformSettingKey.MAX_LOGO_UPLOAD_MB,
      UPLOAD_HARD_CEILING_BYTES[PlatformSettingKey.MAX_LOGO_UPLOAD_MB],
      { fileFilter: imageOnlyFilter },
    ),
  )
  async uploadLogo(@UploadedFile() logo?: Express.Multer.File) {
    if (!logo) throw new BadRequestException('No logo file provided');

    const tenant = await this.currentTenantOrThrow();
    const previousPublicId = tenant.logoPublicId;

    const uploaded = await this.cloudinaryService.uploadBuffer(
      logo.buffer,
      'church-logos',
      undefined,
      logo.mimetype,
    );
    tenant.logoUrl = uploaded.secureUrl;
    tenant.logoPublicId = uploaded.publicId;
    await this.tenantRepository.save(tenant);
    this.tenantProfileService.clearBranding(tenant);

    if (previousPublicId) {
      this.cloudinaryService.deleteByPublicId(previousPublicId, 'image');
    }

    return this.toProfile(tenant);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHURCH_PROFILE_WRITE)
  @Delete('logo')
  async removeLogo() {
    const tenant = await this.currentTenantOrThrow();
    const previousPublicId = tenant.logoPublicId;
    tenant.logoUrl = null;
    tenant.logoPublicId = null;
    await this.tenantRepository.save(tenant);
    this.tenantProfileService.clearBranding(tenant);

    if (previousPublicId) {
      this.cloudinaryService.deleteByPublicId(previousPublicId, 'image');
    }

    return this.toProfile(tenant);
  }

  // Read-only for every caller (member app renders from this, no editing
  // capability here beyond upload/revert below) — the catalog of what CAN
  // be overridden, independent of whether this tenant has overridden it.
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHURCH_PROFILE_WRITE)
  @Get('assets/catalog')
  getAssetCatalog() {
    return this.tenantAssetService.getCatalog();
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHURCH_PROFILE_WRITE)
  @Post('assets/:key')
  @UseInterceptors(
    DynamicLimitedFileInterceptor(
      'image',
      PlatformSettingKey.MAX_LOGO_UPLOAD_MB,
      UPLOAD_HARD_CEILING_BYTES[PlatformSettingKey.MAX_LOGO_UPLOAD_MB],
      { fileFilter: imageOnlyFilter },
    ),
  )
  async setAsset(
    @Param('key') key: string,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    if (!image) throw new BadRequestException('No image file provided');
    const tenant = await this.currentTenantOrThrow();
    await this.tenantAssetService.setOverride(tenant.id, key, image);
    return this.tenantAssetService.forDisplay(tenant);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHURCH_PROFILE_WRITE)
  @Delete('assets/:key')
  async removeAsset(@Param('key') key: string) {
    const tenant = await this.currentTenantOrThrow();
    await this.tenantAssetService.removeOverride(tenant.id, key);
    return this.tenantAssetService.forDisplay(tenant);
  }

  private async toProfile(own: Tenant) {
    const tenant = (await withNetworkBranding(this.tenantRepository, own))!;
    const { assets, fromNetwork } =
      await this.tenantAssetService.forDisplay(own);
    return {
      name: tenant.name,
      // Not sensitive — it's already visible in every discuva-member URL,
      // and the admin types it in at login. discuva-admin needs this as a
      // client-side "which tenant am I" signal for the rare public,
      // unauthenticated route (the Games presentation screen) that has no
      // JWT to read it from and no per-tenant subdomain of its own to
      // resolve it from either.
      subdomain: tenant.subdomain,
      orgType: tenant.orgType,
      wording: (await this.accountTypes.getProfile(tenant.orgType)).wording,
      privateGroup:
        tenant.orgType === OrganisationTypeEnum.GROUP && !tenant.verifiedAt,
      // Same fallback EmailQueueService/PdfService already apply when a
      // tenant hasn't uploaded its own logo — without this, every
      // logo-consuming surface (favicon swap, PWA manifest icon) stayed
      // stuck on the bundled placeholder for any tenant that never visited
      // the branding page, instead of at least showing the platform default.
      logoUrl:
        tenant.logoUrl ?? this.config.get<string>('PRODUCT_LOGO_URL') ?? null,
      tagline: tenant.tagline,
      address: tenant.address,
      supportEmail: tenant.supportEmail,
      pwaShortName: tenant.pwaShortName,
      // Set when the church is in a network, so the member app knows to load the branch list.
      networkRootId: tenant.networkRootId,
      themePreset: tenant.themePreset,
      previousThemePreset: tenant.previousThemePreset,
      currency: tenant.currency,
      timezone: tenant.timezone,
      // Same region the API uses to parse local-format phone numbers.
      phoneRegion: phoneRegionFromLocale(
        this.config.get<string>('CURRENCY_LOCALE', 'en-NG'),
      ),
      assets,
      // A branch's admins see which parts of its look come from the network, and can go back to them.
      network: isBranch(own)
        ? {
            logo: !own.logoUrl,
            theme: own.themeFromNetwork,
            assets: fromNetwork,
          }
        : null,
    };
  }

  private async currentTenantOrThrow(): Promise<Tenant> {
    return this.tenantProfileService.getCurrentTenant();
  }
}
