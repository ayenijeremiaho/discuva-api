import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BlockedCheckin,
  BlockedCheckinReasonEnum,
} from '../entity/blocked-checkin.entity';
import { Attendance } from '../entity/attendance.entity';
import { GENUINELY_ATTENDED_STATUSES } from '../util/attended-statuses';
import { UtilityService } from '../../utility/service/utility.service';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';

export interface BlockedCheckinAttempt {
  memberId: string;
  eventId: string;
  serviceSlotId: string;
  distanceMeters: number;
  accuracyMeters: number | null;
  allowedDistanceMeters: number;
  reason: BlockedCheckinReasonEnum;
  at: Date;
}

export interface BlockedCheckinView {
  id: string;
  member: {
    id: string;
    firstname: string;
    lastname: string;
    photoUrl: string | null;
  };
  event: { id: string; name: string; eventDate: Date };
  serviceSlot: { id: string; name: string } | null;
  attempts: number;
  closestDistanceMeters: number;
  accuracyMeters: number | null;
  allowedDistanceMeters: number;
  reason: BlockedCheckinReasonEnum;
  lastAttemptAt: Date;
  checkedInLater: boolean;
  // Smallest radius that would have let the closest attempt through; null when the phone's location was too vague to judge.
  wouldPassAtMeters: number | null;
}

// Inverse of AttendanceService.validateLocation(): passes iff d - min(acc, r) <= r.
export function radiusNeededToPass(
  distance: number,
  accuracy: number | null,
): number {
  return Math.ceil(Math.max(distance / 2, distance - (accuracy ?? 0)));
}

@Injectable()
export class BlockedCheckinService {
  constructor(
    @InjectRepository(BlockedCheckin)
    private readonly blockedRepo: Repository<BlockedCheckin>,
    @InjectRepository(Attendance)
    private readonly attendanceRepo: Repository<Attendance>,
  ) {}

  // Called via afterRollback (the rejected request's own transaction rolls back); errors are logged there.
  async record(attempt: BlockedCheckinAttempt): Promise<void> {
    await this.blockedRepo.query(
      `INSERT INTO blocked_checkins
         (member_id, event_id, service_slot_id, closest_distance_meters, accuracy_meters,
          allowed_distance_meters, reason, last_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (member_id, event_id) DO UPDATE SET
         attempts = blocked_checkins.attempts + 1,
         service_slot_id = EXCLUDED.service_slot_id,
         accuracy_meters = CASE
           WHEN EXCLUDED.closest_distance_meters < blocked_checkins.closest_distance_meters
           THEN EXCLUDED.accuracy_meters ELSE blocked_checkins.accuracy_meters END,
         closest_distance_meters = LEAST(blocked_checkins.closest_distance_meters, EXCLUDED.closest_distance_meters),
         allowed_distance_meters = EXCLUDED.allowed_distance_meters,
         reason = EXCLUDED.reason,
         last_attempt_at = EXCLUDED.last_attempt_at,
         updated_at = now()`,
      [
        attempt.memberId,
        attempt.eventId,
        attempt.serviceSlotId,
        Math.round(attempt.distanceMeters),
        attempt.accuracyMeters === null
          ? null
          : Math.round(attempt.accuracyMeters),
        attempt.allowedDistanceMeters,
        attempt.reason,
        attempt.at,
      ],
    );
  }

  async list(
    page = 1,
    limit = 20,
    eventId?: string,
  ): Promise<PaginationResponseDto<BlockedCheckinView>> {
    const qb = this.blockedRepo
      .createQueryBuilder('b')
      .leftJoin('b.member', 'm')
      .addSelect(['m.id', 'm.firstname', 'm.lastname', 'm.photoUrl'])
      .leftJoin('b.event', 'e')
      .addSelect(['e.id', 'e.name', 'e.eventDate'])
      .leftJoin('b.serviceSlot', 's')
      .addSelect(['s.id', 's.name'])
      .orderBy('b.lastAttemptAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);
    if (eventId) qb.where('b.event_id = :eventId', { eventId });

    const [rows, total] = await qb.getManyAndCount();
    const attended = await this.attendedPairs(rows);

    const data = rows.map((r) => ({
      id: r.id,
      member: {
        id: r.member.id,
        firstname: r.member.firstname,
        lastname: r.member.lastname,
        photoUrl: r.member.photoUrl,
      },
      event: {
        id: r.event.id,
        name: r.event.name,
        eventDate: r.event.eventDate,
      },
      serviceSlot: r.serviceSlot
        ? { id: r.serviceSlot.id, name: r.serviceSlot.name }
        : null,
      attempts: r.attempts,
      closestDistanceMeters: r.closestDistanceMeters,
      accuracyMeters: r.accuracyMeters,
      allowedDistanceMeters: r.allowedDistanceMeters,
      reason: r.reason,
      lastAttemptAt: r.lastAttemptAt,
      checkedInLater: attended.has(`${r.member.id}:${r.event.id}`),
      wouldPassAtMeters:
        r.reason === BlockedCheckinReasonEnum.TOO_FAR
          ? radiusNeededToPass(r.closestDistanceMeters, r.accuracyMeters)
          : null,
    }));
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  private async attendedPairs(rows: BlockedCheckin[]): Promise<Set<string>> {
    if (!rows.length) return new Set();
    const found: { member_id: string; event_id: string }[] =
      await this.attendanceRepo
        .createQueryBuilder('a')
        .select('a.member_id', 'member_id')
        .addSelect('a.event_id', 'event_id')
        .where('a.member_id IN (:...memberIds)', {
          memberIds: [...new Set(rows.map((r) => r.member.id))],
        })
        .andWhere('a.event_id IN (:...eventIds)', {
          eventIds: [...new Set(rows.map((r) => r.event.id))],
        })
        .andWhere('a.status IN (:...statuses)', {
          statuses: [...GENUINELY_ATTENDED_STATUSES],
        })
        .getRawMany();
    return new Set(found.map((f) => `${f.member_id}:${f.event_id}`));
  }
}
