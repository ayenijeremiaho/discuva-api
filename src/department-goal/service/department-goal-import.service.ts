import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as ExcelJS from 'exceljs';
import { DepartmentGoalImportJob } from '../entity/department-goal-import-job.entity';
import { DepartmentGoalImportRow } from '../entity/department-goal-import-row.entity';
import { DepartmentGoalImportJobStatus } from '../enum/department-goal-import-job-status.enum';
import { DepartmentGoalImportRowStatus } from '../enum/department-goal-import-row-status.enum';
import { DepartmentGoalImportRowData } from '../interface/department-goal-import-row-data.interface';
import { DepartmentGoal } from '../entity/department-goal.entity';
import { Department } from '../../department/entity/department.entity';
import { CreateGoalDto } from '../dto/department-goal.dto';
import { DepartmentGoalService } from './department-goal.service';
import { ExcelService } from '../../utility/service/excel.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { Admin } from '../../admin/entity/admin.entity';

const TEMPLATE_COLUMNS = [
  { header: 'KPI', key: 'title' },
  { header: 'KPI Description', key: 'description' },
  { header: 'Timeline to Achieve Target', key: 'timelineToAchieve' },
] as const;

@Injectable()
export class DepartmentGoalImportService {
  constructor(
    @InjectRepository(DepartmentGoalImportJob)
    private readonly jobRepo: Repository<DepartmentGoalImportJob>,
    @InjectRepository(DepartmentGoalImportRow)
    private readonly rowRepo: Repository<DepartmentGoalImportRow>,
    @InjectRepository(DepartmentGoal)
    private readonly goalRepo: Repository<DepartmentGoal>,
    @InjectRepository(Department)
    private readonly departmentRepo: Repository<Department>,
    private readonly goalService: DepartmentGoalService,
    private readonly excelService: ExcelService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async generateTemplate(): Promise<Buffer> {
    return this.excelService.buildWorkbook(
      'Goals',
      TEMPLATE_COLUMNS.map((c) => ({ header: c.header, key: c.key })),
      [],
    );
  }

  async previewImport(
    cycleId: string,
    departmentId: string,
    file: Express.Multer.File,
    admin: Admin,
  ): Promise<DepartmentGoalImportJob & { rows: DepartmentGoalImportRow[] }> {
    const cycle = await this.goalService.getCycleOrThrow(cycleId);
    const department = await this.departmentRepo.findOneBy({
      id: departmentId,
    });
    if (!department) throw new NotFoundException('Department not found');

    // Fail fast, before parsing a single row — an admin shouldn't be able
    // to build up a preview for a cycle that's no longer open for this
    // department, only to have commit reject it later.
    await this.goalService.assertGoalWritable(cycle, departmentId);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as any);
    const sheet = workbook.worksheets[0];
    if (!sheet)
      throw new BadRequestException('The uploaded file has no sheet to read.');

    const headerRow = sheet.getRow(1);
    const columnIndexByKey = new Map<string, number>();
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = String(cell.value ?? '').trim();
      const match = TEMPLATE_COLUMNS.find(
        (c) => c.header.toLowerCase() === text.toLowerCase(),
      );
      if (match) columnIndexByKey.set(match.key, colNumber);
    });
    if (!columnIndexByKey.has('title')) {
      throw new BadRequestException(
        `The uploaded file must include a "${TEMPLATE_COLUMNS[0].header}" column.`,
      );
    }

    const rowsData: { rowNumber: number; data: DepartmentGoalImportRowData }[] =
      [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const data: DepartmentGoalImportRowData = {
        title: this.cellText(row, columnIndexByKey.get('title')),
        description: this.cellText(row, columnIndexByKey.get('description')),
        timelineToAchieve: this.cellText(
          row,
          columnIndexByKey.get('timelineToAchieve'),
        ),
      };
      const isBlank =
        !data.title && !data.description && !data.timelineToAchieve;
      if (isBlank) return;
      rowsData.push({ rowNumber, data });
    });

    // Validation runs in-memory (class-validator against already-parsed
    // data, no DB round trips per row) before the job is persisted at all,
    // so a single insert can carry the final validRows count instead of an
    // insert-then-update pair.
    let validCount = 0;
    const rowsWithErrors: {
      rowNumber: number;
      data: DepartmentGoalImportRowData;
      errors: string[];
    }[] = [];
    for (const { rowNumber, data } of rowsData) {
      const errors = await this.validateRow(data);
      if (errors.length === 0) validCount++;
      rowsWithErrors.push({ rowNumber, data, errors });
    }

    const job = this.jobRepo.create({
      cycle,
      department,
      originalFilename: file.originalname,
      status: DepartmentGoalImportJobStatus.READY_FOR_REVIEW,
      totalRows: rowsData.length,
      validRows: validCount,
      createdBy: admin,
    });
    const savedJob = await this.jobRepo.save(job);

    const rowEntities = rowsWithErrors.map(({ rowNumber, data, errors }) =>
      this.rowRepo.create({
        job: savedJob,
        rowNumber,
        data,
        errors,
        status: DepartmentGoalImportRowStatus.PENDING,
      }),
    );
    const savedRows = await this.rowRepo.save(rowEntities);

    this.auditLogService.log('DEPARTMENT_GOAL_IMPORT_PREVIEWED', {
      actorId: admin.id,
      targetId: savedJob.id,
      targetName: department.name,
      metadata: { cycleId, departmentId, totalRows: savedJob.totalRows },
    });

    return { ...savedJob, rows: savedRows };
  }

  async getJob(jobId: string): Promise<DepartmentGoalImportJob> {
    const job = await this.jobRepo.findOne({
      where: { id: jobId },
      relations: ['cycle', 'department'],
    });
    if (!job) throw new NotFoundException('Import job not found');
    return job;
  }

  async getJobRows(jobId: string): Promise<DepartmentGoalImportRow[]> {
    return this.rowRepo.find({
      where: { job: { id: jobId } },
      order: { rowNumber: 'ASC' },
    });
  }

  async commitImport(
    jobId: string,
    admin: Admin,
  ): Promise<{ createdCount: number; failedRows: DepartmentGoalImportRow[] }> {
    const job = await this.getJob(jobId);
    if (job.status === DepartmentGoalImportJobStatus.COMMITTED) {
      throw new BadRequestException('This import has already been committed.');
    }

    // Re-check writability at commit time too — the cycle's grace deadline
    // (or approval chain) may have closed the writing window since preview.
    await this.goalService.assertGoalWritable(job.cycle, job.department.id);

    const rows = await this.getJobRows(jobId);
    const eligibleRows = rows.filter((r) => r.errors.length === 0);
    const failedRows = rows.filter((r) => r.errors.length > 0);

    const created = await this.goalRepo.save(
      eligibleRows.map((r) =>
        this.goalRepo.create({
          cycle: job.cycle,
          department: job.department,
          title: r.data.title,
          description: r.data.description ?? null,
          timelineToAchieve: r.data.timelineToAchieve ?? null,
          createdByAdmin: admin,
        }),
      ),
    );

    for (let i = 0; i < eligibleRows.length; i++) {
      eligibleRows[i].status = DepartmentGoalImportRowStatus.CREATED;
      eligibleRows[i].createdGoalId = created[i].id;
    }
    await this.rowRepo.save([...eligibleRows, ...failedRows]);

    job.status = DepartmentGoalImportJobStatus.COMMITTED;
    job.createdCount = created.length;
    job.failedCommitCount = failedRows.length;
    await this.jobRepo.save(job);

    this.auditLogService.log('DEPARTMENT_GOAL_IMPORT_COMMITTED', {
      actorId: admin.id,
      targetId: job.id,
      targetName: job.department.name,
      metadata: {
        createdCount: created.length,
        failedCount: failedRows.length,
      },
    });

    return { createdCount: created.length, failedRows };
  }

  private async validateRow(
    data: DepartmentGoalImportRowData,
  ): Promise<string[]> {
    const dto = plainToInstance(CreateGoalDto, data);
    const violations = await validate(dto);
    return violations.flatMap((v) => Object.values(v.constraints ?? {}));
  }

  private cellText(
    row: ExcelJS.Row,
    colNumber: number | undefined,
  ): string | undefined {
    if (!colNumber) return undefined;
    const value = row.getCell(colNumber).value;
    if (value === null || value === undefined) return undefined;
    const text = String(value).trim();
    return text.length ? text : undefined;
  }
}
