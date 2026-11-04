import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProtectedNameService } from '../../protected-name/protected-name.service';
import { InjectRepository } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { Repository } from 'typeorm';
import { Tenant } from '../entity/tenant.entity';
import { AppClsStore } from '../interface/tenant-cls-store.interface';
import { UpdateTenantProfileDto } from '../dto/update-tenant-profile.dto';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { CacheService } from '../../utility/service/cache.service';

export interface TenantProfileActor {
  adminId: string;
  memberId?: string;
}

@Injectable()
export class TenantProfileService {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    private readonly cacheService: CacheService,
    private readonly auditLogService: AuditLogService,
    private readonly protectedNames: ProtectedNameService,
  ) {}

  async getCurrentTenant(): Promise<Tenant> {
    const tenantId = this.cls.get('tenantId');
    const tenant = tenantId
      ? await this.tenantRepository.findOneBy({ id: tenantId })
      : null;
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async updateProfile(
    dto: UpdateTenantProfileDto,
    actor: TenantProfileActor,
  ): Promise<Tenant> {
    const tenant = await this.getCurrentTenant();
    await this.assertNameAllowed(tenant, dto.name);
    const previousThemePreset = tenant.themePreset;
    const themeChanged = Boolean(
      dto.themePreset && dto.themePreset !== previousThemePreset,
    );
    if (themeChanged) tenant.previousThemePreset = previousThemePreset;
    Object.assign(tenant, dto);
    await this.tenantRepository.save(tenant);
    this.cacheService.del(`tenant-branding:${tenant.id}`);
    if (themeChanged) {
      this.auditLogService.log('CHURCH_THEME_CHANGED', {
        actorId: actor.memberId,
        targetId: tenant.id,
        targetName: tenant.name,
        metadata: {
          adminId: actor.adminId,
          previousThemePreset,
          themePreset: tenant.themePreset,
        },
      });
    }
    return tenant;
  }

  // Verified accounts were checked by a person; others can't rename into a protected name.
  private async assertNameAllowed(
    tenant: Tenant,
    name: string | undefined,
  ): Promise<void> {
    if (!name || name === tenant.name || tenant.verifiedAt) return;
    if (await this.protectedNames.findNameMatch(name, tenant.id)) {
      throw new BadRequestException(
        'That name is protected. If it belongs to your church, contact us.',
      );
    }
  }
}
