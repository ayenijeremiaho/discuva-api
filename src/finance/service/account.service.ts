import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../entity/account.entity';
import {
  AccountQueryDto,
  CreateAccountDto,
  UpdateAccountDto,
} from '../dto/account.dto';
import { Admin } from '../../admin/entity/admin.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';

@Injectable()
export class AccountService {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(dto: CreateAccountDto, admin: Admin): Promise<Account> {
    const existing = await this.accountRepo.findOne({
      where: { name: dto.name },
    });
    if (existing)
      throw new ConflictException(
        `An account named '${dto.name}' already exists.`,
      );

    if (dto.code) {
      const codeConflict = await this.accountRepo.findOne({
        where: { code: dto.code },
      });
      if (codeConflict)
        throw new ConflictException(
          `Account code '${dto.code}' is already in use.`,
        );
    }

    const account = this.accountRepo.create({
      code: dto.code ?? null,
      name: dto.name,
      type: dto.type,
      subtype: dto.subtype,
      normalBalance: dto.normalBalance,
      fund: dto.fundId ? ({ id: dto.fundId } as any) : null,
      description: dto.description ?? null,
      bankName: dto.bankName ?? null,
      accountNumber: dto.accountNumber ?? null,
      lowBalanceAlertThreshold: dto.lowBalanceAlertThreshold ?? null,
    });
    const saved = await this.accountRepo.save(account);
    this.auditLogService.log('ACCOUNT_CREATED', {
      actorId: admin.id,
      targetId: saved.id,
      metadata: { name: saved.name, type: saved.type, subtype: saved.subtype },
    });
    return saved;
  }

  async findAll(query: AccountQueryDto): Promise<Account[]> {
    const qb = this.accountRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.fund', 'fund')
      .orderBy('a.type', 'ASC')
      .addOrderBy('a.name', 'ASC');

    if (query.type) qb.andWhere('a.type = :type', { type: query.type });
    if (query.subtype)
      qb.andWhere('a.subtype = :subtype', { subtype: query.subtype });
    if (query.fundId)
      qb.andWhere('a.fund_id = :fundId', { fundId: query.fundId });
    if (query.isActive !== undefined)
      qb.andWhere('a.isActive = :isActive', { isActive: query.isActive });

    return qb.getMany();
  }

  async findOne(id: string): Promise<Account> {
    const account = await this.accountRepo.findOne({
      where: { id },
      relations: ['fund'],
    });
    if (!account) throw new NotFoundException('Account not found.');
    return account;
  }

  async update(
    id: string,
    dto: UpdateAccountDto,
    admin: Admin,
  ): Promise<Account> {
    const account = await this.findOne(id);
    if (account.currentBalance !== 0 && dto.isActive === false) {
      throw new BadRequestException(
        'Cannot deactivate an account with a non-zero balance.',
      );
    }
    if (dto.code && dto.code !== account.code) {
      const codeConflict = await this.accountRepo.findOne({
        where: { code: dto.code },
      });
      if (codeConflict)
        throw new ConflictException(
          `Account code '${dto.code}' is already in use.`,
        );
    }

    Object.assign(account, {
      code: dto.code ?? account.code,
      name: dto.name ?? account.name,
      subtype: dto.subtype ?? account.subtype,
      fund: dto.fundId ? ({ id: dto.fundId } as any) : account.fund,
      description: dto.description ?? account.description,
      bankName: dto.bankName ?? account.bankName,
      accountNumber: dto.accountNumber ?? account.accountNumber,
      lowBalanceAlertThreshold:
        dto.lowBalanceAlertThreshold ?? account.lowBalanceAlertThreshold,
      isActive: dto.isActive ?? account.isActive,
    });
    const saved = await this.accountRepo.save(account);
    this.auditLogService.log('ACCOUNT_UPDATED', {
      actorId: admin.id,
      targetId: saved.id,
      metadata: dto as unknown as Record<string, unknown>,
    });
    return saved;
  }
}
