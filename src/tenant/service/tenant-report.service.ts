import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { PlatformAdmin } from '../../platform-admin/entity/platform-admin.entity';
import { PlatformAdminPermission } from '../../platform-admin/enum/platform-admin-permission.enum';
import { UtilityService } from '../../utility/service/utility.service';
import { TenantReport } from '../entity/tenant-report.entity';

const OPEN_REPORTS_SHOWN = 100;

@Injectable()
export class TenantReportService {
  constructor(
    @InjectRepository(TenantReport)
    private readonly reportRepo: Repository<TenantReport>,
    @InjectRepository(PlatformAdmin)
    private readonly adminRepo: Repository<PlatformAdmin>,
    private readonly utilityService: UtilityService,
    private readonly config: ConfigService,
  ) {}

  async create(
    tenant: { id: string; name: string; subdomain: string },
    reason: string,
    reporterEmail?: string,
  ): Promise<void> {
    await this.reportRepo.save(
      this.reportRepo.create({
        tenant: { id: tenant.id },
        reason,
        reporterEmail: reporterEmail ?? null,
      }),
    );
    const admins = await this.adminRepo.find({
      where: { isActive: true },
      relations: ['platformAdminRole'],
    });
    const heading = `${tenant.name} was reported`;
    const url = this.config.get<string>('PLATFORM_LOGIN_URL');
    for (const admin of admins) {
      if (
        admin.platformAdminRole.permissions.includes(
          PlatformAdminPermission.TENANTS_WRITE,
        )
      ) {
        this.utilityService.sendEmailWithTemplate(
          admin.email,
          heading,
          'account-lifecycle-notice',
          {
            heading,
            message: `Someone reported ${tenant.name} (${tenant.subdomain}). Review it at ${url}/tenants.`,
          },
        );
      }
    }
  }

  listOpen(): Promise<TenantReport[]> {
    return this.reportRepo
      .createQueryBuilder('r')
      .innerJoin('r.tenant', 't')
      .addSelect(['t.id', 't.name', 't.subdomain'])
      .where('r.reviewedAt IS NULL')
      .orderBy('r.createdAt', 'DESC')
      .take(OPEN_REPORTS_SHOWN)
      .getMany();
  }

  async markReviewed(id: string): Promise<void> {
    const result = await this.reportRepo.update(
      { id, reviewedAt: IsNull() },
      { reviewedAt: new Date() },
    );
    if (!result.affected) throw new NotFoundException('Report not found');
  }
}
