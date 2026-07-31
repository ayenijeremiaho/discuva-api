import * as path from 'node:path';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import dbConfig from '../../config/db.config';
import { Tenant } from '../entity/tenant.entity';
import { Subscription } from '../../billing/entity/subscription.entity';
import { Member } from '../../member/entity/member.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { AdminRole } from '../../admin/entity/admin-role.entity';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { AppClsStore } from '../interface/tenant-cls-store.interface';
import { RESERVED_SUBDOMAINS } from '../utility/extract-subdomain';
import { subdomainToSchemaName } from '../utility/schema-name';

export interface ProvisionTenantParams {
  subdomain: string;
  churchName: string;
  adminFirstname: string;
  adminLastname: string;
  adminEmail: string;
  adminPasswordHash: string;
  planId?: string;
}

// Shared by POST /signup and the provision:tenant CLI script — one
// implementation, not two to keep in sync (docs/MULTI_TENANT_MIGRATION.md
// §4.8). Every step checks existing state before acting, so calling
// provision() again for a tenant that crashed partway through resumes
// rather than erroring or double-creating.
@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async provision(params: ProvisionTenantParams): Promise<Tenant> {
    const subdomain = params.subdomain.toLowerCase();
    if (RESERVED_SUBDOMAINS.has(subdomain)) {
      throw new ConflictException(
        `"${subdomain}" is a reserved subdomain and can't be used.`,
      );
    }

    let tenant = await this.tenantRepo.findOneBy({ subdomain });
    if (tenant?.isActive) {
      throw new ConflictException('This subdomain is already in use.');
    }
    if (!tenant) {
      tenant = await this.tenantRepo.save(
        this.tenantRepo.create({
          subdomain,
          schemaName: subdomainToSchemaName(subdomain),
          name: params.churchName,
          isActive: false,
        }),
      );
      this.logger.log(
        `Tenant row created for "${subdomain}" (schema ${tenant.schemaName}), not yet active`,
      );
    }

    await this.ensureSchemaExists(tenant.schemaName);
    await this.runTenantMigrations(tenant.schemaName);
    await this.seedTenantAdmin(tenant, params);
    await this.ensureSubscription(tenant.id, params.planId ?? 'free');

    if (!tenant.isActive) {
      tenant.isActive = true;
      tenant = await this.tenantRepo.save(tenant);
    }

    this.logger.log(`Tenant "${subdomain}" provisioned and activated`);
    return tenant;
  }

  private async ensureSchemaExists(schemaName: string): Promise<void> {
    await this.dataSource.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
  }

  // A short-lived, single-connection DataSource scoped to the new schema.
  // Two things have to point at that schema, not one: the `schema` option
  // (so TypeORM's own migrations-tracking bookkeeping lands there) AND the
  // `-c search_path=...` connection startup parameter (so the migration
  // file's own raw, unqualified SQL resolves there too) — confirmed
  // empirically that setting only one or the other leaves the migrations
  // table or the actual tables in the wrong schema. A single connection
  // (poolSize 1) avoids a race where a second pooled connection picks up
  // work before its own startup parameter has taken effect.
  //
  // Points at src/migrations/tenant/, not src/migrations/ — that directory
  // holds a schema-agnostic twin of the (public.-hardcoded, and therefore
  // schema-portability-broken) Baseline migration, built specifically for
  // this. See src/migrations/tenant/1790726400000-TenantSchemaGenesis.ts.
  //
  // Public: also called directly by migrate-all-tenants.ts (§4.9) — a
  // schema already provisioned just needs pending migrations applied, not
  // the rest of provision()'s work re-run.
  async runTenantMigrations(schemaName: string): Promise<void> {
    const baseConfig = dbConfig();
    const tenantDataSource = new DataSource({
      ...baseConfig,
      schema: schemaName,
      migrations: [
        path.resolve(__dirname, '../../migrations/tenant') + '/*{.ts,.js}',
      ],
      migrationsRun: false,
      poolSize: 1,
      extra: {
        ...(baseConfig.extra as object),
        max: 1,
        min: 1,
        options: `-c search_path=${schemaName},public`,
      },
    });
    await tenantDataSource.initialize();
    try {
      await tenantDataSource.runMigrations();
    } finally {
      await tenantDataSource.destroy();
    }
  }

  // Runs inside a CLS context scoped to the new tenant, same SET LOCAL
  // search_path mechanism as TenantTransactionInterceptor (§4.4). Uses
  // this.txHost.tx (the transactional EntityManager) directly for every
  // read/write rather than @InjectRepository()-injected repositories or
  // AdminRoleService — confirmed empirically that those do NOT pick up
  // this method's manually-entered transaction the way they do inside a
  // real HTTP request handled by the interceptor: they kept resolving
  // against `public` regardless of the SET LOCAL, seeding the live
  // deployment's actual admins table instead of the new tenant schema (a
  // duplicate-key error on a second run was what surfaced it). Mirrors
  // DefaultAdminSeed's/AdminRoleService's own logic, but seeds the signup
  // form's real admin instead of an env-var placeholder.
  private async seedTenantAdmin(
    tenant: Tenant,
    params: ProvisionTenantParams,
  ): Promise<void> {
    await this.cls.runWith(
      { tenantId: tenant.id, schemaName: tenant.schemaName } as AppClsStore,
      () =>
        this.txHost.withTransaction(async () => {
          const tx = this.txHost.tx;
          await tx.query(
            `SET LOCAL search_path TO "${tenant.schemaName}", public`,
          );

          const [{ c: adminCount }] = await tx.query(
            'SELECT count(*)::int AS c FROM admins',
          );
          if (adminCount > 0) return;

          let superAdminRole = await tx.findOneBy(AdminRole, {
            name: 'SuperAdmin',
          });
          if (!superAdminRole) {
            superAdminRole = await tx.save(
              tx.create(AdminRole, {
                name: 'SuperAdmin',
                description: 'Full access to all admin features.',
                permissions: Object.values(AdminPermission),
              }),
            );
          }

          let member = await tx.findOneBy(Member, {
            email: params.adminEmail,
          });
          if (!member) {
            member = await tx.save(
              tx.create(Member, {
                firstname: params.adminFirstname,
                lastname: params.adminLastname,
                email: params.adminEmail,
                password: params.adminPasswordHash,
                role: MemberRoleEnum.MEMBER,
                status: MemberStatusEnum.ACTIVE,
                changedPassword: true,
              }),
            );
          }

          await tx.save(
            tx.create(Admin, {
              member,
              adminRole: superAdminRole,
              isActive: true,
            }),
          );
          this.logger.log(
            `Seeded SuperAdmin ${params.adminEmail} for tenant "${tenant.subdomain}"`,
          );
        }),
    );
  }

  private async ensureSubscription(
    tenantId: string,
    planId: string,
  ): Promise<void> {
    const existing = await this.subscriptionRepo.findOneBy({ tenantId });
    if (existing) return;
    await this.subscriptionRepo.save(
      this.subscriptionRepo.create({ tenantId, planId }),
    );
  }
}
