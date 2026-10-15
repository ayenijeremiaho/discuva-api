import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attendance } from '../entity/attendance.entity';
import {
  intrinsicLocationFlags,
  LocationFlagEnum,
} from '../util/location-flags';

// Rough Wi-Fi/cell fixes legitimately repeat the same point, so only fixes claiming to be precise are compared.
const PRECISE_FIX_METERS = 100;

const SAME_SPOT = `(a.location->>'latitude')::float8 = :lat AND (a.location->>'longitude')::float8 = :lng AND (a.location->>'accuracy')::float8 <= ${PRECISE_FIX_METERS}`;

const ADD_SHARED_SPOT = `CASE WHEN '${LocationFlagEnum.SHARED_SPOT}' = ANY(location_flags) THEN location_flags ELSE array_append(location_flags, '${LocationFlagEnum.SHARED_SPOT}') END`;

export interface LocationVerification {
  locationFlags: LocationFlagEnum[];
  // False when the fix was too rough to compare (rough fixes repeat legitimately).
  compared: boolean;
  repeatedAt: { eventId: string; eventName: string; eventDate: string }[];
  sharedWith: { memberId: string; firstname: string; lastname: string }[];
}

@Injectable()
export class LocationFlagService {
  constructor(
    @InjectRepository(Attendance)
    private readonly attendanceRepository: Repository<Attendance>,
  ) {}

  // On request only: compares one check-in's spot with the member's history and the rest of that event,
  // via IDX_attendances_member_id and IDX_attendances_event_latitude. Saves any new flags on both sides.
  async verify(attendanceId: string): Promise<LocationVerification> {
    const record = await this.attendanceRepository.findOne({
      where: { id: attendanceId },
      relations: ['member', 'event'],
    });
    if (!record) throw new NotFoundException('Attendance record not found');
    if (!record.location) {
      throw new BadRequestException('This check-in has no location to verify.');
    }

    const location = record.location;
    const flags = new Set<LocationFlagEnum>([
      ...(record.locationFlags ?? []),
      ...intrinsicLocationFlags(location),
    ]);
    const compared =
      typeof location.accuracy === 'number' &&
      location.accuracy <= PRECISE_FIX_METERS;
    let repeatedAt: LocationVerification['repeatedAt'] = [];
    let sharedWith: (LocationVerification['sharedWith'][number] & {
      id: string;
    })[] = [];

    if (compared) {
      const spot = { lat: location.latitude, lng: location.longitude };
      repeatedAt = await this.attendanceRepository
        .createQueryBuilder('a')
        .innerJoin('a.event', 'e')
        .select('e.id', 'eventId')
        .addSelect('e.name', 'eventName')
        .addSelect('e.eventDate', 'eventDate')
        .where('a.member_id = :memberId', { memberId: record.member.id })
        .andWhere('a.event_id <> :eventId', { eventId: record.event.id })
        .andWhere(SAME_SPOT, spot)
        .orderBy('e.eventDate', 'DESC')
        .limit(5)
        .getRawMany();
      sharedWith = await this.attendanceRepository
        .createQueryBuilder('a')
        .innerJoin('a.member', 'm')
        .select('a.id', 'id')
        .addSelect('m.id', 'memberId')
        .addSelect('m.firstname', 'firstname')
        .addSelect('m.lastname', 'lastname')
        .where('a.event_id = :eventId', { eventId: record.event.id })
        .andWhere('a.member_id <> :memberId', { memberId: record.member.id })
        .andWhere(SAME_SPOT, spot)
        .getRawMany();

      if (repeatedAt.length) flags.add(LocationFlagEnum.REPEATED_SPOT);
      if (sharedWith.length) {
        flags.add(LocationFlagEnum.SHARED_SPOT);
        await this.attendanceRepository
          .createQueryBuilder()
          .update(Attendance)
          .set({ locationFlags: () => ADD_SHARED_SPOT })
          .whereInIds(sharedWith.map((s) => s.id))
          .execute();
      }
    }

    const locationFlags = [...flags];
    await this.attendanceRepository.update(record.id, { locationFlags });
    return {
      locationFlags,
      compared,
      repeatedAt,
      sharedWith: sharedWith.map(({ memberId, firstname, lastname }) => ({
        memberId,
        firstname,
        lastname,
      })),
    };
  }
}
