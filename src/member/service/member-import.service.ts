import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MemberImportJob } from '../entity/member-import-job.entity';
import { MemberImportRow } from '../entity/member-import-row.entity';
import { MemberImportJobStatus } from '../enums/member-import-job-status.enum';
import { MemberImportRowStatus } from '../enums/member-import-row-status.enum';
import { MemberImportRowData } from '../interface/member-import-row-data.interface';
import { Member } from '../entity/member.entity';
import { WorkerProfile } from '../entity/worker-profile.entity';
import { Department } from '../../department/entity/department.entity';
import { MemberRoleEnum } from '../enums/member-role.enum';
import { MemberStatusEnum } from '../enums/member-status.enum';
import { WorkerStatusEnum } from '../enums/worker-status.enum';
import { SignupDto } from '../dto/signup.dto';
import { ExcelService } from '../../utility/service/excel.service';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { ConfigService } from '@nestjs/config';
import { Admin } from '../../admin/entity/admin.entity';

interface TemplateColumn {
  header: string;
  key: keyof MemberImportRowData;
}

const TEMPLATE_COLUMNS: TemplateColumn[] = [
  { header: 'First Name*', key: 'firstname' },
  { header: 'Last Name*', key: 'lastname' },
  { header: 'Email*', key: 'email' },
  { header: 'Phone Number', key: 'phoneNumber' },
  { header: 'Gender (MALE/FEMALE)', key: 'gender' },
  { header: 'Birth Day (1-31)', key: 'birthDay' },
  { header: 'Birth Month (1-12)', key: 'birthMonth' },
  { header: 'Birth Year', key: 'birthYear' },
  {
    header: 'Marital Status (SINGLE/MARRIED/DIVORCED/WIDOWED)',
    key: 'maritalStatus',
  },
  { header: 'Year Born Again (4-digit year)', key: 'yearBornAgain' },
  { header: 'Year Baptized (4-digit year)', key: 'yearBaptized' },
  {
    header: 'Baptized With Holy Ghost (TRUE/FALSE)',
    key: 'baptizedWithHolyGhost',
  },
  { header: 'Date Joined Church (YYYY-MM-DD)', key: 'dateJoinedChurch' },
  { header: 'Department (optional — creates as Worker)', key: 'department' },
  { header: 'Profession', key: 'profession' },
  { header: 'Year Joined Workforce', key: 'yearJoinedWorkforce' },
];

@Injectable()
export class MemberImportService {
  private readonly logger = new Logger(MemberImportService.name);
  private readonly productName: string;
  private readonly churchName: string;
  private readonly churchAddress: string;

  constructor(
    @InjectRepository(MemberImportJob)
    private readonly jobRepository: Repository<MemberImportJob>,
    @InjectRepository(MemberImportRow)
    private readonly rowRepository: Repository<MemberImportRow>,
    @InjectRepository(Member)
    private readonly memberRepository: Repository<Member>,
    @InjectRepository(WorkerProfile)
    private readonly workerProfileRepository: Repository<WorkerProfile>,
    @InjectRepository(Department)
    private readonly departmentRepository: Repository<Department>,
    private readonly excelService: ExcelService,
    private readonly utilityService: UtilityService,
    private readonly auditLogService: AuditLogService,
    private readonly configService: ConfigService,
  ) {
    this.productName = this.configService.get<string>('PRODUCT_NAME');
    this.churchName = this.configService.get<string>('CHURCH_NAME');
    this.churchAddress = this.configService.get<string>('CHURCH_ADDRESS');
  }

  async generateTemplate(): Promise<Buffer> {
    return this.excelService.buildWorkbook(
      'Members',
      TEMPLATE_COLUMNS.map((c) => ({ header: c.header, key: c.key })),
      [],
    );
  }

  async previewImport(
    file: Express.Multer.File,
    admin: Admin,
  ): Promise<MemberImportJob> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as any);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new BadRequestException('The uploaded file has no worksheet.');
    }

    const headerRow = sheet.getRow(1);
    const columnIndexByKey = new Map<keyof MemberImportRowData, number>();
    headerRow.eachCell((cell, colNumber) => {
      const header = String(cell.value ?? '').trim();
      const match = TEMPLATE_COLUMNS.find((c) => c.header === header);
      if (match) columnIndexByKey.set(match.key, colNumber);
    });

    if (!columnIndexByKey.has('firstname') || !columnIndexByKey.has('email')) {
      throw new BadRequestException(
        'The uploaded file does not match the expected template — download a fresh template and try again.',
      );
    }

    const parsedRows: { rowNumber: number; data: MemberImportRowData }[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const get = (key: keyof MemberImportRowData): string | undefined => {
        const idx = columnIndexByKey.get(key);
        if (!idx) return undefined;
        const value = row.getCell(idx).value;
        if (value === null || value === undefined) return undefined;
        return String(value).trim() || undefined;
      };

      const data: MemberImportRowData = {
        firstname: get('firstname'),
        lastname: get('lastname'),
        email: get('email')?.toLowerCase(),
        phoneNumber: get('phoneNumber'),
        gender: get('gender')?.toUpperCase(),
        birthDay: get('birthDay') ? Number(get('birthDay')) : undefined,
        birthMonth: get('birthMonth') ? Number(get('birthMonth')) : undefined,
        birthYear: get('birthYear') ? Number(get('birthYear')) : undefined,
        maritalStatus: get('maritalStatus')?.toUpperCase(),
        yearBornAgain: get('yearBornAgain'),
        yearBaptized: get('yearBaptized'),
        baptizedWithHolyGhost: get('baptizedWithHolyGhost')
          ? /^(true|yes|1)$/i.test(get('baptizedWithHolyGhost')!)
          : undefined,
        dateJoinedChurch: get('dateJoinedChurch'),
        department: get('department'),
        profession: get('profession'),
        yearJoinedWorkforce: get('yearJoinedWorkforce'),
      };

      // Skip fully blank rows (e.g. trailing empty rows in the sheet)
      if (Object.values(data).every((v) => v === undefined)) return;

      parsedRows.push({ rowNumber, data });
    });

    if (parsedRows.length === 0) {
      throw new BadRequestException('The uploaded file has no data rows.');
    }

    const emailsInFile = new Map<string, number>();
    const rowsWithErrors: {
      rowNumber: number;
      data: MemberImportRowData;
      errors: string[];
    }[] = [];

    // Batched up front instead of queried per-row — a 1,000-row import used
    // to fire ~2,000 sequential DB round trips (one email lookup + one
    // department lookup per row) inside this loop.
    const candidateEmails = Array.from(
      new Set(
        parsedRows.map((r) => r.data.email).filter((e): e is string => !!e),
      ),
    );
    const existingEmails = new Set(
      candidateEmails.length
        ? (
            await this.memberRepository.find({
              where: { email: In(candidateEmails) },
              select: ['email'],
            })
          ).map((m) => m.email)
        : [],
    );
    const departmentByLowerName = new Map(
      (await this.departmentRepository.find()).map((d) => [
        d.name.toLowerCase(),
        d,
      ]),
    );

    for (const { rowNumber, data } of parsedRows) {
      const errors: string[] = [];

      const dtoInstance = plainToInstance(SignupDto, {
        firstname: data.firstname,
        lastname: data.lastname,
        email: data.email,
        phoneNumber: data.phoneNumber,
        gender: data.gender,
        birthDay: data.birthDay,
        birthMonth: data.birthMonth,
        birthYear: data.birthYear,
        maritalStatus: data.maritalStatus,
        yearBornAgain: data.yearBornAgain,
        yearBaptized: data.yearBaptized,
        baptizedWithHolyGhost: data.baptizedWithHolyGhost,
        dateJoinedChurch: data.dateJoinedChurch,
      });
      const validationErrors = await validate(dtoInstance);
      for (const ve of validationErrors) {
        errors.push(...Object.values(ve.constraints ?? {}));
      }

      if (data.email) {
        if (emailsInFile.has(data.email)) {
          errors.push(
            `Duplicate email in file — also used on row ${emailsInFile.get(data.email)}`,
          );
        } else {
          emailsInFile.set(data.email, rowNumber);
          if (existingEmails.has(data.email)) {
            errors.push('A member with this email already exists');
          }
        }
      }

      if (data.department) {
        if (!departmentByLowerName.has(data.department.toLowerCase())) {
          errors.push(`Unknown department: "${data.department}"`);
        }
      }

      rowsWithErrors.push({ rowNumber, data, errors });
    }

    const validRowCount = rowsWithErrors.filter(
      (r) => r.errors.length === 0,
    ).length;

    const job = await this.jobRepository.save(
      this.jobRepository.create({
        originalFilename: file.originalname,
        status: MemberImportJobStatus.READY_FOR_REVIEW,
        totalRows: rowsWithErrors.length,
        validRows: validRowCount,
        createdBy: admin,
      }),
    );

    await this.rowRepository.save(
      rowsWithErrors.map((r) =>
        this.rowRepository.create({
          job,
          rowNumber: r.rowNumber,
          data: r.data,
          errors: r.errors,
          status: MemberImportRowStatus.PENDING,
        }),
      ),
    );

    this.auditLogService.log('MEMBER_IMPORT_PREVIEWED', {
      actorId: admin.id,
      targetId: job.id,
      metadata: {
        filename: file.originalname,
        totalRows: job.totalRows,
        validRows: job.validRows,
      },
    });

    return this.getJob(job.id);
  }

  async getJob(jobId: string): Promise<MemberImportJob> {
    const job = await this.jobRepository.findOneBy({ id: jobId });
    if (!job) throw new NotFoundException('Import job not found');
    return job;
  }

  async getJobRows(jobId: string): Promise<MemberImportRow[]> {
    await this.getJob(jobId);
    return this.rowRepository.find({
      where: { job: { id: jobId } },
      order: { rowNumber: 'ASC' },
    });
  }

  async commitImport(
    jobId: string,
    admin: Admin,
  ): Promise<{
    createdCount: number;
    failedRows: { rowNumber: number; reason: string }[];
  }> {
    const job = await this.getJob(jobId);
    if (job.status === MemberImportJobStatus.COMMITTED) {
      throw new BadRequestException('This import has already been committed.');
    }

    const rows = await this.rowRepository.find({
      where: { job: { id: jobId } },
      order: { rowNumber: 'ASC' },
    });
    const validRows = rows.filter((r) => r.errors.length === 0);

    // Batched instead of a per-row email lookup + per-row department lookup
    // + per-row transaction — this fetches everything needed to validate
    // the whole batch in 2 queries, then commits every eligible row in one
    // transaction. A row can still fail here (email taken since the preview
    // ran, unknown department), but that's now resolved from these two
    // pre-fetched lookups rather than a DB round trip per row.
    const emails = validRows
      .map((r) => r.data.email)
      .filter((e): e is string => !!e);
    const existingMembers = emails.length
      ? await this.memberRepository.find({
          where: { email: In(emails) },
          select: ['email'],
        })
      : [];
    const existingEmails = new Set(existingMembers.map((m) => m.email));

    const departmentNames = Array.from(
      new Set(
        validRows
          .map((r) => r.data.department)
          .filter((d): d is string => !!d)
          .map((d) => d.toLowerCase()),
      ),
    );
    const departments = departmentNames.length
      ? await this.departmentRepository
          .createQueryBuilder('d')
          .where('LOWER(d.name) IN (:...names)', { names: departmentNames })
          .getMany()
      : [];
    const departmentByLowerName = new Map(
      departments.map((d) => [d.name.toLowerCase(), d]),
    );

    const failedRows: { rowNumber: number; reason: string }[] = [];
    const eligible: {
      row: MemberImportRow;
      member: Member;
      department: Department | null;
      tempPassword: string;
    }[] = [];

    for (const row of validRows) {
      const data = row.data;

      if (data.email && existingEmails.has(data.email)) {
        row.status = MemberImportRowStatus.FAILED;
        row.commitError = 'A member with this email already exists';
        failedRows.push({ rowNumber: row.rowNumber, reason: row.commitError });
        continue;
      }

      let department: Department | null = null;
      if (data.department) {
        department =
          departmentByLowerName.get(data.department.toLowerCase()) ?? null;
        if (!department) {
          row.status = MemberImportRowStatus.FAILED;
          row.commitError = `Unknown department: "${data.department}"`;
          failedRows.push({
            rowNumber: row.rowNumber,
            reason: row.commitError,
          });
          continue;
        }
      }

      const tempPassword = UtilityService.generateRandomPassword();
      const password = await UtilityService.hashValue(tempPassword);
      const member = this.memberRepository.create({
        firstname: data.firstname!,
        lastname: data.lastname!,
        email: data.email!,
        password,
        phoneNumber: data.phoneNumber,
        gender: data.gender as any,
        birthDay: data.birthDay ?? null,
        birthMonth: data.birthMonth ?? null,
        birthYear: data.birthYear ?? null,
        maritalStatus: data.maritalStatus as any,
        yearBornAgain: data.yearBornAgain
          ? new Date(`${data.yearBornAgain}-01-01`)
          : null,
        yearBaptized: data.yearBaptized
          ? new Date(`${data.yearBaptized}-01-01`)
          : null,
        baptizedWithHolyGhost: data.baptizedWithHolyGhost ?? false,
        dateJoinedChurch: data.dateJoinedChurch
          ? new Date(data.dateJoinedChurch)
          : null,
        role: department ? MemberRoleEnum.WORKER : MemberRoleEnum.MEMBER,
        status: MemberStatusEnum.ACTIVE,
        changedPassword: false,
      });

      eligible.push({ row, member, department, tempPassword });
    }

    let createdCount = 0;
    if (eligible.length > 0) {
      const savedMembers = await this.memberRepository.manager.transaction(
        async (tx) => {
          const saved = await tx.save(eligible.map((e) => e.member));
          const profiles = eligible
            .map((e, i) => ({
              department: e.department,
              row: e.row,
              member: saved[i],
            }))
            .filter(
              (
                e,
              ): e is {
                department: Department;
                row: MemberImportRow;
                member: Member;
              } => !!e.department,
            )
            .map((e) =>
              this.workerProfileRepository.create({
                member: e.member,
                department: e.department,
                status: WorkerStatusEnum.ACTIVE,
                profession: e.row.data.profession,
                yearJoinedWorkforce: e.row.data.yearJoinedWorkforce
                  ? new Date(`${e.row.data.yearJoinedWorkforce}-01-01`)
                  : null,
              }),
            );
          if (profiles.length > 0) await tx.save(profiles);
          return saved;
        },
      );

      for (let i = 0; i < eligible.length; i++) {
        const { row, tempPassword } = eligible[i];
        const savedMember = savedMembers[i];
        row.status = MemberImportRowStatus.CREATED;
        row.createdMemberId = savedMember.id;
        createdCount++;

        const firstName = UtilityService.capitalizeFirstLetter(
          savedMember.firstname,
        );
        this.utilityService.sendEmailWithTemplate(
          savedMember.email,
          `${firstName}, Welcome to ${this.productName}`,
          'welcome-member',
          {
            name: firstName,
            email: savedMember.email,
            password: tempPassword,
            churchName: this.churchName,
            churchAddress: this.churchAddress,
          },
        );
      }
    }

    await this.rowRepository.save(rows);

    job.status = MemberImportJobStatus.COMMITTED;
    job.createdCount = createdCount;
    job.failedCommitCount = failedRows.length;
    await this.jobRepository.save(job);

    this.logger.log(
      `Member import ${jobId} committed by admin ${admin.id}: ${createdCount} created, ${failedRows.length} failed`,
    );
    this.auditLogService.log('MEMBER_IMPORT_COMMITTED', {
      actorId: admin.id,
      targetId: jobId,
      metadata: { createdCount, failedCount: failedRows.length },
    });

    return { createdCount, failedRows };
  }
}
