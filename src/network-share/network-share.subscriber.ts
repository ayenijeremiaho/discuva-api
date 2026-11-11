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
import { NetworkShareService } from './network-share.service';

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
    if (target !== Event && target !== ServiceSlot) return;
    this.share
      .eventsChanged()
      .catch((err: Error) =>
        this.logger.warn(`Network events refresh not queued: ${err.message}`),
      );
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
