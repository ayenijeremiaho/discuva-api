import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { IncidentReport } from './entity/incident-report.entity';
import { IncidentReportService } from './service/incident-report.service';
import { IncidentReportController } from './controller/incident-report.controller';
import { AdminIncidentReportController } from './controller/admin-incident-report.controller';
import { UtilityModule } from '../utility/utility.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([IncidentReport]),
    UtilityModule,
    AdminModule,
  ],
  providers: [IncidentReportService],
  controllers: [IncidentReportController, AdminIncidentReportController],
})
export class IncidentReportModule {}
