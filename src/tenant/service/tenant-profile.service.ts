import { churchTimezoneKey } from '../../utility/service/church-timezone.service';
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
import { isBranch } from '../util/network-branding';

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
    const { useNetworkTheme, ...changes } = dto;
    if (useNetworkTheme && !isBranch(tenant)) {
      throw new BadRequestException(
        'Only a branch can follow its network’s theme.',
      );
    }
    const previousThemePreset = tenant.themePreset;
    const themeChanged = Boolean(
      changes.themePreset && changes.themePreset !== previousThemePreset,
    );
    if (themeChanged) tenant.previousThemePreset = previousThemePreset;
    Object.assign(tenant, changes);
    if (changes.themePreset) tenant.themeFromNetwork = false;
    if (useNetworkTheme) tenant.themeFromNetwork = true;
    await this.tenantRepository.save(tenant);
    this.clearBranding(tenant);
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

  // A top church's logo and theme show in all its branches, so their cached branding goes too.
  clearBranding(tenant: Pick<Tenant, 'id' | 'networkRootId'>): void {
    this.cacheService.del(`tenant-branding:${tenant.id}`);
    this.cacheService.delGlobal(churchTimezoneKey(tenant.id));
    if (tenant.networkRootId !== tenant.id) return;
    this.tenantRepository
      .find({ where: { networkRootId: tenant.id }, select: { id: true } })
      .then((rows) =>
        rows
          .filter((r) => r.id !== tenant.id)
          .forEach((r) =>
            this.cls.runWith({ tenantId: r.id } as AppClsStore, () =>
              this.cacheService.del(`tenant-branding:${r.id}`),
            ),
          ),
      )
      .catch(() => undefined);
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
