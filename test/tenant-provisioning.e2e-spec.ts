import 'dotenv/config';

// SanitizationService (pulled in transitively via UtilityModule, which
// AdminModule needs for AdminRoleService) eagerly constructs a real JSDOM
// in its own constructor. jsdom's own dependency chain includes an
// ESM-only package (@exodus/bytes) that jest's default ts-jest transform
// can't parse at all — a pre-existing gap, not something this test caused
// (the shipped test/app.e2e-spec.ts hits the identical parse error the
// moment it imports AppModule). Mocking both modules out avoids ever
// loading the real ones, sidestepping the parse failure entirely; this
// test never exercises sanitization, so a stub is safe.
jest.mock('dompurify', () => jest.fn(() => ({ sanitize: jest.fn((s) => s) })));
jest.mock('jsdom', () => ({ JSDOM: class { window = {}; } }));

import { Test } from '@nestjs/testing';
import { INestApplicationContext } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { TenantProvisioningService } from '../src/tenant/service/tenant-provisioning.service';
import { Tenant } from '../src/tenant/entity/tenant.entity';

/**
 * Proves the actual mechanics behind POST /signup and provision:tenant
 * work against real Postgres, not mocks: a new schema gets created, the
 * full business schema (122 tables) gets migrated into it via
 * TenantSchemaGenesis (not the public.-hardcoded Baseline, which cannot
 * target any schema but public — see that file's own doc comment), a real
 * admin gets seeded scoped correctly to the new schema, and the tenant row
 * flips active only once every step succeeds.
 *
 * Imports the full AppModule rather than a hand-assembled minimal module —
 * MemberService (needed for the seeded admin's Member repo) transitively
 * depends on PushNotificationService and others deep enough that
 * replicating the graph by hand turned into chasing one missing module
 * after another. AppModule's own wiring is already proven correct by the
 * live-boot tests in Phases 1-3.
 *
 * Run with: npm run test:e2e -- tenant-provisioning
 */

const TEST_SUBDOMAIN = 'e2e-provision-test';
const TEST_SCHEMA = 'church_e2e_provision_test';

describe('Tenant provisioning (e2e)', () => {
  let app: INestApplicationContext;
  let dataSource: DataSource;
  let provisioningService: TenantProvisioningService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    provisioningService = app.get(TenantProvisioningService);

    // Clean slate in case a previous failed run left state behind.
    await dataSource.query(`DELETE FROM subscriptions WHERE tenant_id IN (SELECT id FROM tenants WHERE subdomain = $1)`, [TEST_SUBDOMAIN]);
    await dataSource.query(`DELETE FROM tenants WHERE subdomain = $1`, [TEST_SUBDOMAIN]);
    await dataSource.query(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`);
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM subscriptions WHERE tenant_id IN (SELECT id FROM tenants WHERE subdomain = $1)`, [TEST_SUBDOMAIN]);
    await dataSource.query(`DELETE FROM tenants WHERE subdomain = $1`, [TEST_SUBDOMAIN]);
    await dataSource.query(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`);
    await app.close();
  });

  it('provisions a full working tenant: schema, migrated tables, admin, subscription, active flag', async () => {
    const tenant = await provisioningService.provision({
      subdomain: TEST_SUBDOMAIN,
      churchName: 'E2E Provision Test Church',
      adminFirstname: 'Test',
      adminLastname: 'Admin',
      adminEmail: 'e2e-provision-admin@example.com',
      adminPasswordHash: '$argon2id$fake-hash-for-test',
      planId: 'free',
    });

    expect(tenant.isActive).toBe(true);
    expect(tenant.schemaName).toBe(TEST_SCHEMA);

    const schemaRows = await dataSource.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
      [TEST_SCHEMA],
    );
    expect(schemaRows).toHaveLength(1);

    const tableCount = await dataSource.query(
      `SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema = $1`,
      [TEST_SCHEMA],
    );
    // 122 business tables from TenantSchemaGenesis + 1 migrations tracking table.
    expect(tableCount[0].c).toBe(123);

    const admins = await dataSource.query(
      `SELECT a.is_active, ar.name AS role_name, m.email
       FROM "${TEST_SCHEMA}".admins a
       JOIN "${TEST_SCHEMA}".members m ON m.id = a.member_id
       JOIN "${TEST_SCHEMA}".admin_roles ar ON ar.id = a.admin_role_id`,
    );
    expect(admins).toHaveLength(1);
    expect(admins[0].email).toBe('e2e-provision-admin@example.com');
    expect(admins[0].role_name).toBe('SuperAdmin');
    expect(admins[0].is_active).toBe(true);

    const subscription = await dataSource.query(
      `SELECT plan_id FROM subscriptions WHERE tenant_id = $1`,
      [tenant.id],
    );
    expect(subscription).toHaveLength(1);
    expect(subscription[0].plan_id).toBe('free');
  });

  it('rejects re-provisioning an already-active tenant', async () => {
    await expect(
      provisioningService.provision({
        subdomain: TEST_SUBDOMAIN,
        churchName: 'E2E Provision Test Church',
        adminFirstname: 'Test',
        adminLastname: 'Admin',
        adminEmail: 'e2e-provision-admin@example.com',
        adminPasswordHash: '$argon2id$fake-hash-for-test',
      }),
    ).rejects.toThrow('already in use');
  });

  it('resumes provisioning for a tenant row that exists but never finished', async () => {
    const resumeSubdomain = 'e2e-resume-test';
    const resumeSchema = 'church_e2e_resume_test';
    await dataSource.query(`DELETE FROM tenants WHERE subdomain = $1`, [resumeSubdomain]);
    await dataSource.query(`DROP SCHEMA IF EXISTS "${resumeSchema}" CASCADE`);

    // Simulate a crash right after the tenant row insert, before the
    // schema was ever created — provision() must detect this and continue
    // from here, not error or double-insert the tenant row.
    await dataSource.getRepository(Tenant).save(
      dataSource.getRepository(Tenant).create({
        subdomain: resumeSubdomain,
        schemaName: resumeSchema,
        name: 'Resume Test Church',
        isActive: false,
      }),
    );

    const tenant = await provisioningService.provision({
      subdomain: resumeSubdomain,
      churchName: 'Resume Test Church',
      adminFirstname: 'Resume',
      adminLastname: 'Admin',
      adminEmail: 'e2e-resume-admin@example.com',
      adminPasswordHash: '$argon2id$fake-hash-for-test',
    });

    expect(tenant.isActive).toBe(true);
    const tableCount = await dataSource.query(
      `SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema = $1`,
      [resumeSchema],
    );
    expect(tableCount[0].c).toBe(123);

    await dataSource.query(`DELETE FROM subscriptions WHERE tenant_id = $1`, [tenant.id]);
    await dataSource.query(`DELETE FROM tenants WHERE subdomain = $1`, [resumeSubdomain]);
    await dataSource.query(`DROP SCHEMA IF EXISTS "${resumeSchema}" CASCADE`);
  });
});
