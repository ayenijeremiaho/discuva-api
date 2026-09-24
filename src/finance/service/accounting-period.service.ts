import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountingPeriod } from '../entity/accounting-period.entity';
import { CreateAccountingPeriodDto } from '../dto/accounting-period.dto';
import { AccountingPeriodStatus } from '../enum/finance.enum';
import { Admin } from '../../admin/entity/admin.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';

@Injectable()
export class AccountingPeriodService {
  constructor(
    @InjectRepository(AccountingPeriod)
    private readonly periodRepo: Repository<AccountingPeriod>,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(
    dto: CreateAccountingPeriodDto,
    admin: Admin,
  ): Promise<AccountingPeriod> {
    const existing = await this.periodRepo.findOne({
      where: { year: dto.year, month: dto.month },
    });
    if (existing)
      throw new ConflictException(
        `Accounting period ${dto.year}-${String(dto.month).padStart(2, '0')} already exists.`,
      );

    const period = this.periodRepo.create({ year: dto.year, month: dto.month });
    const saved = await this.periodRepo.save(period);
    this.auditLogService.log('ACCOUNTING_PERIOD_CREATED', {
      actorId: admin.id,
      targetId: saved.id,
      targetName: `${dto.year}-${String(dto.month).padStart(2, '0')}`,
      metadata: { year: dto.year, month: dto.month },
    });
    return saved;
  }

  async findAll(): Promise<AccountingPeriod[]> {
    return this.periodRepo.find({ order: { year: 'DESC', month: 'DESC' } });
  }

  async findOne(id: string): Promise<AccountingPeriod> {
    const period = await this.periodRepo.findOne({
      where: { id },
      relations: ['closedBy'],
    });
    if (!period) throw new NotFoundException('Accounting period not found.');
    return period;
  }

  async close(id: string, admin: Admin): Promise<AccountingPeriod> {
    const period = await this.findOne(id);
    if (period.status === AccountingPeriodStatus.CLOSED)
      throw new ConflictException('Period is already closed.');
    period.status = AccountingPeriodStatus.CLOSED;
    period.closedAt = new Date();
    period.closedBy = admin;
    const saved = await this.periodRepo.save(period);
    this.auditLogService.log('ACCOUNTING_PERIOD_CLOSED', {
      actorId: admin.id,
      targetId: saved.id,
      targetName: `${saved.year}-${String(saved.month).padStart(2, '0')}`,
      metadata: { year: saved.year, month: saved.month },
    });
    return saved;
  }

  async reopen(id: string, admin: Admin): Promise<AccountingPeriod> {
    const period = await this.findOne(id);
    if (period.status === AccountingPeriodStatus.OPEN)
      throw new ConflictException('Period is already open.');
    period.status = AccountingPeriodStatus.OPEN;
    period.closedAt = null;
    period.closedBy = null;
    const saved = await this.periodRepo.save(period);
    this.auditLogService.log('ACCOUNTING_PERIOD_REOPENED', {
      actorId: admin.id,
      targetId: saved.id,
      targetName: `${saved.year}-${String(saved.month).padStart(2, '0')}`,
      metadata: { year: saved.year, month: saved.month },
    });
    return saved;
  }
}
