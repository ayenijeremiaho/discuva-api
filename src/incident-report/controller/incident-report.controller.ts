import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { IncidentReportService } from '../service/incident-report.service';
import { CreateIncidentReportDto } from '../dto/incident-report.dto';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { RequiresPlan } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';

@RequiresModule('incident_report')
@RequiresPlan(PlanFeature.INCIDENT_REPORT)
@UseGuards(JwtAuthGuard, ModuleEnabledGuard, PlanGuard)
@Controller('incidents')
export class IncidentReportController {
  constructor(private readonly incidentReportService: IncidentReportService) {}

  @Post()
  @UseInterceptors(
    FilesInterceptor('images', 5, {
      limits: {
        fileSize:
          Number.parseInt(process.env.MAX_FILE_UPLOAD_BYTES ?? '', 10) ||
          5 * 1024 * 1024,
      },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(
            new BadRequestException('Only image files are allowed'),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  create(
    @Body() dto: CreateIncidentReportDto,
    @CurrentUser() user: MemberAuth,
    @UploadedFiles() images?: Express.Multer.File[],
  ) {
    return this.incidentReportService.create(dto, user.id, images);
  }

  @Get()
  findAll(
    @CurrentUser() user: MemberAuth,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.incidentReportService.findMyReports(user.id, page, limit);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.incidentReportService.findMyReport(id, user.id);
  }
}
