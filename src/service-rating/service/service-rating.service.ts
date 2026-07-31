import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceRating } from '../entity/service-rating.entity';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { SubmitServiceRatingDto } from '../dto/service-rating.dto';
import { Admin } from '../../admin/entity/admin.entity';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { Member } from '../../member/entity/member.entity';
import { Event } from '../../event/entity/event.entity';

export interface ServiceRatingSummary {
  averageRating: number;
  totalRatings: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

export interface ServiceRatingComment {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  serviceSlotName: string;
  eventName: string;
  member: { id: string; firstname: string; lastname: string } | null;
}

@Injectable()
export class ServiceRatingService {
  constructor(
    @InjectRepository(ServiceRating)
    private readonly ratingRepo: Repository<ServiceRating>,
    @InjectRepository(ServiceSlot)
    private readonly serviceSlotRepo: Repository<ServiceSlot>,
    private readonly auditLogService: AuditLogService,
  ) {}

  async submitRating(
    dto: SubmitServiceRatingDto,
    memberId: string,
  ): Promise<ServiceRating> {
    const slot = await this.serviceSlotRepo.findOne({
      where: { id: dto.serviceSlotId, event: { id: dto.eventId } },
    });
    if (!slot) throw new NotFoundException('Service slot not found');

    const existing = await this.ratingRepo.findOne({
      where: {
        event: { id: dto.eventId },
        serviceSlot: { id: dto.serviceSlotId },
        member: { id: memberId },
      },
    });

    if (existing) {
      existing.rating = dto.rating;
      existing.comment = dto.comment ?? null;
      return this.ratingRepo.save(existing);
    }

    const rating = this.ratingRepo.create({
      event: { id: dto.eventId } as Event,
      serviceSlot: { id: dto.serviceSlotId } as ServiceSlot,
      member: { id: memberId } as Member,
      rating: dto.rating,
      comment: dto.comment ?? null,
    });
    return this.ratingRepo.save(rating);
  }

  async getMyRating(
    eventId: string,
    serviceSlotId: string,
    memberId: string,
  ): Promise<ServiceRating | null> {
    return this.ratingRepo.findOne({
      where: {
        event: { id: eventId },
        serviceSlot: { id: serviceSlotId },
        member: { id: memberId },
      },
    });
  }

  async getSummary(
    eventId?: string,
    from?: string,
    to?: string,
  ): Promise<ServiceRatingSummary> {
    const qb = this.ratingRepo
      .createQueryBuilder('r')
      .innerJoin('r.serviceSlot', 'slot')
      .select('r.rating', 'rating')
      .addSelect('COUNT(*)', 'count');

    if (eventId) qb.andWhere('r.event = :eventId', { eventId });
    if (from) qb.andWhere('slot.startTime >= :from', { from: new Date(from) });
    if (to) qb.andWhere('slot.startTime <= :to', { to: new Date(to) });

    const rows = await qb.groupBy('r.rating').getRawMany<{
      rating: number;
      count: string;
    }>();

    const distribution: ServiceRatingSummary['distribution'] = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };
    let totalRatings = 0;
    let sum = 0;
    for (const row of rows) {
      const count = Number(row.count);
      distribution[row.rating as 1 | 2 | 3 | 4 | 5] = count;
      totalRatings += count;
      sum += row.rating * count;
    }

    return {
      averageRating: totalRatings ? sum / totalRatings : 0,
      totalRatings,
      distribution,
    };
  }

  async getComments(
    admin: Admin,
    page = 1,
    limit = 20,
  ): Promise<{
    data: ServiceRatingComment[];
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  }> {
    const canModerate = admin.adminRole.permissions.includes(
      AdminPermission.SERVICE_RATING_MODERATE,
    );

    const [rows, total] = await this.ratingRepo
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.serviceSlot', 'slot')
      .innerJoinAndSelect('r.event', 'event')
      .innerJoinAndSelect('r.member', 'member')
      .where('r.comment IS NOT NULL')
      .orderBy('r.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const data: ServiceRatingComment[] = rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      serviceSlotName: r.serviceSlot.name,
      eventName: r.event.name,
      member: canModerate
        ? {
            id: r.member.id,
            firstname: r.member.firstname,
            lastname: r.member.lastname,
          }
        : null,
    }));

    return {
      data,
      page,
      limit,
      totalCount: total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async moderateDelete(id: string, admin: Admin): Promise<void> {
    const rating = await this.ratingRepo.findOne({ where: { id } });
    if (!rating) throw new NotFoundException('Rating not found');

    await this.ratingRepo.remove(rating);
    this.auditLogService.log('SERVICE_RATING_MODERATED', {
      actorId: admin.id,
      targetId: id,
    });
  }
}
