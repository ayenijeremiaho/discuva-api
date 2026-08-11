import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Asset } from '../entity/asset.entity';
import { MaintenanceSchedule } from '../entity/maintenance-schedule.entity';
import { MaintenanceRecord } from '../entity/maintenance-record.entity';
import {
  AssetQueryDto,
  CreateAssetDto,
  LogMaintenanceRecordDto,
  SetMaintenanceScheduleDto,
  UpdateAssetDto,
  UpdateInventoryDto,
} from '../dto/asset.dto';
import { AssetStatus, MaintenanceCompletionStatus } from '../enum/asset.enum';
import { Admin } from '../../admin/entity/admin.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';

@Injectable()
export class AssetService {
  constructor(
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    @InjectRepository(MaintenanceSchedule)
    private readonly scheduleRepo: Repository<MaintenanceSchedule>,
    @InjectRepository(MaintenanceRecord)
    private readonly recordRepo: Repository<MaintenanceRecord>,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(dto: CreateAssetDto, admin: Admin): Promise<Asset> {
    const tagNumber = dto.tagNumber?.trim() || (await this.generateTagNumber());

    const existing = await this.assetRepo.findOne({ where: { tagNumber } });
    if (existing)
      throw new ConflictException(
        `Tag number '${tagNumber}' is already in use.`,
      );

    const asset = this.assetRepo.create({
      tagNumber,
      name: dto.name,
      description: dto.description ?? null,
      category: dto.category,
      location: dto.location ?? null,
      serialNumber: dto.serialNumber ?? null,
      manufacturer: dto.manufacturer ?? null,
      model: dto.model ?? null,
      purchaseDate: dto.purchaseDate ?? null,
      purchaseValue: dto.purchaseValue ?? null,
      warrantyExpiry: dto.warrantyExpiry ?? null,
      vendorName: dto.vendorName ?? null,
      vendorContact: dto.vendorContact ?? null,
      department: dto.departmentId ? ({ id: dto.departmentId } as any) : null,
    });

    try {
      const saved = await this.assetRepo.save(asset);
      this.auditLogService.log('ASSET_CREATED', {
        actorId: admin.member?.id,
        targetId: saved.id,
        metadata: {
          tagNumber: saved.tagNumber,
          name: saved.name,
          category: saved.category,
        },
      });
      return saved;
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new ConflictException(
          `Tag number '${tagNumber}' is already in use.`,
        );
      }
      throw err;
    }
  }

  async findAll(query: AssetQueryDto): Promise<PaginationResponseDto<Asset>> {
    const {
      page = 1,
      limit = 20,
      status,
      category,
      maintenanceEnabled,
      departmentId,
    } = query;
    const qb = this.assetRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.maintenanceSchedule', 'schedule')
      .leftJoinAndSelect('a.department', 'dept')
      .orderBy('a.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) qb.andWhere('a.status = :status', { status });
    if (category)
      qb.andWhere('LOWER(a.category) = LOWER(:category)', { category });
    if (maintenanceEnabled !== undefined)
      qb.andWhere('a.maintenanceEnabled = :maintenanceEnabled', {
        maintenanceEnabled,
      });
    if (departmentId) qb.andWhere('dept.id = :departmentId', { departmentId });

    const [assets, total] = await qb.getManyAndCount();
    return UtilityService.createPaginationResponse(assets, page, limit, total);
  }

  async findOne(id: string): Promise<Asset> {
    const asset = await this.assetRepo.findOne({
      where: { id },
      relations: ['maintenanceSchedule', 'department'],
    });
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }

  async update(id: string, dto: UpdateAssetDto, admin: Admin): Promise<Asset> {
    const asset = await this.findOne(id);
    Object.assign(asset, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.category !== undefined && { category: dto.category }),
      ...(dto.location !== undefined && { location: dto.location }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.serialNumber !== undefined && { serialNumber: dto.serialNumber }),
      ...(dto.manufacturer !== undefined && { manufacturer: dto.manufacturer }),
      ...(dto.model !== undefined && { model: dto.model }),
      ...(dto.purchaseDate !== undefined && { purchaseDate: dto.purchaseDate }),
      ...(dto.purchaseValue !== undefined && {
        purchaseValue: dto.purchaseValue,
      }),
      ...(dto.warrantyExpiry !== undefined && {
        warrantyExpiry: dto.warrantyExpiry,
      }),
      ...(dto.vendorName !== undefined && { vendorName: dto.vendorName }),
      ...(dto.vendorContact !== undefined && {
        vendorContact: dto.vendorContact,
      }),
      ...(dto.departmentId !== undefined && {
        department: dto.departmentId ? ({ id: dto.departmentId } as any) : null,
      }),
    });
    const saved = await this.assetRepo.save(asset);
    this.auditLogService.log('ASSET_UPDATED', {
      actorId: admin.member?.id,
      targetId: id,
      metadata: {
        changes: Object.keys(dto).filter((k) => (dto as any)[k] !== undefined),
      },
    });
    return saved;
  }

  async setMaintenanceSchedule(
    id: string,
    dto: SetMaintenanceScheduleDto,
    admin: Admin,
  ): Promise<Asset> {
    const asset = await this.findOne(id);

    let schedule = asset.maintenanceSchedule;
    if (!schedule) {
      schedule = this.scheduleRepo.create({ asset: { id } as any });
    }

    schedule.frequencyUnit = dto.frequencyUnit;
    schedule.frequencyValue = dto.frequencyValue;
    schedule.nextDueAt = dto.nextDueAt;
    schedule.notifiedThresholds = [];
    schedule.lastOverdueNotifiedAt = null;

    await this.scheduleRepo.save(schedule);

    asset.maintenanceEnabled = true;
    await this.assetRepo.save(asset);

    this.auditLogService.log('ASSET_MAINTENANCE_SCHEDULED', {
      actorId: admin.member?.id,
      targetId: id,
      metadata: {
        frequencyUnit: dto.frequencyUnit,
        frequencyValue: dto.frequencyValue,
        nextDueAt: dto.nextDueAt,
      },
    });

    return this.findOne(id);
  }

  async logMaintenanceRecord(
    id: string,
    dto: LogMaintenanceRecordDto,
    admin: Admin,
  ): Promise<MaintenanceRecord> {
    const asset = await this.findOne(id);

    const record = this.recordRepo.create({
      asset: { id } as any,
      type: dto.type,
      performedAt: dto.performedAt,
      performedBy: dto.performedBy,
      cost: dto.cost ?? null,
      notes: dto.notes,
      attachments: dto.attachments ?? null,
      conditionAfter: dto.conditionAfter,
      completionStatus: dto.completionStatus,
      loggedBy: { id: admin.id } as any,
    });
    const saved = await this.recordRepo.save(record);

    if (dto.completionStatus === MaintenanceCompletionStatus.COMPLETED) {
      asset.status = AssetStatus.ACTIVE;
      await this.assetRepo.save(asset);

      if (asset.maintenanceSchedule) {
        await this.resetScheduleAfterCompletion(
          asset.maintenanceSchedule,
          dto.performedAt,
        );
      }
    } else {
      asset.status = AssetStatus.UNDER_MAINTENANCE;
      await this.assetRepo.save(asset);
    }

    this.auditLogService.log('ASSET_MAINTENANCE_LOGGED', {
      actorId: admin.member?.id,
      targetId: id,
      metadata: {
        recordId: saved.id,
        type: dto.type,
        completionStatus: dto.completionStatus,
      },
    });

    return saved;
  }

  async updateInventory(
    id: string,
    dto: UpdateInventoryDto,
    admin: Admin,
  ): Promise<Asset> {
    const asset = await this.findOne(id);
    asset.inventoryEnabled = true;
    asset.inStorage = dto.inStorage;
    asset.inUse = dto.inUse;
    asset.underRepair = dto.underRepair;
    asset.writtenOff = dto.writtenOff;
    const saved = await this.assetRepo.save(asset);

    this.auditLogService.log('ASSET_INVENTORY_UPDATED', {
      actorId: admin.member?.id,
      targetId: id,
      metadata: {
        inStorage: dto.inStorage,
        inUse: dto.inUse,
        underRepair: dto.underRepair,
        writtenOff: dto.writtenOff,
        total: dto.inStorage + dto.inUse + dto.underRepair + dto.writtenOff,
      },
    });

    return saved;
  }

  async getMaintenanceHistory(
    id: string,
    page: number,
    limit: number,
  ): Promise<PaginationResponseDto<MaintenanceRecord>> {
    await this.assertExists(id);
    const [records, total] = await this.recordRepo.findAndCount({
      where: { asset: { id } },
      relations: ['loggedBy', 'loggedBy.member'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(records, page, limit, total);
  }

  private async resetScheduleAfterCompletion(
    schedule: MaintenanceSchedule,
    performedAt: string,
  ): Promise<void> {
    const performed = new Date(performedAt);
    const next = new Date(performed);

    switch (schedule.frequencyUnit) {
      case 'DAYS':
        next.setDate(next.getDate() + schedule.frequencyValue);
        break;
      case 'WEEKS':
        next.setDate(next.getDate() + schedule.frequencyValue * 7);
        break;
      case 'MONTHS':
        next.setMonth(next.getMonth() + schedule.frequencyValue);
        break;
    }

    schedule.lastMaintainedAt = performedAt;
    schedule.nextDueAt = next.toISOString().split('T')[0];
    schedule.notifiedThresholds = [];
    schedule.lastOverdueNotifiedAt = null;
    await this.scheduleRepo.save(schedule);
  }

  private async generateTagNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.assetRepo.count();
    return `AST-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  private async assertExists(id: string): Promise<void> {
    const exists = await this.assetRepo.findOne({ where: { id } });
    if (!exists) throw new NotFoundException('Asset not found');
  }
}
