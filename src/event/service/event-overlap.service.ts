import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { DateService } from '../../utility/service/date.service';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { MeetingFormatEnum } from '../../utility/enum/meeting-format.enum';
import { EventOverlapRule } from '../enums/event-overlap-rule.enum';
import { EventAudienceEnum } from '../enums/event-audience.enum';
import { OverlapDetail } from '../types/event-preview';

const STORAGE_KEY = 'events:overlap_rule';
const CACHE_KEY = 'event-settings:overlap-rule';
const CACHE_TTL = 300;

export interface EventOverlapConfig {
  rule: EventOverlapRule;
  // true until the church picks its own rule.
  isDefault: boolean;
}

// A service about to be saved; venueId is null unless it's in person.
export interface OverlapCandidate {
  name: string;
  startTime: Date;
  endTime: Date;
  venueId: string | null;
  forEveryone: boolean;
}

// What the event being saved must not clash with: itself, and its own series.
export interface OverlapExclusion {
  eventId?: string;
  seriesId?: string;
}

export interface OverlapClash {
  slot: OverlapCandidate;
  eventName: string;
  slotName: string;
  startTime: Date;
  endTime: Date;
  venueName: string | null;
  theirsForEveryone: boolean;
}

@Injectable()
export class EventOverlapService {
  constructor(
    @InjectRepository(ChurchSetting)
    private readonly settingRepo: Repository<ChurchSetting>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly cacheService: CacheService,
    private readonly auditLogService: AuditLogService,
    private readonly dateService: DateService,
    private readonly churchTimezone: ChurchTimezoneService,
  ) {}

  async getConfig(): Promise<EventOverlapConfig> {
    const row = await this.settingRepo.findOne({ where: { key: STORAGE_KEY } });
    const rule = (row?.value as { rule?: EventOverlapRule } | undefined)?.rule;
    return rule
      ? { rule, isDefault: false }
      : { rule: EventOverlapRule.BLOCK_ALL, isDefault: true };
  }

  async getRule(): Promise<EventOverlapRule> {
    const cached = await this.cacheService.get<EventOverlapRule>(CACHE_KEY);
    if (cached) return cached;
    const { rule } = await this.getConfig();
    this.cacheService.set(CACHE_KEY, rule, CACHE_TTL);
    return rule;
  }

  async setRule(
    rule: EventOverlapRule,
    actorMemberId?: string,
  ): Promise<EventOverlapConfig> {
    let row = await this.settingRepo.findOne({ where: { key: STORAGE_KEY } });
    if (!row) {
      row = this.settingRepo.create({
        key: STORAGE_KEY,
        moduleName: 'Events',
        value: { rule },
      });
    } else {
      row.value = { rule };
    }
    await this.settingRepo.save(row);
    this.cacheService.del(CACHE_KEY);
    this.auditLogService.log('EVENT_OVERLAP_RULE_UPDATED', {
      actorId: actorMemberId,
      metadata: { rule },
    });
    return { rule, isDefault: false };
  }

  // Saves that check for clashes take turns per church until their transaction ends, so two admins
  // booking the same slot at once can't both pass. Previews don't take it; they save nothing.
  async lockSchedule(): Promise<void> {
    if ((await this.getRule()) === EventOverlapRule.ALLOW) return;
    await this.txHost.tx.query(
      `SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':event-schedule'))`,
    );
  }

  // The first clash for each new service that has one; one query however many dates a series has.
  async findClashes(
    slots: OverlapCandidate[],
    rule: EventOverlapRule,
    exclude: OverlapExclusion = {},
  ): Promise<OverlapClash[]> {
    if (!slots.length || rule === EventOverlapRule.ALLOW) return [];
    const rows = (await this.txHost.tx.query(
      `SELECT DISTINCT ON (n.i) n.i::int AS "i", e.name AS "eventName", ss.name AS "slotName",
              ss.start_time AS "startTime", ss.end_time AS "endTime", v.name AS "venueName",
              COALESCE(ss.audience, e.audience) = '${EventAudienceEnum.EVERYONE}' AS "theirsForEveryone"
         FROM unnest($1::timestamptz[], $2::timestamptz[], $3::uuid[], $4::boolean[])
              WITH ORDINALITY AS n(s, en, venue, everyone, i)
         JOIN service_slots ss ON ss.end_time > n.s AND ss.start_time < n.en
         JOIN events e ON e.id = ss.event_id
         LEFT JOIN event_config c ON c.id = ss.config_id
         LEFT JOIN venues v ON v.id = COALESCE(ss.venue_override_id, c.default_venue_id)
        WHERE ss.end_time > $8 AND ss.start_time < $9
          AND ($5::uuid IS NULL OR e.id <> $5::uuid)
          AND ($6::varchar IS NULL OR e.recurring_event_id IS DISTINCT FROM $6::varchar)
          AND ($7 = '${EventOverlapRule.BLOCK_ALL}'
               OR n.everyone
               OR COALESCE(ss.audience, e.audience) = '${EventAudienceEnum.EVERYONE}'
               OR (n.venue IS NOT NULL
                   AND COALESCE(ss.format_override, c.default_format) = '${MeetingFormatEnum.IN_PERSON}'
                   AND COALESCE(ss.venue_override_id, c.default_venue_id) = n.venue))
        ORDER BY n.i, ss.start_time`,
      [
        slots.map((s) => s.startTime),
        slots.map((s) => s.endTime),
        slots.map((s) => s.venueId),
        slots.map((s) => s.forEveryone),
        exclude.eventId ?? null,
        exclude.seriesId ?? null,
        rule,
        // The overall window lets the end_time index skip every service that finished before it.
        new Date(Math.min(...slots.map((s) => s.startTime.getTime()))),
        new Date(Math.max(...slots.map((s) => s.endTime.getTime()))),
      ],
    )) as (Omit<OverlapClash, 'slot'> & { i: number })[];
    return rows.map(({ i, ...clash }) => ({
      ...clash,
      startTime: new Date(clash.startTime),
      endTime: new Date(clash.endTime),
      slot: slots[i - 1],
    }));
  }

  async assertNoClash(
    slots: OverlapCandidate[],
    rule: EventOverlapRule,
    exclude: OverlapExclusion = {},
  ): Promise<void> {
    const [clash] = await this.findClashes(slots, rule, exclude);
    if (!clash) return;
    const mine = clash.slot;
    const phrase = await this.overlapPhrase(
      rule,
      `"${mine.name}" on ${await this.day(mine.startTime)}`,
      mine,
      clash,
    );
    throw new BadRequestException({
      message: `${phrase}. Pick another time, or change Overlapping Events in Event Configs.`,
      code: 'EVENT_OVERLAP',
    });
  }

  // Says exactly why two services can't share a time: both times, plus the venue or audience when that's the reason.
  async overlapPhrase(
    rule: EventOverlapRule,
    label: string,
    mine: OverlapCandidate,
    other: Omit<OverlapClash, 'slot'>,
  ): Promise<string> {
    return clashText(label, await this.overlapDetail(rule, mine, other));
  }

  // The same, in parts, so a screen can bold the names and colour the reason.
  async overlapDetail(
    rule: EventOverlapRule,
    mine: OverlapCandidate,
    other: Omit<OverlapClash, 'slot'>,
  ): Promise<OverlapDetail> {
    let why: string | null = null;
    if (rule === EventOverlapRule.GROUPS_AT_OTHER_VENUES) {
      if (mine.forEveryone)
        why = `${mine.name} is for everyone, so nothing else can run then`;
      else if (other.theirsForEveryone)
        why = `${other.eventName} is for everyone`;
      else if (other.venueName) why = `Both are at ${other.venueName}`;
    }
    return {
      service: {
        name: mine.name,
        time: await this.span(mine.startTime, mine.endTime),
      },
      other: {
        eventName: other.eventName,
        serviceName: other.slotName,
        time: await this.span(other.startTime, other.endTime),
      },
      why,
    };
  }

  async venueName(id: string): Promise<string | null> {
    const [row] = (await this.txHost.tx.query(
      'SELECT name FROM venues WHERE id = $1',
      [id],
    )) as { name: string }[];
    return row?.name ?? null;
  }

  // "Sun 5 Apr" in the church's timezone.
  async day(date: Date): Promise<string> {
    return this.dateService.format(
      date,
      'EEE d MMM',
      await this.churchTimezone.get(),
    );
  }

  // "9:00 AM–11:00 AM" in the church's timezone.
  async span(start: Date, end: Date): Promise<string> {
    const tz = await this.churchTimezone.get();
    const time = (d: Date) =>
      this.dateService.format(d, DateService.PATTERNS.TIME_SHORT, tz);
    return `${time(start)}–${time(end)}`;
  }
}

// Everything about a set of services that a clash depends on. Equal keys mean a save can't create a new clash,
// so renames and check-in windows are never blocked by an overlap that was already there.
export function overlapKey(
  slots: {
    name?: string;
    startTime: string;
    endTime: string;
    configId?: string;
    venueOverrideId?: string;
    formatOverride?: string;
    audience?: string;
  }[],
  audience: string | undefined,
): string {
  return `${audience ?? ''}#${slots
    .map((s) =>
      [
        s.name ?? '',
        Date.parse(s.startTime),
        Date.parse(s.endTime),
        s.configId ?? '',
        s.venueOverrideId ?? '',
        s.formatOverride ?? '',
        s.audience ?? '',
      ].join('|'),
    )
    .sort()
    .join('#')}`;
}

// A clash as one sentence, e.g. for an error or the notice after saving.
export function clashText(label: string, d: OverlapDetail): string {
  return `${label} (${d.service.time}) overlaps "${d.other.eventName}" (${d.other.serviceName}, ${d.other.time})${d.why ? `. ${d.why}` : ''}`;
}

// The same rule as findClashes, for series dates that don't exist yet.
export function servicesClash(
  a: OverlapCandidate,
  b: OverlapCandidate,
  rule: EventOverlapRule,
): boolean {
  if (rule === EventOverlapRule.ALLOW) return false;
  if (!(a.startTime < b.endTime && b.startTime < a.endTime)) return false;
  if (rule === EventOverlapRule.BLOCK_ALL) return true;
  return (
    a.forEveryone || b.forEveryone || (!!a.venueId && a.venueId === b.venueId)
  );
}
