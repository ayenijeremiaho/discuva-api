import 'dotenv/config';
import {
  Controller,
  Get,
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import dbConfig from '../src/config/db.config';
import { TenantModule } from '../src/tenant/tenant.module';
import { Tenant } from '../src/tenant/entity/tenant.entity';
import { TenantMiddleware } from '../src/tenant/middleware/tenant.middleware';
import { TenantTransactionInterceptor } from '../src/tenant/interceptor/tenant-transaction.interceptor';
import { TransactionHost } from '@nestjs-cls/transactional';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { ClsModule } from 'nestjs-cls';

/**
 * Proves the one property this whole multi-tenant design exists to
 * guarantee: tenant A can never see tenant B's data, even when both
 * requests hit the same running process back to back. Runs against real
 * Postgres schemas, not mocks — a mocked repository can't catch a
 * search_path bug. See docs/MULTI_TENANT_MIGRATION.md §9 Phase 1 and §13's
 * AI Contributor Guidelines note on why this test is treated as a gate, not
 * an optional nice-to-have.
 *
 * Run with: npm run test:e2e -- tenant-schema-isolation
 * Requires DATABASE_HOST etc. pointing at a real reachable Postgres — same
 * as every other DB-touching script in this repo.
 */

// A minimal endpoint standing in for "any tenant-scoped route" — proves the
// full chain (middleware resolves tenant -> interceptor sets search_path ->
// a plain query sees only that schema's data) without needing a real
// business entity.
@Controller('notes')
class TestNotesController {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  @Get()
  async list() {
    return this.txHost.tx.query('SELECT content FROM notes ORDER BY content');
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
      plugins: [
        new ClsPluginTransactional({
          imports: [TypeOrmModule],
          adapter: new TransactionalAdapterTypeOrm({ dataSourceToken: DataSource }),
        }),
      ],
    }),
    TypeOrmModule.forRootAsync({ useFactory: dbConfig }),
    // Re-imported here (redundant with TenantModule's own import) because
    // NestJS resolves a middleware's constructor dependencies using the
    // module whose configure() calls consumer.apply(), not the middleware's
    // "home" module — TenantMiddleware needs Repository<Tenant> resolvable
    // in *this* module's scope too.
    TypeOrmModule.forFeature([Tenant]),
    TenantModule,
  ],
  controllers: [TestNotesController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },
  ],
})
class IsolationTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}

const SCHEMA_ALPHA = 'test_isolation_alpha';
const SCHEMA_BETA = 'test_isolation_beta';

describe('Tenant schema isolation (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let tenantAlphaId: string;
  let tenantBetaId: string;

  beforeAll(async () => {
    process.env.APP_BASE_DOMAIN = 'test.local';

    const moduleFixture = await Test.createTestingModule({
      imports: [IsolationTestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = moduleFixture.get(DataSource);

    // Two real schemas, each with the same table shape but disjoint data —
    // if isolation is broken, alpha's request would see beta's row (or
    // vice versa) instead of a clean 404 or an empty/own-only result.
    for (const schema of [SCHEMA_ALPHA, SCHEMA_BETA]) {
      await dataSource.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await dataSource.query(`CREATE SCHEMA ${schema}`);
      await dataSource.query(
        `CREATE TABLE ${schema}.notes (id SERIAL PRIMARY KEY, content VARCHAR NOT NULL)`,
      );
    }
    await dataSource.query(
      `INSERT INTO ${SCHEMA_ALPHA}.notes (content) VALUES ('alpha-only-note')`,
    );
    await dataSource.query(
      `INSERT INTO ${SCHEMA_BETA}.notes (content) VALUES ('beta-only-note')`,
    );

    const [alpha] = await dataSource.query(
      `INSERT INTO tenants (subdomain, schema_name, name) VALUES ($1, $2, $3) RETURNING id`,
      ['isolation-alpha', SCHEMA_ALPHA, 'Isolation Test Alpha'],
    );
    const [beta] = await dataSource.query(
      `INSERT INTO tenants (subdomain, schema_name, name) VALUES ($1, $2, $3) RETURNING id`,
      ['isolation-beta', SCHEMA_BETA, 'Isolation Test Beta'],
    );
    tenantAlphaId = alpha.id;
    tenantBetaId = beta.id;
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM tenants WHERE id IN ($1, $2)`, [
      tenantAlphaId,
      tenantBetaId,
    ]);
    await dataSource.query(`DROP SCHEMA IF EXISTS ${SCHEMA_ALPHA} CASCADE`);
    await dataSource.query(`DROP SCHEMA IF EXISTS ${SCHEMA_BETA} CASCADE`);
    await app.close();
  });

  it("alpha's request sees only alpha's data", async () => {
    const res = await request(app.getHttpServer())
      .get('/notes')
      .set('Host', 'isolation-alpha.test.local')
      .expect(200);

    expect(res.body).toEqual([{ content: 'alpha-only-note' }]);
  });

  it("beta's request sees only beta's data — never alpha's", async () => {
    const res = await request(app.getHttpServer())
      .get('/notes')
      .set('Host', 'isolation-beta.test.local')
      .expect(200);

    expect(res.body).toEqual([{ content: 'beta-only-note' }]);
  });

  it('an unrecognized subdomain is rejected, not silently defaulted', async () => {
    await request(app.getHttpServer())
      .get('/notes')
      .set('Host', 'no-such-tenant.test.local')
      .expect(404);
  });
});
