import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { randomInt } from 'node:crypto';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';
import { MemberService } from '../../member/service/member.service';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { Member } from '../../member/entity/member.entity';
import { AttendanceService } from '../../attendance/service/attendance.service';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { NetworkVenueService } from '../../venue/service/network-venue.service';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { NetworkVisitCode } from '../entity/network-visit-code.entity';
import { NetworkVisitor } from '../entity/network-visitor.entity';
import { NetworkService } from './network.service';
import { NetworkSettingsService } from './network-settings.service';

// Close enough to a venue to offer checking in there; the check-in itself uses the service's own allowance.
const NEARBY_METERS = 300;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// "ABC · Lagos · Lekki" → "Lekki"; messages name the branch, not the whole path.
const lastPart = (path: string) => path.split(' · ').at(-1) ?? path;

type Church = Pick<Tenant, 'id' | 'schemaName' | 'networkRootId'>;
type Location = { latitude: number; longitude: number; accuracy?: number };

export interface VisitPlace {
  tenantId: string;
  path: string;
  venueName: string | null;
  slots: { id: string; name: string; startTime: Date; endTime: Date }[];
}

export interface VenueCode {
  code: string;
  path: string;
  // The network app's address: the poster's QR opens /visit?code= there.
  appSubdomain: string | null;
}

export interface VisitorRow {
  id: string;
  name: string;
  photoUrl: string | null;
  fromPath: string;
  serviceName: string | null;
  checkinTime: Date;
}

// Checking in at another branch of the network as a visitor (Phase 4, decision 8).
@Injectable()
export class NetworkVisitService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(NetworkVisitCode)
    private readonly codeRepo: Repository<NetworkVisitCode>,
    @InjectRepository(NetworkVisitor)
    private readonly visitorRepo: Repository<NetworkVisitor>,
    private readonly network: NetworkService,
    private readonly networkVenues: NetworkVenueService,
    private readonly memberService: MemberService,
    private readonly attendance: AttendanceService,
    private readonly settings: NetworkSettingsService,
    private readonly timezone: ChurchTimezoneService,
    private readonly auditLog: AuditLogService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  // The nearest other branch's venue, with its services open to visitors now. Null when nowhere is close.
  async nearby(memberId: string, at: Location): Promise<VisitPlace | null> {
    const { here } = await this.visitor(memberId);
    const venues = (await this.networkVenues.forNetwork(here.networkRootId!))
      .filter((v) => v.tenantId !== here.id)
      .map((v) => ({
        ...v,
        distance: UtilityService.calculateDistanceInMeters(
          at.latitude,
          at.longitude,
          v.latitude,
          v.longitude,
        ),
      }))
      .sort((a, b) => a.distance - b.distance);
    const slack = Math.min(at.accuracy ?? 0, NEARBY_METERS);
    const nearest = venues[0];
    if (!nearest || nearest.distance - slack > NEARBY_METERS) return null;
    const host = await this.hostChurch(here, nearest.tenantId);
    return this.place(host, nearest.venueId, nearest.name);
  }

  // A venue code from the poster at another branch.
  async byCode(memberId: string, code: string): Promise<VisitPlace> {
    const { here } = await this.visitor(memberId);
    const host = await this.hostChurch(here, await this.tenantForCode(code));
    return this.place(host);
  }

  async checkIn(
    memberId: string,
    dto: {
      tenantId: string;
      serviceSlotId: string;
      location?: Location;
      code?: string;
    },
  ): Promise<{ message: string; path: string; suggestMove: boolean }> {
    const { here, member, accountId } = await this.visitor(memberId);
    const host = await this.hostChurch(here, dto.tenantId);
    const byCode = !!dto.code;
    if (byCode && (await this.tenantForCode(dto.code!)) !== host.id) {
      throw new BadRequestException("That code isn't for this branch.");
    }
    if (!byCode && !dto.location) {
      throw new BadRequestException(
        'Your location or the venue code is needed to check in as a visitor.',
      );
    }
    const [paths, homeDate, [threshold, weeks]] = await Promise.all([
      this.network.pathsOf(here.networkRootId!, [host.id, here.id]),
      this.localDateHere(),
      this.suggestionRule(here.networkRootId!),
    ]);
    const path = paths.get(host.id) ?? '';

    const visitsThere = await this.inChurch(host, async () => {
      const slot = await this.attendance.assertVisitorCanCheckIn(
        dto.serviceSlotId,
        byCode ? null : dto.location!,
      );
      await this.recordVisitor(slot, member, accountId, here.id);
      return threshold
        ? this.visitorRepo.count({
            where: {
              accountId,
              checkinTime: MoreThanOrEqual(
                new Date(Date.now() - weeks * WEEK_MS),
              ),
            },
          })
        : 0;
    });

    await this.attendance.recordAttendedElsewhere(member.id, host.id, homeDate);
    this.auditLog.log('NETWORK_VISIT_CHECKIN', {
      actorId: member.id,
      targetId: member.id,
      targetEmail: member.email,
    });
    return {
      message: `You're checked in at ${lastPart(path)}. ${lastPart(paths.get(here.id) ?? '') || 'Your branch'} knows you were in church today.`,
      path,
      suggestMove: threshold > 0 && visitsThere >= threshold,
    };
  }

  // Admin: this branch's venue code, made on first ask, with where the poster's QR link should open.
  async codeHere(): Promise<VenueCode> {
    const tenantId = this.cls.get('tenantId');
    const existing = await this.codeRepo.findOne({ where: { tenantId } });
    return this.withPoster(
      existing?.code ?? (await this.saveNewCode(tenantId)),
    );
  }

  // Admin: a new code when the old one has spread too far; the old poster stops working.
  async regenerateCode(actorId: string): Promise<VenueCode> {
    const tenantId = this.cls.get('tenantId');
    await this.codeRepo.delete({ tenantId });
    const code = await this.saveNewCode(tenantId);
    this.auditLog.log('NETWORK_VISIT_CODE_CHANGED', { actorId });
    return this.withPoster(code);
  }

  private async withPoster(code: string): Promise<VenueCode> {
    const here = await this.tenantRepo.findOne({
      where: { id: this.cls.get('tenantId') },
      select: { id: true, networkRootId: true },
    });
    if (!here?.networkRootId) {
      throw new NotFoundException('Your church is not part of a network.');
    }
    const [root, paths] = await Promise.all([
      this.tenantRepo.findOne({
        where: { id: here.networkRootId },
        select: { id: true, subdomain: true },
      }),
      this.network.pathsOf(here.networkRootId, [here.id]),
    ]);
    return {
      code,
      path: paths.get(here.id) ?? '',
      appSubdomain: root?.subdomain ?? null,
    };
  }

  // Admin: visitors from other branches at one service day here. Name and photo only.
  async visitorsAt(eventId: string): Promise<VisitorRow[]> {
    const rows = await this.visitorRepo.find({
      where: { event: { id: eventId } },
      relations: ['serviceSlot'],
      order: { checkinTime: 'ASC' },
    });
    if (!rows.length) return [];
    const here = await this.tenantRepo.findOne({
      where: { id: this.cls.get('tenantId') },
      select: { id: true, networkRootId: true },
    });
    const paths = here?.networkRootId
      ? await this.network.pathsOf(
          here.networkRootId,
          rows.map((r) => r.fromTenantId),
        )
      : new Map<string, string>();
    return rows.map((r) => ({
      id: r.id,
      name: `${r.firstname} ${r.lastname}`.trim(),
      photoUrl: r.photoUrl,
      fromPath: paths.get(r.fromTenantId) ?? 'Another branch',
      serviceName: r.serviceSlot?.name ?? null,
      checkinTime: r.checkinTime,
    }));
  }

  private async recordVisitor(
    slot: ServiceSlot,
    member: Member,
    accountId: string,
    fromTenantId: string,
  ): Promise<void> {
    const result = await this.visitorRepo
      .createQueryBuilder()
      .insert()
      .values({
        event: { id: slot.event.id },
        serviceSlot: { id: slot.id },
        accountId,
        fromTenantId,
        firstname: member.firstname,
        lastname: member.lastname,
        photoUrl: member.photoUrl,
        checkinTime: new Date(),
      })
      .orIgnore()
      .execute();
    if (!(result.raw as unknown[]).length) {
      throw new ConflictException({
        message: "You've already checked in here today.",
        code: 'ALREADY_CHECKED_IN',
      });
    }
  }

  private async place(
    host: Church,
    venueId?: string,
    venueName?: string,
  ): Promise<VisitPlace> {
    const [paths, slots] = await Promise.all([
      this.network.pathsOf(host.networkRootId!, [host.id]),
      this.inChurch(host, () => this.attendance.openVisitorSlots(venueId)),
    ]);
    return {
      tenantId: host.id,
      path: paths.get(host.id) ?? '',
      venueName: venueName ?? null,
      slots: slots.map((s) => ({
        id: s.id,
        name: s.name,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
    };
  }

  // Signed in at their home branch, with a Discuva account, in a network with visits switched on.
  private async visitor(memberId: string) {
    if (!(await this.network.isAvailable())) {
      throw new NotFoundException(
        'Visiting other branches is not available yet.',
      );
    }
    const member = await this.memberService.getById(memberId);
    if (member.status !== MemberStatusEnum.ACTIVE) {
      throw new ForbiddenException('Your account here is not active.');
    }
    if (!member.discuvaAccountId) {
      throw new BadRequestException(
        'Set up Discuva sign-in first, then you can check in at other branches.',
      );
    }
    const here = await this.tenantRepo.findOne({
      where: { id: this.cls.get('tenantId') },
      select: { id: true, schemaName: true, networkRootId: true },
    });
    if (!here?.networkRootId) {
      throw new NotFoundException('Your church is not part of a network.');
    }
    return { here, member, accountId: member.discuvaAccountId };
  }

  private async hostChurch(here: Church, tenantId: string): Promise<Church> {
    if (tenantId === here.id) {
      throw new BadRequestException(
        'This is your own branch. Check in as usual.',
      );
    }
    const host = await this.tenantRepo.findOne({
      where: { id: tenantId, isActive: true },
      select: { id: true, schemaName: true, networkRootId: true },
    });
    if (!host || host.networkRootId !== here.networkRootId) {
      throw new NotFoundException('That branch is not in your network.');
    }
    return host;
  }

  private async tenantForCode(code: string): Promise<string> {
    const row = await this.codeRepo.findOne({
      where: { code: code.trim().toUpperCase() },
    });
    if (!row) throw new NotFoundException("That code doesn't match a branch.");
    return row.tenantId;
  }

  private async saveNewCode(tenantId: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = Array.from(
        { length: CODE_LENGTH },
        () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
      ).join('');
      const result = await this.codeRepo
        .createQueryBuilder()
        .insert()
        .values({ tenantId, code })
        .orIgnore()
        .execute();
      if ((result.raw as unknown[]).length) return code;
    }
    throw new ConflictException('Please try again.');
  }

  private async localDateHere(): Promise<string> {
    const tz = await this.timezone.get();
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  // The network's own numbers (Network settings), within the platform's range.
  private async suggestionRule(rootId: string): Promise<[number, number]> {
    const s = await this.settings.get(rootId);
    return [s.visitSuggestVisits, s.visitSuggestWeeks];
  }

  private inChurch<T>(church: Church, fn: () => Promise<T>): Promise<T> {
    return runInTenantContext(
      this.cls,
      this.txHost,
      { tenantId: church.id, schemaName: church.schemaName },
      fn,
    );
  }
}
