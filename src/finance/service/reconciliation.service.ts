import * as crypto from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { Queue } from 'bull';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { buildJobEnvelope } from '../../tenant/utility/job-envelope';
import { BulkUploadJob } from '../entity/bulk-upload-job.entity';
import { ReconciliationRow } from '../entity/reconciliation-row.entity';
import { JournalEntry } from '../entity/journal-entry.entity';
import { JournalEntryLine } from '../entity/journal-entry-line.entity';
import { BankImportProfile } from '../entity/bank-import-profile.entity';
import {
  BulkUploadJobStatus,
  BulkUploadType,
  JournalEntrySource,
  JournalEntryStatus,
  JournalEntryType,
  JournalLineType,
  ReconciliationRowStatus,
} from '../enum/finance.enum';
import {
  BulkConfirmReconciliationDto,
  ConfirmReconciliationRowDto,
  PostConfirmedRowsDto,
  ReconciliationRowQueryDto,
  SkipReconciliationRowDto,
} from '../dto/reconciliation.dto';
import { Admin } from '../../admin/entity/admin.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';
import {
  RECONCILIATION_PROCESS_JOB,
  RECONCILIATION_QUEUE,
} from '../processor/reconciliation.processor';
import { CsvParser } from '../util/csv-parser';
import { BankImportProfileService } from './bank-import-profile.service';

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @InjectRepository(BulkUploadJob)
    private readonly jobRepo: Repository<BulkUploadJob>,
    @InjectRepository(ReconciliationRow)
    private readonly rowRepo: Repository<ReconciliationRow>,
    @InjectRepository(JournalEntry)
    private readonly journalEntryRepo: Repository<JournalEntry>,
    @InjectRepository(JournalEntryLine)
    private readonly journalEntryLineRepo: Repository<JournalEntryLine>,
    @InjectQueue(RECONCILIATION_QUEUE)
    private readonly queue: Queue,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly bankImportProfileService: BankImportProfileService,
    private readonly auditLogService: AuditLogService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async uploadCsv(
    file: Express.Multer.File,
    admin: Admin,
    profileId?: string,
  ): Promise<BulkUploadJob> {
    const profile = await this.resolveProfile(profileId);

    const csvContent = file.buffer.toString('utf8');
    const validation = CsvParser.validate(csvContent, profile);
    if (!validation.isValid) {
      throw new BadRequestException({
        message: 'CSV does not match the selected profile.',
        totalRows: validation.totalRows,
        validRows: validation.validRows,
        failedRows: validation.failedRows.length,
        firstFailure: validation.firstFailure,
      });
    }

    const fileHash = crypto
      .createHash('sha256')
      .update(file.buffer)
      .digest('hex');
    const existing = await this.jobRepo.findOne({ where: { fileHash } });
    if (existing)
      throw new ConflictException('This file has already been uploaded.');

    const uploadJob = this.jobRepo.create({
      uploadType: BulkUploadType.CSV_RECONCILIATION,
      fileHash,
      originalFilename: file.originalname,
      status: BulkUploadJobStatus.QUEUED,
      profile: { id: profile.id } as any,
      createdBy: { id: admin.id } as any,
    });
    const saved = await this.jobRepo.save(uploadJob);

    await this.queue.add(
      RECONCILIATION_PROCESS_JOB,
      { jobId: saved.id, csvContent, ...buildJobEnvelope(this.cls) },
      { attempts: 3, backoff: 5000 },
    );

    this.auditLogService.log('RECONCILIATION_CSV_UPLOADED', {
      actorId: admin.id,
      targetId: saved.id,
      metadata: { filename: file.originalname, profileId: profile.id },
    });
    return saved;
  }

  async findAllJobs(
    page = 1,
    limit = 20,
  ): Promise<{
    data: BulkUploadJob[];
    totalCount: number;
    totalPages: number;
    page: number;
    limit: number;
  }> {
    const [data, totalCount] = await this.jobRepo.findAndCount({
      relations: ['createdBy', 'profile'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data,
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async findJob(id: string): Promise<BulkUploadJob> {
    const job = await this.jobRepo.findOne({
      where: { id },
      relations: ['createdBy', 'profile'],
    });
    if (!job) throw new NotFoundException('Reconciliation job not found.');
    return job;
  }

  async findRows(
    jobId: string,
    query: ReconciliationRowQueryDto,
  ): Promise<ReconciliationRow[]> {
    await this.findJob(jobId);
    const qb = this.rowRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.suggestedAccount', 'suggestedAccount')
      .leftJoinAndSelect('r.confirmedAccount', 'confirmedAccount')
      .where('r.job_id = :jobId', { jobId })
      .orderBy('r.transactionDate', 'ASC');

    if (query.status)
      qb.andWhere('r.status = :status', { status: query.status });

    return qb.getMany();
  }

  async confirmRow(
    rowId: string,
    dto: ConfirmReconciliationRowDto,
    _admin: Admin,
  ): Promise<ReconciliationRow> {
    const row = await this.rowRepo.findOne({
      where: { id: rowId },
      relations: ['job'],
    });
    if (!row) throw new NotFoundException('Reconciliation row not found.');
    if (row.status !== ReconciliationRowStatus.PENDING)
      throw new BadRequestException('Only pending rows can be confirmed.');

    row.status = ReconciliationRowStatus.CONFIRMED;
    row.confirmedAccount = { id: dto.accountId } as any;
    row.matchNote = dto.matchNote ?? null;
    return this.rowRepo.save(row);
  }

  async bulkConfirm(
    jobId: string,
    dto: BulkConfirmReconciliationDto,
    admin: Admin,
  ): Promise<{ confirmed: number }> {
    await this.findJob(jobId);

    const rowIds = dto.rows.map((r) => r.rowId);
    const rows = await this.rowRepo.findBy({
      id: In(rowIds),
      job: { id: jobId },
    });
    const rowMap = new Map(rows.map((r) => [r.id, r]));

    const toSave: ReconciliationRow[] = [];
    let confirmed = 0;

    for (const item of dto.rows) {
      const row = rowMap.get(item.rowId);
      if (row?.status !== ReconciliationRowStatus.PENDING) continue;
      row.status = ReconciliationRowStatus.CONFIRMED;
      row.confirmedAccount = { id: item.accountId } as any;
      toSave.push(row);
      confirmed++;
    }

    if (toSave.length > 0) await this.rowRepo.save(toSave);

    this.auditLogService.log('RECONCILIATION_BULK_CONFIRMED', {
      actorId: admin.id,
      targetId: jobId,
      metadata: { confirmed },
    });
    return { confirmed };
  }

  async skipRow(
    rowId: string,
    dto: SkipReconciliationRowDto,
    _admin: Admin,
  ): Promise<ReconciliationRow> {
    const row = await this.rowRepo.findOne({ where: { id: rowId } });
    if (!row) throw new NotFoundException('Reconciliation row not found.');
    if (row.status !== ReconciliationRowStatus.PENDING)
      throw new BadRequestException('Only pending rows can be skipped.');
    row.status = ReconciliationRowStatus.SKIPPED;
    row.matchNote = dto.matchNote ?? null;
    return this.rowRepo.save(row);
  }

  async postConfirmedRows(
    jobId: string,
    dto: PostConfirmedRowsDto,
    admin: Admin,
  ): Promise<{ created: number }> {
    const job = await this.findJob(jobId);
    if (
      job.status === BulkUploadJobStatus.QUEUED ||
      job.status === BulkUploadJobStatus.PARSING ||
      job.status === BulkUploadJobStatus.FAILED
    ) {
      throw new BadRequestException(
        'Job must be processed before posting entries.',
      );
    }

    const confirmedRows = await this.rowRepo.find({
      where: { job: { id: jobId }, status: ReconciliationRowStatus.CONFIRMED },
      relations: ['confirmedAccount'],
    });

    if (confirmedRows.length === 0)
      throw new BadRequestException('No confirmed rows found for this job.');

    // Batched idempotency pre-check — one SELECT for the whole batch instead
    // of one per row. Each row's posting is still isolated from the others
    // via a SAVEPOINT (not a separate this.dataSource.transaction() — that
    // would open a connection that never sees TenantMiddleware's SET LOCAL
    // search_path, same issue as elsewhere): a bad row (e.g. a duplicate
    // idempotency key from a rare concurrent race) rolls back to its own
    // savepoint and the loop continues, rather than poisoning the shared
    // ambient transaction for every row after it. The `idempotency_key`
    // column's DB-level UNIQUE constraint remains the actual guard against
    // double-posting under a race; the batched check here is purely an
    // optimization to skip already-posted rows in the common case.
    const idempotencyKeys = confirmedRows.map(
      (row) => `reconciliation-row:${row.id}`,
    );
    const alreadyPosted = await this.journalEntryRepo.find({
      where: { idempotencyKey: In(idempotencyKeys) },
      select: ['idempotencyKey'],
    });
    const alreadyPostedKeys = new Set(
      alreadyPosted.map((e) => e.idempotencyKey),
    );

    const manager = this.txHost.tx;
    let created = 0;
    let rowIndex = 0;
    for (const row of confirmedRows) {
      rowIndex++;
      const idempotencyKey = `reconciliation-row:${row.id}`;
      if (alreadyPostedKeys.has(idempotencyKey)) continue;
      if (!row.confirmedAccount) continue;

      const savepoint = `reconciliation_row_${rowIndex}`;
      try {
        await manager.query(`SAVEPOINT "${savepoint}"`);

        const isBankCredit = row.creditDebit === 'CREDIT';
        const debitAccountId = isBankCredit
          ? dto.bankAccountId
          : row.confirmedAccount!.id;
        const creditAccountId = isBankCredit
          ? row.confirmedAccount!.id
          : dto.bankAccountId;

        const entry = manager.create(JournalEntry, {
          date: row.transactionDate,
          description:
            row.narration ?? `Bank import: ${row.creditDebit} ${row.amount}`,
          source: JournalEntrySource.CSV_IMPORT,
          entryType: JournalEntryType.STANDARD,
          status: JournalEntryStatus.PENDING_APPROVAL,
          idempotencyKey,
          accountingPeriod: { id: dto.accountingPeriodId } as any,
          createdBy: { id: admin.id } as any,
        });
        const savedEntry = await manager.save(JournalEntry, entry);

        await manager.save(JournalEntryLine, [
          manager.create(JournalEntryLine, {
            journalEntry: { id: savedEntry.id } as any,
            account: { id: debitAccountId } as any,
            entryType: JournalLineType.DEBIT,
            amount: row.amount,
          }),
          manager.create(JournalEntryLine, {
            journalEntry: { id: savedEntry.id } as any,
            account: { id: creditAccountId } as any,
            entryType: JournalLineType.CREDIT,
            amount: row.amount,
          }),
        ]);

        row.status = ReconciliationRowStatus.POSTED;
        await manager.save(ReconciliationRow, row);
        created++;

        await manager.query(`RELEASE SAVEPOINT "${savepoint}"`);
      } catch (err: unknown) {
        await manager.query(`ROLLBACK TO SAVEPOINT "${savepoint}"`);
        const isDuplicateIdempotencyKey =
          err instanceof QueryFailedError &&
          (err as any).driverError?.code === '23505';
        if (!isDuplicateIdempotencyKey) throw err;
      }
    }

    this.auditLogService.log('RECONCILIATION_ROWS_POSTED', {
      actorId: admin.id,
      targetId: jobId,
      metadata: { created },
    });
    return { created };
  }

  private async resolveProfile(profileId?: string): Promise<BankImportProfile> {
    if (profileId) return this.bankImportProfileService.findOne(profileId);
    const def = await this.bankImportProfileService.findDefault();
    if (!def)
      throw new BadRequestException(
        'No default bank import profile configured. Please create one or specify a profileId.',
      );
    return def;
  }
}
