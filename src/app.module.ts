import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { MulterModule } from '@nestjs/platform-express';
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

@Module({
  imports: [
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
    EnumsModule,
    TitheModule,
    FinanceRequestModule,
    FollowUpModule,
    ServiceProgrammeModule,
    ServiceHeadcountModule,
    ChurchSettingsModule,
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
