import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExternalPayee } from '../entity/external-payee.entity';
import {
  CreateExternalPayeeDto,
  UpdateExternalPayeeDto,
} from '../dto/external-payee.dto';
import { Admin } from '../../admin/entity/admin.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';

@Injectable()
export class ExternalPayeeService {
  constructor(
    @InjectRepository(ExternalPayee)
    private readonly payeeRepo: Repository<ExternalPayee>,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(
    dto: CreateExternalPayeeDto,
    admin: Admin,
  ): Promise<ExternalPayee> {
    const existing = await this.payeeRepo.findOne({
      where: { name: dto.name },
    });
    if (existing)
      throw new ConflictException(
        `An external payee named '${dto.name}' already exists.`,
      );

    const payee = this.payeeRepo.create({
      name: dto.name,
      type: dto.type,
      contactEmail: dto.contactEmail ?? null,
      contactPhone: dto.contactPhone ?? null,
      accountNumber: dto.accountNumber ?? null,
      bankName: dto.bankName ?? null,
      registrationNumber: dto.registrationNumber ?? null,
      notes: dto.notes ?? null,
    });
    const saved = await this.payeeRepo.save(payee);
    this.auditLogService.log('EXTERNAL_PAYEE_CREATED', {
      actorId: admin.id,
      targetId: saved.id,
      targetName: saved.name,
      metadata: { name: saved.name, type: saved.type },
    });
    return saved;
  }

  async findAll(): Promise<ExternalPayee[]> {
    return this.payeeRepo.find({ order: { name: 'ASC' } });
  }

  async findOne(id: string): Promise<ExternalPayee> {
    const payee = await this.payeeRepo.findOne({ where: { id } });
    if (!payee) throw new NotFoundException('External payee not found.');
    return payee;
  }

  async update(
    id: string,
    dto: UpdateExternalPayeeDto,
    admin: Admin,
  ): Promise<ExternalPayee> {
    const payee = await this.findOne(id);
    Object.assign(payee, {
      name: dto.name ?? payee.name,
      type: dto.type ?? payee.type,
      contactEmail: dto.contactEmail ?? payee.contactEmail,
      contactPhone: dto.contactPhone ?? payee.contactPhone,
      accountNumber: dto.accountNumber ?? payee.accountNumber,
      bankName: dto.bankName ?? payee.bankName,
      registrationNumber: dto.registrationNumber ?? payee.registrationNumber,
      notes: dto.notes ?? payee.notes,
      isActive: dto.isActive ?? payee.isActive,
    });
    const saved = await this.payeeRepo.save(payee);
    this.auditLogService.log('EXTERNAL_PAYEE_UPDATED', {
      actorId: admin.id,
      targetId: saved.id,
      targetName: saved.name,
      metadata: dto as unknown as Record<string, unknown>,
    });
    return saved;
  }
}
