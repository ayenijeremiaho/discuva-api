import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { Public } from '../../auth/decorator/public.decorator';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { Tenant } from '../entity/tenant.entity';
import { AppClsStore } from '../interface/tenant-cls-store.interface';
import { UpdateTenantProfileDto } from '../dto/update-tenant-profile.dto';
import { CloudinaryService } from '../../utility/service/cloudinary.service';

// Bypasses JWT auth but still goes through TenantMiddleware — the frontend
// calls this on mount to get branding for the current subdomain before a
// user is authenticated (docs/MULTI_TENANT_MIGRATION.md §4.7).
@Controller('tenant')
export class TenantInfoController {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly cloudinaryService: CloudinaryService,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
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
    FileInterceptor('logo', {
      limits: { fileSize: 3 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(
            new BadRequestException('Only image files are allowed'),
            false,
          );
        }
        cb(null, true);
      },
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

    if (previousPublicId) {
      this.cloudinaryService.deleteByPublicId(previousPublicId, 'image');
    }

    return this.toProfile(tenant);
  }

  private toProfile(tenant: Tenant) {
    return {
      name: tenant.name,
      logoUrl: tenant.logoUrl,
      tagline: tenant.tagline,
      address: tenant.address,
      supportEmail: tenant.supportEmail,
      currency: tenant.currency,
      timezone: tenant.timezone,
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
