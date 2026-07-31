import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NextFunction, Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { Tenant } from '../entity/tenant.entity';
import { AppClsStore } from '../interface/tenant-cls-store.interface';
import { extractSubdomain } from '../utility/extract-subdomain';

// Not yet wired into AppModule — see src/tenant/tenant.module.ts for why.
// Resolves the tenant from the Host header and writes it into CLS; every
// downstream repository/service call in this request sees tenantId/
// schemaName through AppClsStore, never through an explicit parameter.
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly config: ConfigService,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const baseDomain = this.config.get<string>('APP_BASE_DOMAIN');
    const subdomain = extractSubdomain(req.hostname, baseDomain);

    if (!subdomain) {
      throw new NotFoundException('Tenant not found');
    }

    const tenant = await this.tenantRepository.findOneBy({
      subdomain,
      isActive: true,
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    this.cls.set('tenantId', tenant.id);
    this.cls.set('schemaName', tenant.schemaName);
    this.cls.set('clusterId', tenant.clusterId);
    next();
  }
}
