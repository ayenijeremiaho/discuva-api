import 'dotenv/config';
import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Global,
  INestApplication,
  Injectable,
  MiddlewareConsumer,
  Module,
  NestModule,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import dbConfig from '../src/config/db.config';
import { TenantModule } from '../src/tenant/tenant.module';
import { Subscription } from '../src/billing/entity/subscription.entity';
import { Tenant } from '../src/tenant/entity/tenant.entity';
import { TenantMiddleware } from '../src/tenant/middleware/tenant.middleware';
import { TransactionHost, ClsPluginTransactional } from '@nestjs-cls/transactional';
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
 * Also covers the specific regression that shipped and was caught live,
 * post-Phase-8: a Guard querying the DB (GuardNotesCheckGuard below, standing
 * in for e.g. LocalAuthGuard's credential lookup) must see the same
 * tenant-scoped data a route handler does. The first version of this
 * middleware split "resolve tenant" (middleware) from "open the transaction
 * and SET LOCAL search_path" (a separate interceptor) — which passed this
 * file's original tests because none of them exercised a DB read from
 * inside a Guard, only from a route handler. NestJS runs Guards before
 * Interceptors, so that split silently never scoped guard-level queries.
 * TenantMiddleware now owns both jobs itself for exactly this reason.
 *
 * Run with: npm run test:e2e -- tenant-schema-isolation
 * Requires DATABASE_HOST etc. pointing at a real reachable Postgres — same
 * as every other DB-touching script in this repo.
 */

// Stands in for any Guard that touches the DB (LocalAuthGuard's credential
// lookup, AdminGuard's permission check, etc.) — the regression this
// specifically re-tests only shows up when a *Guard*, not a route handler,
// runs the query, since Guards run before Interceptors.
@Injectable()
class GuardNotesCheckGuard implements CanActivate {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  async canActivate(_context: ExecutionContext): Promise<boolean> {
    const rows = await this.txHost.tx.query('SELECT content FROM notes ORDER BY content');
    if (!rows.length) throw new UnauthorizedException('no notes visible to this guard');
    return true;
  }
}

// A minimal endpoint standing in for "any tenant-scoped route" — proves the
// full chain (middleware resolves tenant, opens the transaction, sets
// search_path -> a plain query, from both a Guard and the route handler,
// sees only that schema's data) without needing a real business entity.
@Controller('notes')
class TestNotesController {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  @Get()
  async list() {
    return this.txHost.tx.query('SELECT content FROM notes ORDER BY content');
  }

  @UseGuards(GuardNotesCheckGuard)
  @Get('guarded')
  async guardedList() {
    return this.txHost.tx.query('SELECT content FROM notes ORDER BY content');
  }
}

// TenantModule doesn't import BillingModule directly — in the real app it
// reaches Repository<Subscription> only because BillingModule is @Global().
// Mirroring that here (rather than importing the real BillingModule) avoids
// dragging in UtilityModule -> SanitizationService -> jsdom, which ts-jest
// can't parse (a pre-existing gap, see @exodus/bytes).
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Subscription])],
  exports: [TypeOrmModule],
})
class GlobalSubscriptionModule {}

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
    // TenantModule's own TenantProvisioningService provider needs
    // Repository<Subscription> resolvable — see GlobalSubscriptionModule
    // above for why this isn't just another TypeOrmModule.forFeature() call
    // here.
    GlobalSubscriptionModule,
    TenantModule,
  ],
  controllers: [TestNotesController],
  providers: [GuardNotesCheckGuard],
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

  // The actual regression test: a Guard (not the route handler) does the
  // DB read. Passing here is what the pre-fix architecture could not do —
  // GuardNotesCheckGuard ran before TenantTransactionInterceptor ever got a
  // chance to SET LOCAL search_path, so it always saw an empty `public`
  // result and rejected with 401 regardless of which tenant the request
  // was actually for.
  it("a Guard's own DB query sees the correct tenant's data too", async () => {
    const alphaRes = await request(app.getHttpServer())
      .get('/notes/guarded')
      .set('Host', 'isolation-alpha.test.local')
      .expect(200);
    expect(alphaRes.body).toEqual([{ content: 'alpha-only-note' }]);

    const betaRes = await request(app.getHttpServer())
      .get('/notes/guarded')
      .set('Host', 'isolation-beta.test.local')
      .expect(200);
    expect(betaRes.body).toEqual([{ content: 'beta-only-note' }]);
  });
});
