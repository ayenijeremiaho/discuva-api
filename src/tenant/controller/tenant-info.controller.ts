import { Controller, Get, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { Public } from '../../auth/decorator/public.decorator';
import { Tenant } from '../entity/tenant.entity';
import { AppClsStore } from '../interface/tenant-cls-store.interface';

// Bypasses JWT auth but still goes through TenantMiddleware — the frontend
// calls this on mount to get branding for the current subdomain before a
// user is authenticated (docs/MULTI_TENANT_MIGRATION.md §4.7).
@Controller('tenant')
export class TenantInfoController {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
  ) {}

  @Public()
  @Get('info')
  async getInfo() {
    const tenantId = this.cls.get('tenantId');
    const tenant = tenantId
      ? await this.tenantRepository.findOneBy({ id: tenantId })
      : null;

    if (!tenant) throw new NotFoundException('Tenant not found');

    return {
      name: tenant.name,
      logoUrl: tenant.logoUrl,
      currency: tenant.currency,
      timezone: tenant.timezone,
    };
  }
}
