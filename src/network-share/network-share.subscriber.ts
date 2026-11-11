import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntitySubscriberInterface,
  InsertEvent,
  RemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { Event } from '../event/entity/event.entity';
import { ServiceSlot } from '../event/entity/service-slot.entity';
import { Attendance } from '../attendance/entity/attendance.entity';
import { Member } from '../member/entity/member.entity';
import { FirstTimer } from '../follow-up/entity/first-timer.entity';
import { FirstTimerVisit } from '../follow-up/entity/first-timer-visit.entity';
import { FollowUpTask } from '../follow-up/entity/follow-up-task.entity';
import { FollowUpNote } from '../follow-up/entity/follow-up-note.entity';
import { ServiceRating } from '../service-rating/entity/service-rating.entity';
import { ClassEnrollment } from '../classes/entity/class-enrollment.entity';
import { ServiceHeadcount } from '../service-headcount/entity/service-headcount.entity';
import { Admin } from '../admin/entity/admin.entity';
import { NetworkVisitor } from '../branch/entity/network-visitor.entity';
import { NetworkShareService } from './network-share.service';

// Everything the network report counts: a write to any of these marks the branch for recalculation.
const REPORT_ENTITIES = new Set<unknown>([
  Attendance,
  Member,
  FirstTimer,
  FirstTimerVisit,
  FollowUpTask,
  FollowUpNote,
  ServiceRating,
  ClassEnrollment,
  ServiceHeadcount,
  Admin,
  NetworkVisitor,
  ServiceSlot,
]);

// Any write to events or their services, through any code path, refreshes the network's copy for that church.
@Injectable()
export class NetworkShareSubscriber implements EntitySubscriberInterface {
  private readonly logger = new Logger(NetworkShareSubscriber.name);

  constructor(
    @InjectDataSource() dataSource: DataSource,
    private readonly share: NetworkShareService,
  ) {
    dataSource.subscribers.push(this);
  }

  private changed(target: unknown): void {
    if (target === Event || target === ServiceSlot) {
      this.share
        .eventsChanged()
        .catch((err: Error) =>
          this.logger.warn(`Network events refresh not queued: ${err.message}`),
        );
    }
    if (REPORT_ENTITIES.has(target)) {
      this.share
        .rollupChanged()
        .catch((err: Error) =>
          this.logger.warn(`Network report refresh not queued: ${err.message}`),
        );
    }
  }

  afterInsert(event: InsertEvent<unknown>): void {
    this.changed(event.metadata.target);
  }

  afterUpdate(event: UpdateEvent<unknown>): void {
    this.changed(event.metadata.target);
  }

  afterRemove(event: RemoveEvent<unknown>): void {
    this.changed(event.metadata.target);
  }
}
