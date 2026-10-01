import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntitySubscriberInterface,
  InsertEvent,
  RemoveEvent,
  SoftRemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { GatedJob, SchedulerGateService } from './scheduler-gate.service';
import { Tenant } from '../entity/tenant.entity';
import { ServiceProgramme } from '../../service-programme/entity/service-programme.entity';
import { ServiceSession } from '../../service-programme/entity/service-session.entity';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { EventConfig } from '../../event/entity/event-config.entity';
import { Event } from '../../event/entity/event.entity';
import { EventReminder } from '../../event/entity/event-reminder.entity';
import { RentalBooking } from '../../facility-rental/entity/rental-booking.entity';
import { ChurchClass } from '../../classes/entity/church-class.entity';
import { ClassSession } from '../../classes/entity/class-session.entity';
import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';

// Which gated jobs depend on each table. Any insert/update/delete, through any code path, wakes them for that church.
export const JOBS_BY_ENTITY = new Map<unknown, GatedJob[]>([
  [ServiceProgramme, ['programme-auto-start']],
  [ServiceSession, ['programme-auto-start']],
  [EventConfig, ['programme-auto-start']],
  [Event, ['programme-auto-start', 'absence-marking']],
  [ServiceSlot, ['programme-auto-start', 'absence-marking', 'event-reminders']],
  [EventReminder, ['event-reminders']],
  [RentalBooking, ['rental-status']],
  [ChurchClass, ['class-session-reminders']],
  [ClassSession, ['class-session-reminders']],
  // Reminder thresholds (and other church settings) live here.
  [ChurchSetting, ['class-session-reminders']],
]);

@Injectable()
export class SchedulerGateSubscriber implements EntitySubscriberInterface {
  constructor(
    @InjectDataSource() dataSource: DataSource,
    private readonly gate: SchedulerGateService,
  ) {
    dataSource.subscribers.push(this);
  }

  private changed(target: unknown): void {
    if (target === Tenant) {
      this.gate.invalidateTenants();
      return;
    }
    const jobs = JOBS_BY_ENTITY.get(target);
    if (jobs) void this.gate.wake(jobs);
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

  afterSoftRemove(event: SoftRemoveEvent<unknown>): void {
    this.changed(event.metadata.target);
  }
}
