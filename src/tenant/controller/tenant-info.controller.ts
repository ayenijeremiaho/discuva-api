import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import 'multer';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { ConfigService } from '@nestjs/config';
import { LimitedFileInterceptor } from '../../utility/interceptors/limited-file.interceptor';
import { Public } from '../../auth/decorator/public.decorator';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { Tenant } from '../entity/tenant.entity';
import { AppClsStore } from '../interface/tenant-cls-store.interface';
import { UpdateTenantProfileDto } from '../dto/update-tenant-profile.dto';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import { CacheService } from '../../utility/service/cache.service';
import { TenantAssetService } from '../service/tenant-asset.service';

const MAX_LOGO_UPLOAD_BYTES =
  Number.parseInt(process.env.MAX_LOGO_UPLOAD_BYTES ?? '', 10) ||
  5 * 1024 * 1024;

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
    private readonly cls: ClsService<AppClsStore>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly cacheService: CacheService,
    private readonly config: ConfigService,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    private readonly tenantAssetService: TenantAssetService,
  ) {}

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
  async updateInfo(@Body() dto: UpdateTenantProfileDto) {
    const tenant = await this.currentTenantOrThrow();
    Object.assign(tenant, dto);
    await this.tenantRepository.save(tenant);
    this.cacheService.del(`tenant-branding:${tenant.id}`);
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
    LimitedFileInterceptor('logo', MAX_LOGO_UPLOAD_BYTES, {
      fileFilter: imageOnlyFilter,
    }),
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
    this.cacheService.del(`tenant-branding:${tenant.id}`);

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
    this.cacheService.del(`tenant-branding:${tenant.id}`);

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
    LimitedFileInterceptor('image', MAX_LOGO_UPLOAD_BYTES, {
      fileFilter: imageOnlyFilter,
    }),
  )
  async setAsset(
    @Param('key') key: string,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    if (!image) throw new BadRequestException('No image file provided');
    const tenant = await this.currentTenantOrThrow();
    return {
      assets: await this.tenantAssetService.setOverride(tenant.id, key, image),
    };
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHURCH_PROFILE_WRITE)
  @Delete('assets/:key')
  async removeAsset(@Param('key') key: string) {
    const tenant = await this.currentTenantOrThrow();
    return {
      assets: await this.tenantAssetService.removeOverride(tenant.id, key),
    };
  }

  private async toProfile(tenant: Tenant) {
    return {
      name: tenant.name,
      // Same fallback EmailQueueService/PdfService already apply when a
      // tenant hasn't uploaded its own logo — without this, every
      // logo-consuming surface (favicon swap, PWA manifest icon) stayed
      // stuck on the bundled placeholder for any tenant that never visited
      // the branding page, instead of at least showing the platform default.
      logoUrl: tenant.logoUrl ?? this.config.get<string>('LOGO_URL') ?? null,
      tagline: tenant.tagline,
      address: tenant.address,
      supportEmail: tenant.supportEmail,
      pwaShortName: tenant.pwaShortName,
      currency: tenant.currency,
      timezone: tenant.timezone,
      assets: await this.tenantAssetService.getOverrides(tenant.id),
    };
  }

  private async currentTenantOrThrow(): Promise<Tenant> {
    const tenantId = this.cls.get('tenantId');
    const tenant = tenantId
      ? await this.tenantRepository.findOneBy({ id: tenantId })
      : null;

    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }
}
