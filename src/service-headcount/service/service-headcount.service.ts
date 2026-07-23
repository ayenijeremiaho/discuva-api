import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { ServiceHeadcount } from '../entity/service-headcount.entity';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { CacheService } from '../../utility/service/cache.service';
import { CreateServiceHeadcountDto } from '../dto/create-service-headcount.dto';
import { ExportHeadcountEmailDto } from '../dto/export-headcount-email.dto';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { ExcelService } from '../../utility/service/excel.service';
import { EmailQueueService } from '../../utility/service/email-queue.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

const TRENDS_TTL = 1800;
const MAX_EXPORT_ROWS = 5000;

export interface HeadcountTotal {
  maleAdults: number;
  femaleAdults: number;
  teenagers: number;
  children: number;
  mobileChurch: number;
  customGroups: Record<string, number>;
  total: number;
}

export interface HeadcountTrendPoint {
  periodLabel: string;
  serviceSlotName: string;
  maleAdults: number;
  femaleAdults: number;
  teenagers: number;
  children: number;
  mobileChurch: number;
  customGroups: Record<string, number>;
  total: number;
}

export type HeadcountPeriod = 'weekly' | 'monthly' | 'quarterly';

export interface HeadcountTrendsResult {
  period: HeadcountPeriod;
  from: string | null;
  to: string | null;
  data: HeadcountTrendPoint[];
}

export interface ServiceSlotHeadcountSummary {
  serviceSlotId: string;
  serviceSlotName: string;
  startTime: Date;
  headcount: (HeadcountTotal & { id: string; notes: string | null }) | null;
}

export interface EventHeadcountSummary {
  eventId: string;
  eventName: string;
  slotCount: number;
  recordedCount: number;
  serviceSlots: ServiceSlotHeadcountSummary[];
  total: HeadcountTotal;
}

@Injectable()
export class ServiceHeadcountService {
  constructor(
    private readonly cacheService: CacheService,
    private readonly excelService: ExcelService,
    private readonly emailQueueService: EmailQueueService,
    private readonly auditLogService: AuditLogService,
    @InjectRepository(ServiceHeadcount)
    private readonly headcountRepo: Repository<ServiceHeadcount>,
    @InjectRepository(ServiceSlot)
    private readonly serviceSlotRepo: Repository<ServiceSlot>,
  ) {}

  private readonly logger = new Logger(ServiceHeadcountService.name);

  async create(
    dto: CreateServiceHeadcountDto,
    admin: Admin,
  ): Promise<ServiceHeadcount & { total: number }> {
    const serviceSlot = await this.serviceSlotRepo.findOne({
      where: { id: dto.serviceSlotId },
    });
    if (!serviceSlot) throw new NotFoundException('Service slot not found');

    // One headcount per slot — re-recording (e.g. a corrected count) edits
    // the existing row instead of creating a sibling, so summing across a
    // service's sub-services never double-counts.
    const existing = await this.headcountRepo.findOne({
      where: { serviceSlot: { id: dto.serviceSlotId } },
    });
    const record = existing ?? this.headcountRepo.create({ serviceSlot });

    record.maleAdults = dto.maleAdults ?? 0;
    record.femaleAdults = dto.femaleAdults ?? 0;
    record.teenagers = dto.teenagers ?? 0;
    record.children = dto.children ?? 0;
    record.mobileChurch = dto.mobileChurch ?? 0;
    record.customGroups = dto.customGroups ?? {};
    record.notes = dto.notes ?? null;
    record.recordedBy = admin;

    const saved = await this.headcountRepo.save(record);
    this.cacheService.flushNamespace('headcount:trends');
    const total = this.computeTotal(saved);
    this.logger.log(
      `Headcount recorded for slot ${dto.serviceSlotId} by admin ${admin.id} (total: ${total})`,
    );
    return Object.assign(saved, { total });
  }

  private buildFilteredQb(
    serviceSlotId?: string,
    from?: string,
    to?: string,
  ): SelectQueryBuilder<ServiceHeadcount> {
    const qb = this.headcountRepo
      .createQueryBuilder('h')
      .innerJoinAndSelect('h.serviceSlot', 'slot')
      .leftJoinAndSelect('slot.event', 'event')
      .leftJoinAndSelect('h.recordedBy', 'admin')
      .leftJoinAndSelect('admin.member', 'member')
      .orderBy('slot.startTime', 'DESC');

    if (serviceSlotId)
      qb.andWhere('slot.id = :serviceSlotId', { serviceSlotId });
    if (from) qb.andWhere('slot.startTime >= :from', { from: new Date(from) });
    if (to) qb.andWhere('slot.startTime <= :to', { to: new Date(to) });

    return qb;
  }

  async findAll(
    page = 1,
    limit = 20,
    serviceSlotId?: string,
    from?: string,
    to?: string,
  ): Promise<PaginationResponseDto<ServiceHeadcount & { total: number }>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');

    const [raw, total] = await this.buildFilteredQb(serviceSlotId, from, to)
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    const data = raw.map((r) =>
      Object.assign(r, { total: this.computeTotal(r) }),
    );

    return {
      data,
      page,
      limit,
      totalCount: total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async emailExport(dto: ExportHeadcountEmailDto, admin: Admin): Promise<void> {
    const recipient = dto.recipientEmail ?? admin.member?.email;
    if (!recipient) {
      throw new BadRequestException(
        'No recipient email available — provide recipientEmail explicitly.',
      );
    }

    const records = await this.buildFilteredQb(
      dto.serviceSlotId,
      dto.from,
      dto.to,
    )
      .take(MAX_EXPORT_ROWS)
      .getMany();

    const rows = records.map((r) => ({
      serviceSlotName: r.serviceSlot.name,
      date: r.serviceSlot.startTime.toISOString().slice(0, 10),
      maleAdults: r.maleAdults,
      femaleAdults: r.femaleAdults,
      teenagers: r.teenagers,
      children: r.children,
      mobileChurch: r.mobileChurch,
      total: this.computeTotal(r),
    }));

    const buffer = await this.excelService.buildWorkbook(
      'Service Headcount',
      [
        { header: 'Service', key: 'serviceSlotName', width: 28 },
        { header: 'Date', key: 'date', width: 14 },
        { header: 'Male Adults', key: 'maleAdults', width: 14 },
        { header: 'Female Adults', key: 'femaleAdults', width: 14 },
        { header: 'Teenagers', key: 'teenagers', width: 12 },
        { header: 'Children', key: 'children', width: 12 },
        { header: 'Mobile Church', key: 'mobileChurch', width: 14 },
        { header: 'Total', key: 'total', width: 12 },
      ],
      rows,
    );

    const filterSummary = [
      dto.from ? `from ${dto.from}` : null,
      dto.to ? `to ${dto.to}` : null,
    ]
      .filter(Boolean)
      .join(' ');

    await this.emailQueueService.queueEmailWithTemplateAndAttachments(
      recipient,
      'Your Service Headcount Report',
      'report-export',
      {
        reportTitle: 'Service Headcount',
        generatedAt: new Date().toLocaleString(),
        filterSummary: filterSummary || null,
      },
      [{ filename: 'service-headcount.xlsx', content: buffer }],
    );

    this.auditLogService.log('REPORT_EXPORTED', {
      actorId: admin.id,
      targetEmail: recipient,
      metadata: { report: 'service-headcount' },
    });
  }

  async findOne(id: string): Promise<ServiceHeadcount & { total: number }> {
    const record = await this.headcountRepo.findOne({
      where: { id },
      relations: [
        'serviceSlot',
        'serviceSlot.event',
        'recordedBy',
        'recordedBy.member',
      ],
    });
    if (!record) throw new NotFoundException('Headcount record not found');
    return Object.assign(record, { total: this.computeTotal(record) });
  }

  // The service-level view: every sub-service under the event alongside its
  // headcount (if recorded yet) plus the aggregate across all of them, so an
  // admin running a multi-service Sunday can see the whole event's total
  // without adding up each sub-service by hand.
  async getEventSummary(eventId: string): Promise<EventHeadcountSummary> {
    const slots = await this.serviceSlotRepo.find({
      where: { event: { id: eventId } },
      relations: ['event'],
      order: { startTime: 'ASC' },
    });
    if (slots.length === 0) {
      throw new NotFoundException('Event not found or has no service slots');
    }

    const records = await this.headcountRepo.find({
      where: { serviceSlot: { id: In(slots.map((s) => s.id)) } },
      relations: ['serviceSlot'],
    });
    const recordBySlotId = new Map(records.map((r) => [r.serviceSlot.id, r]));

    const total: HeadcountTotal = {
      maleAdults: 0,
      femaleAdults: 0,
      teenagers: 0,
      children: 0,
      mobileChurch: 0,
      customGroups: {},
      total: 0,
    };

    const serviceSlots: ServiceSlotHeadcountSummary[] = slots.map((slot) => {
      const record = recordBySlotId.get(slot.id);
      if (record) {
        total.maleAdults += record.maleAdults;
        total.femaleAdults += record.femaleAdults;
        total.teenagers += record.teenagers;
        total.children += record.children;
        total.mobileChurch += record.mobileChurch;
        for (const [group, count] of Object.entries(
          record.customGroups ?? {},
        )) {
          total.customGroups[group] = (total.customGroups[group] ?? 0) + count;
        }
        total.total += this.computeTotal(record);
      }
      return {
        serviceSlotId: slot.id,
        serviceSlotName: slot.name,
        startTime: slot.startTime,
        headcount: record
          ? {
              id: record.id,
              maleAdults: record.maleAdults,
              femaleAdults: record.femaleAdults,
              teenagers: record.teenagers,
              children: record.children,
              mobileChurch: record.mobileChurch,
              customGroups: record.customGroups,
              notes: record.notes,
              total: this.computeTotal(record),
            }
          : null,
      };
    });

    return {
      eventId,
      eventName: slots[0].event.name,
      slotCount: slots.length,
      recordedCount: records.length,
      serviceSlots,
      total,
    };
  }

  async getTrends(
    period: HeadcountPeriod = 'weekly',
    from?: string,
    to?: string,
    serviceSlotName?: string,
  ): Promise<HeadcountTrendsResult> {
    // Unbounded (no from/to) previously scanned every headcount record ever
    // logged for in-memory bucketing — default to a bounded lookback window
    // instead, matching the pattern used elsewhere (e.g. service-session
    // analytics) rather than the full history.
    const effectiveFrom = from ?? this.defaultTrendsFrom();
    const key = `headcount:trends:${period}:${effectiveFrom}:${to ?? 'all'}:${serviceSlotName ?? 'all'}`;
    return this.cacheService.getOrSet(
      key,
      () => this.fetchTrends(period, effectiveFrom, to, serviceSlotName),
      TRENDS_TTL,
    );
  }

  private defaultTrendsFrom(): string {
    const d = new Date();
    d.setDate(d.getDate() - 365);
    return d.toISOString().slice(0, 10);
  }

  private async fetchTrends(
    period: HeadcountPeriod,
    from: string,
    to?: string,
    serviceSlotName?: string,
  ): Promise<HeadcountTrendsResult> {
    const qb = this.headcountRepo
      .createQueryBuilder('h')
      .innerJoinAndSelect('h.serviceSlot', 'slot')
      .orderBy('slot.startTime', 'ASC');

    qb.andWhere('slot.startTime >= :from', { from: new Date(from) });
    if (to) qb.andWhere('slot.startTime <= :to', { to: new Date(to) });
    if (serviceSlotName)
      qb.andWhere('slot.name ILIKE :name', { name: `%${serviceSlotName}%` });

    const records = await qb.getMany();

    const bucketMap = new Map<string, HeadcountTrendPoint>();

    for (const r of records) {
      const label = this.periodLabel(r.serviceSlot.startTime, period);
      const key = `${label}::${r.serviceSlot.name}`;

      let point = bucketMap.get(key);
      if (!point) {
        point = {
          periodLabel: label,
          serviceSlotName: r.serviceSlot.name,
          maleAdults: 0,
          femaleAdults: 0,
          teenagers: 0,
          children: 0,
          mobileChurch: 0,
          customGroups: {},
          total: 0,
        };
        bucketMap.set(key, point);
      }

      point.maleAdults += r.maleAdults;
      point.femaleAdults += r.femaleAdults;
      point.teenagers += r.teenagers;
      point.children += r.children;
      point.mobileChurch += r.mobileChurch;

      for (const [group, count] of Object.entries(r.customGroups ?? {})) {
        point.customGroups[group] = (point.customGroups[group] ?? 0) + count;
      }

      point.total += this.computeTotal(r);
    }

    return {
      period,
      from,
      to: to ?? null,
      data: Array.from(bucketMap.values()),
    };
  }

  private computeTotal(r: ServiceHeadcount): number {
    const fixedTotal =
      r.maleAdults + r.femaleAdults + r.teenagers + r.children + r.mobileChurch;
    const customTotal = Object.values(r.customGroups ?? {}).reduce(
      (sum, n) => sum + n,
      0,
    );
    return fixedTotal + customTotal;
  }

  private periodLabel(date: Date, period: HeadcountPeriod): string {
    const d = new Date(date);
    if (period === 'weekly') {
      const day = d.getDay();
      const sunday = new Date(d);
      sunday.setDate(d.getDate() - day);
      return sunday.toISOString().slice(0, 10);
    }
    if (period === 'monthly') {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    const quarter = Math.floor(d.getMonth() / 3) + 1;
    return `${d.getFullYear()}-Q${quarter}`;
  }
}
