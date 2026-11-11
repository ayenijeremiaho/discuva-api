import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In,
  IsNull,
  LessThan,
  MoreThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { Announcement } from '../../announcement/entity/announcement.entity';
import { EventAudienceEnum } from '../../event/enums/event-audience.enum';
import { NetworkEvent } from '../entity/network-event.entity';
import { NetworkEventHide } from '../entity/network-event-hide.entity';
import { NetworkService } from './network.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WINDOW_DAYS = 62;

export interface SharedEvent {
  tenantId: string;
  eventId: string;
  name: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  venueName: string | null;
  serviceCount: number;
  fromPath: string;
  hidden?: boolean;
}

export interface AgendaView {
  churches: { id: string; path: string }[];
  events: (SharedEvent & { audience: string; shared: boolean })[];
  announcements: {
    id: string;
    title: string;
    publishedAt: Date | null;
    fromPath: string | null;
  }[];
}

// Events shared down the network, and the agenda of everything under a church. Root tables only, plus this church's own announcements.
@Injectable()
export class NetworkEventsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(NetworkEvent)
    private readonly eventRepo: Repository<NetworkEvent>,
    @InjectRepository(NetworkEventHide)
    private readonly hideRepo: Repository<NetworkEventHide>,
    @InjectRepository(Announcement)
    private readonly announcementRepo: Repository<Announcement>,
    private readonly network: NetworkService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  // Member app: events the churches above this one shared, that this branch hasn't hidden.
  async forMember(
    isWorker: boolean,
    from: Date,
    to: Date,
  ): Promise<SharedEvent[]> {
    if (!(await this.network.isAvailable())) return [];
    const inNetwork = await this.tenantRepo.exists({
      where: { id: this.cls.get('tenantId'), networkRootId: Not(IsNull()) },
    });
    if (!inNetwork) return [];
    const audiences = [
      EventAudienceEnum.EVERYONE,
      ...(isWorker ? [EventAudienceEnum.WORKERS] : []),
    ];
    const events = await this.sharedFromAbove(from, to, audiences);
    return events.filter((e) => !e.hidden).map(({ hidden: _h, ...e }) => e);
  }

  // Branch admin: what the network shares here, hidden ones included.
  sharedHere(): Promise<SharedEvent[]> {
    const now = Date.now();
    return this.sharedFromAbove(
      new Date(now - DAY_MS),
      new Date(now + 60 * DAY_MS),
      [EventAudienceEnum.EVERYONE, EventAudienceEnum.WORKERS],
    );
  }

  async setHidden(
    sourceTenantId: string,
    eventId: string,
    hidden: boolean,
  ): Promise<void> {
    const here = await this.here();
    const tree = await this.network.loadTree(here.networkRootId!);
    const shared = await this.eventRepo.exists({
      where: { tenantId: sourceTenantId, eventId, shared: true },
    });
    if (
      !shared ||
      !this.network.ancestorIds(tree, here.id).includes(sourceTenantId)
    ) {
      throw new NotFoundException('That event is not shared with this church.');
    }
    const row = { tenantId: here.id, sourceTenantId, eventId };
    if (hidden)
      await this.hideRepo.upsert(row, [
        'tenantId',
        'sourceTenantId',
        'eventId',
      ]);
    else await this.hideRepo.delete(row);
  }

  // Everything under the current church (or one church under it), plus what it sent or received across the network.
  async agenda(from: Date, to: Date, churchId?: string): Promise<AgendaView> {
    this.assertWindow(from, to);
    const here = await this.here();
    const tree = await this.network.loadTree(here.networkRootId!);
    const under = this.network
      .subtreeIds(tree, here.id)
      .filter((id) => tree.byId.get(id)?.isActive);
    if (churchId && !under.includes(churchId)) {
      throw new NotFoundException('That church is not under yours.');
    }
    const ids = churchId ? [churchId] : under;
    const [events, announcements, paths] = await Promise.all([
      this.eventRepo.find({
        where: {
          networkRootId: here.networkRootId!,
          tenantId: In(ids),
          startTime: LessThan(to),
          endTime: MoreThanOrEqual(from),
        },
        order: { startTime: 'ASC' },
        take: 2000,
      }),
      this.announcementRepo.find({
        where: [
          { sendToBranches: true, publishedAt: MoreThanOrEqual(from) },
          {
            networkSourceId: Not(IsNull()),
            publishedAt: MoreThanOrEqual(from),
          },
        ],
        select: { id: true, title: true, publishedAt: true, networkFrom: true },
        order: { publishedAt: 'ASC' },
        take: 200,
      }),
      this.network.pathsOf(here.networkRootId!, under),
    ]);
    return {
      churches: under.map((id) => ({ id, path: paths.get(id) ?? '' })),
      events: events.map((e) => ({
        tenantId: e.tenantId,
        eventId: e.eventId,
        name: e.name,
        description: e.description,
        startTime: e.startTime,
        endTime: e.endTime,
        venueName: e.venueName,
        serviceCount: e.serviceCount,
        audience: e.audience,
        shared: e.shared,
        fromPath: paths.get(e.tenantId) ?? '',
      })),
      announcements: announcements
        .filter((a) => a.publishedAt && a.publishedAt < to)
        .map((a) => ({
          id: a.id,
          title: a.title,
          publishedAt: a.publishedAt,
          fromPath: a.networkFrom,
        })),
    };
  }

  private async sharedFromAbove(
    from: Date,
    to: Date,
    audiences: string[],
  ): Promise<SharedEvent[]> {
    this.assertWindow(from, to);
    const here = await this.here();
    const tree = await this.network.loadTree(here.networkRootId!);
    const above = this.network.ancestorIds(tree, here.id);
    if (!above.length) return [];
    const [events, hides, paths] = await Promise.all([
      this.eventRepo.find({
        where: {
          networkRootId: here.networkRootId!,
          tenantId: In(above),
          shared: true,
          audience: In(audiences),
          startTime: LessThan(to),
          endTime: MoreThanOrEqual(from),
        },
        order: { startTime: 'ASC' },
        take: 200,
      }),
      this.hideRepo.find({ where: { tenantId: here.id } }),
      this.network.pathsOf(here.networkRootId!, above),
    ]);
    const hidden = new Set(
      hides.map((h) => `${h.sourceTenantId}:${h.eventId}`),
    );
    return events.map((e) => ({
      tenantId: e.tenantId,
      eventId: e.eventId,
      name: e.name,
      description: e.description,
      startTime: e.startTime,
      endTime: e.endTime,
      venueName: e.venueName,
      serviceCount: e.serviceCount,
      fromPath: paths.get(e.tenantId) ?? '',
      hidden: hidden.has(`${e.tenantId}:${e.eventId}`),
    }));
  }

  private assertWindow(from: Date, to: Date): void {
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      to <= from
    ) {
      throw new BadRequestException('Choose a valid date range.');
    }
    if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
      throw new BadRequestException(
        `Choose up to ${MAX_WINDOW_DAYS} days at a time.`,
      );
    }
  }

  private async here(): Promise<Tenant> {
    if (!(await this.network.isAvailable())) {
      throw new NotFoundException('Church networks are not available yet.');
    }
    const here = await this.tenantRepo.findOne({
      where: { id: this.cls.get('tenantId') },
      select: { id: true, networkRootId: true },
    });
    if (!here?.networkRootId)
      throw new NotFoundException('Your church is not part of a network.');
    return here;
  }
}
