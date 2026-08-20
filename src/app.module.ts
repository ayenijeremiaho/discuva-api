import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { MulterModule } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { ClsModule } from 'nestjs-cls';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { DataSource } from 'typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UtilityModule } from './utility/utility.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';
import { AppThrottlerGuard } from './app-throttler.guard';
import dbConfig from './config/db.config';
import { envValidationSchema } from './config/env.validation';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { LoggerModule } from 'nestjs-pino';
import { MemberModule } from './member/member.module';
import { DepartmentModule } from './department/department.module';
import { ClergyTitleModule } from './clergy-title/clergy-title.module';
import { EventModule } from './event/event.module';
import { AttendanceModule } from './attendance/attendance.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { RequestLeaveModule } from './request-leave/request-leave.module';
import { NotesModule } from './notes/notes.module';
import { ClassesModule } from './classes/classes.module';
import { PastorFeedbackModule } from './pastor-feedback/pastor-feedback.module';
import { AnnouncementModule } from './announcement/announcement.module';
import { VenueModule } from './venue/venue.module';
import { SundaySchoolModule } from './sunday-school/sunday-school.module';
import { ChildrenChurchModule } from './children-church/children-church.module';
import { BirthdayModule } from './birthday/birthday.module';
import { MembershipAnniversaryModule } from './membership-anniversary/membership-anniversary.module';
import { ServiceRatingModule } from './service-rating/service-rating.module';
import { VolunteerModule } from './volunteer/volunteer.module';
import { SmallGroupModule } from './small-group/small-group.module';
import { AdminModule } from './admin/admin.module';
import { EnumsModule } from './enums/enums.module';
import { TitheModule } from './tithe/tithe.module';
import { FinanceRequestModule } from './finance-request/finance-request.module';
import { FollowUpModule } from './follow-up/follow-up.module';
import { ServiceProgrammeModule } from './service-programme/service-programme.module';
import { ServiceHeadcountModule } from './service-headcount/service-headcount.module';
import { ChurchSettingsModule } from './church-settings/church-settings.module';
import { ReminderSettingsModule } from './reminder-settings/reminder-settings.module';
import { EmailCategorySettingsModule } from './email-category-settings/email-category-settings.module';
import { IncidentReportModule } from './incident-report/incident-report.module';
import { SermonModule } from './sermon/sermon.module';
import { YoutubeModule } from './integrations/youtube/youtube.module';
import { GamesModule } from './games/games.module';
import { AssetManagementModule } from './asset-management/asset-management.module';
import { FinanceModule } from './finance/finance.module';
import { PrayerModule } from './prayer/prayer.module';
import { PrayerRequestModule } from './prayer-request/prayer-request.module';
import { FacilityRentalModule } from './facility-rental/facility-rental.module';
import { PushNotificationModule } from './push-notification/push-notification.module';
import { GroupModule } from './group/group.module';
import { SmsModule } from './sms/sms.module';
import { EvangelismModule } from './evangelism/evangelism.module';
import { BillingModule } from './billing/billing.module';
import { TenantModule } from './tenant/tenant.module';
import { PlatformAdminModule } from './platform-admin/platform-admin.module';
import { CommunicationProviderModule } from './communication-provider/communication-provider.module';
import { GivingCheckoutModule } from './giving-checkout/giving-checkout.module';
import { BranchModule } from './branch/branch.module';
import { FormsModule } from './forms/forms.module';
import { SocialMediaModule } from './social-media/social-media.module';

@Module({
  imports: [
    // Global CLS context — TenantMiddleware (src/tenant/) writes
    // tenantId/schemaName into it on every tenant-facing request and wraps
    // the rest of the request in a transaction via TransactionHost below,
    // with a SET LOCAL search_path scoping all of it to that tenant's
    // schema. See docs/MULTI_TENANT_MIGRATION.md §4.2/§4.4.
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        // Every request gets a correlation id via cls.getId(), independent
        // of tenant resolution — carried into Bull job payloads (§4.6) so a
        // processor log line can be traced back to the originating request.
        generateId: true,
        idGenerator: () => randomUUID(),
      },
      // Makes TransactionHost injectable app-wide — TenantMiddleware calls
      // TransactionHost#withTransaction directly (not an interceptor: NestJS
      // runs Guards before Interceptors, so a transaction opened at the
      // interceptor layer never covers guard-level DB access, e.g. the
      // local auth strategy's credential lookup during login — confirmed
      // empirically, see TenantMiddleware's own doc comment). Requests
      // excluded from TenantMiddleware (§4.3) never open this transaction;
      // their repository calls keep using the plain manager as before.
      plugins: [
        new ClsPluginTransactional({
          imports: [TypeOrmModule],
          adapter: new TransactionalAdapterTypeOrm({
            dataSourceToken: DataSource,
          }),
        }),
      ],
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
      load: [dbConfig],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    ThrottlerModule.forRootAsync({
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('THROTTLE_TTL_MS', 60_000),
          limit: config.get<number>('THROTTLE_LIMIT', 100),
        },
      ],
      inject: [ConfigService],
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isDev = config.get<string>('NODE_ENV') === 'development';
        return {
          pinoHttp: {
            level: isDev ? 'debug' : 'info',
            redact: {
              paths: [
                'req.body.password',
                'req.body.newPassword',
                'req.body.oldPassword',
                'req.body.confirmPassword',
              ],
              censor: '[REDACTED]',
            },
            serializers: {
              req(req) {
                return {
                  id: req.id,
                  method: req.method,
                  url: req.url,
                  query: req.query,
                  'content-type': req.headers['content-type'],
                  'user-agent': req.headers['user-agent'],
                  'x-real-ip': req.headers['x-real-ip'],
                };
              },
            },
            autoLogging: {
              ignore: (req: { url?: string }) =>
                req.url === '/v1/health' || req.url === '/health',
            },
            customLogLevel: (
              _req: unknown,
              res: { statusCode: number },
              err: unknown,
            ) => {
              if (err || res.statusCode >= 500) return 'error';
              if (res.statusCode >= 400) return 'warn';
              return 'info';
            },
            ...(isDev && {
              transport: {
                target: 'pino-pretty',
                options: { colorize: true, singleLine: false },
              },
            }),
          },
        };
      },
    }),
    ScheduleModule.forRoot(),
    MulterModule.register({
      limits: {
        fileSize:
          Number.parseInt(process.env.MAX_FILE_UPLOAD_BYTES ?? '', 10) ||
          5 * 1024 * 1024,
      },
    }),
    BullModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          db: config.get<number>('REDIS_DB', 0),
          ...(config.get<boolean>('REDIS_TLS') && { tls: {} }),
        },
        // Bull's own idle-worker timers (drainDelay, guardInterval,
        // stalledInterval) default to 5-30s and fire unconditionally per
        // registered queue, forever, regardless of tenant/job volume — with
        // 7 queues in this app that's ~250k+ Redis commands/day even with
        // zero jobs ever enqueued, which is what actually exhausted the
        // Upstash quota with no tenants live. drainDelay and guardInterval
        // are independent timers (confirmed in bull/lib/queue.js) with no
        // real latency cost at any value: Redis's blocking BRPOPLPUSH wakes
        // immediately the moment a real job is pushed regardless of this
        // ceiling, and guardInterval's ceiling self-adjusts down whenever a
        // delayed job is actually scheduled (none exist anywhere in this
        // codebase today) — so both are pushed to the practical max. Only
        // stalledInterval has a genuine tradeoff (how long a crashed
        // worker's job sits unclaimed before Bull retries it), so it's kept
        // shorter — 10 min is still a non-issue for this app's single
        // always-on machine and short-lived handlers.
        settings: {
          drainDelay: 3600, // seconds
          guardInterval: 3600000, // ms
          stalledInterval: 600000, // ms
        },
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forRootAsync({
      useFactory: dbConfig,
    }),
    AuthModule,
    UtilityModule,
    MemberModule,
    DepartmentModule,
    ClergyTitleModule,
    EventModule,
    AttendanceModule,
    DashboardModule,
    RequestLeaveModule,
    NotesModule,
    ClassesModule,
    PastorFeedbackModule,
    AnnouncementModule,
    VenueModule,
    SundaySchoolModule,
    ChildrenChurchModule,
    BirthdayModule,
    MembershipAnniversaryModule,
    ServiceRatingModule,
    VolunteerModule,
    SmallGroupModule,
    AdminModule,
    BillingModule,
    TenantModule,
    PlatformAdminModule,
    CommunicationProviderModule,
    GivingCheckoutModule,
    BranchModule,
    FormsModule,
    SocialMediaModule,
    EnumsModule,
    TitheModule,
    FinanceRequestModule,
    FollowUpModule,
    ServiceProgrammeModule,
    ServiceHeadcountModule,
    ChurchSettingsModule,
    ReminderSettingsModule,
    EmailCategorySettingsModule,
    IncidentReportModule,
    SermonModule,
    YoutubeModule,
    GamesModule,
    AssetManagementModule,
    FinanceModule,
    PrayerModule,
    PrayerRequestModule,
    FacilityRentalModule,
    PushNotificationModule,
    GroupModule,
    SmsModule,
    EvangelismModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule {}
