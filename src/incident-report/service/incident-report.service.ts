import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { IncidentReport } from '../entity/incident-report.entity';
import {
  CreateIncidentReportDto,
  UpdateIncidentStatusDto,
} from '../dto/incident-report.dto';
import { IncidentStatus } from '../enum/incident-status.enum';
import { CacheService } from '../../utility/service/cache.service';
import { UtilityService } from '../../utility/service/utility.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import { Admin } from '../../admin/entity/admin.entity';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';

@Injectable()
export class IncidentReportService {
  private readonly logger = new Logger(IncidentReportService.name);

  constructor(
    @InjectRepository(IncidentReport)
    private readonly reportRepo: Repository<IncidentReport>,
    @InjectRepository(Admin)
    private readonly adminRepo: Repository<Admin>,
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService,
    private readonly utilityService: UtilityService,
    private readonly auditLogService: AuditLogService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  private rateLimitKey(memberId: string): string {
    return `rate-limit:incident-report:${memberId}`;
  }

  async create(
    dto: CreateIncidentReportDto,
    memberId: string,
    imageFiles?: Express.Multer.File[],
  ): Promise<IncidentReport> {
    const limit = this.configService.get<number>(
      'INCIDENT_DAILY_REPORT_LIMIT',
      2,
    );
    const count = await this.cacheService.incr(
      this.rateLimitKey(memberId),
      86400,
    );
    if (count > limit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'TOO_MANY_REQUESTS',
          message: `You can only submit ${limit} incident reports per day.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    let imageUrls: string[] | null = null;
    if (imageFiles?.length) {
      const uploads = await Promise.all(
        imageFiles.map((f) =>
          this.cloudinaryService.uploadBuffer(
            f.buffer,
            'incident-images',
            undefined,
            f.mimetype,
          ),
        ),
      );
      imageUrls = uploads.map((u) => u.secureUrl);
    }

    const report = this.reportRepo.create({
      title: dto.title,
      description: dto.description,
      images: imageUrls,
      location: dto.location ?? null,
      isAnonymous: dto.isAnonymous ?? false,
      reporter: { id: memberId } as any,
    });
    const saved = await this.reportRepo.save(report);

    this.auditLogService.log('INCIDENT_REPORT_CREATED', {
      actorId: saved.isAnonymous ? undefined : memberId,
      targetId: saved.id,
      metadata: { title: saved.title, isAnonymous: saved.isAnonymous },
    });

    this.notifyAdmins(saved).catch((err) =>
      this.logger.error('Failed to notify admins of new incident report', err),
    );
    return saved;
  }

  async findMyReports(
    memberId: string,
    page: number,
    limit: number,
  ): Promise<PaginationResponseDto<IncidentReport>> {
    const [reports, total] = await this.reportRepo.findAndCount({
      where: { reporter: { id: memberId } },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(reports, page, limit, total);
  }

  async findMyReport(id: string, memberId: string): Promise<IncidentReport> {
    const report = await this.reportRepo.findOne({
      where: { id, reporter: { id: memberId } },
    });
    if (!report) throw new NotFoundException('Incident report not found');
    return report;
  }

  async findAll(
    page: number,
    limit: number,
    filters: {
      status?: IncidentStatus;
      dateFrom?: string;
      dateTo?: string;
    } = {},
  ): Promise<PaginationResponseDto<IncidentReport>> {
    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.dateFrom && filters.dateTo) {
      where.createdAt = Between(
        new Date(filters.dateFrom),
        new Date(`${filters.dateTo}T23:59:59.999Z`),
      );
    } else if (filters.dateFrom) {
      where.createdAt = MoreThanOrEqual(new Date(filters.dateFrom));
    } else if (filters.dateTo) {
      where.createdAt = LessThan(new Date(`${filters.dateTo}T23:59:59.999Z`));
    }

    const [reports, total] = await this.reportRepo.findAndCount({
      where,
      relations: ['reporter'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(reports, page, limit, total);
  }

  async findOne(id: string): Promise<IncidentReport> {
    const report = await this.reportRepo.findOne({
      where: { id },
      relations: ['reporter'],
    });
    if (!report) throw new NotFoundException('Incident report not found');
    return report;
  }

  async updateStatus(
    id: string,
    dto: UpdateIncidentStatusDto,
    admin: Admin,
  ): Promise<IncidentReport> {
    const report = await this.findOne(id);
    report.status = dto.status;
    if (dto.adminNotes !== undefined) report.adminNotes = dto.adminNotes;
    if (dto.status === IncidentStatus.RESOLVED) report.resolvedAt = new Date();
    const saved = await this.reportRepo.save(report);

    this.auditLogService.log('INCIDENT_REPORT_STATUS_UPDATED', {
      actorId: admin.member?.id,
      targetId: id,
      metadata: { status: dto.status },
    });

    return saved;
  }

  maskReporter(report: IncidentReport): IncidentReport {
    if (report.isAnonymous) {
      return { ...report, reporter: null };
    }
    return report;
  }

  private async notifyAdmins(report: IncidentReport): Promise<void> {
    const admins = await this.adminRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.member', 'm')
      .leftJoinAndSelect('a.adminRole', 'role')
      .where('a.isActive = true')
      .getMany();

    const recipients = admins
      .filter((a) =>
        a.adminRole?.permissions?.includes(
          AdminPermission.INCIDENT_REPORT_WRITE,
        ),
      )
      .map((a) => a.member?.email)
      .filter((e): e is string => !!e);

    for (const email of recipients) {
      this.utilityService.sendEmailWithTemplate(
        email,
        'New Incident Report Submitted',
        'incident-report-new',
        {
          title: report.title,
          location: report.location ?? 'Not specified',
          reportId: report.id,
        },
        undefined,
        EmailCategory.INCIDENT_REPORT,
      );
    }
  }
}
