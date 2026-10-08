import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Note } from '../entity/note.entity';
import { NoteKindEnum } from '../enum/note-kind.enum';
import {
  CreateNoteDto,
  NoteQueryDto,
  ScriptureTapsDto,
  UpdateNoteDto,
} from '../dto/note.dto';
import {
  NOTE_CONTENT_MAX_BYTES,
  NoteNode,
  commitmentOf,
  wordCountOf,
  docFromPlainText,
  isNoteDoc,
  plainTextOf,
  scriptureRefsOf,
} from '../util/note-content';
import {
  NoteStreak,
  computeStreak,
  currentWeekStart,
} from '../util/note-streak';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { Sermon } from '../../sermon/entity/sermon.entity';
import { ChurchTimezoneService } from '../../event/service/church-timezone.service';
import { CacheService } from '../../utility/service/cache.service';
import { UtilityService } from '../../utility/service/utility.service';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';

// "Most noted" only shows a verse once this many people noted it, so it never points at one member.
export const TOP_SCRIPTURE_MIN_MEMBERS = 3;
const STREAK_TTL_SECONDS = 3600;
const TOP_SCRIPTURES_TTL_SECONDS = 600;
const EXCERPT_LENGTH = 160;
const UNIQUE_VIOLATION = '23505';

export interface NoteSummary {
  id: string;
  kind: NoteKindEnum;
  title: string;
  excerpt: string;
  pinned: boolean;
  scriptureRefs: string[];
  createdAt: Date;
  updatedAt: Date;
  sermon: { id: string; title: string } | null;
  event: { id: string; name: string } | null;
  serviceSlot: { id: string; name: string; startTime: Date } | null;
}

export interface NoteContext {
  serviceSlot: { id: string; name: string; startTime: Date; endTime: Date };
  event: { id: string; name: string };
  isLive: boolean;
  checkedIn: boolean;
  speaker: { name: string; topic: string | null } | null;
  sermon: {
    id: string;
    title: string;
    speakerName: string;
    series: string | null;
  } | null;
  noteId: string | null;
}

export interface NoteService {
  serviceSlotId: string;
  serviceName: string;
  eventId: string;
  eventName: string;
  startTime: Date;
}

export interface NoteSermon {
  id: string;
  title: string;
  speakerName: string;
  date: Date;
}

export type NoteWithService = Omit<Note, 'sermon' | 'serviceSlot' | 'event'> & {
  service: NoteService | null;
  sermon: NoteSermon | null;
};

export interface LinkableService extends NoteService {
  attended: boolean;
  // The member's note already linked to this service, if any (one note per service).
  noteId: string | null;
}

// How far back "Link to a service" looks.
export const LINKABLE_SERVICE_DAYS = 35;

export interface LegacySermonNote {
  id: string;
  note: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class NotesService {
  constructor(
    @InjectRepository(Note)
    private readonly noteRepo: Repository<Note>,
    @InjectRepository(ServiceSlot)
    private readonly slotRepo: Repository<ServiceSlot>,
    @InjectRepository(Sermon)
    private readonly sermonRepo: Repository<Sermon>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly cacheService: CacheService,
    private readonly churchTimezone: ChurchTimezoneService,
  ) {}

  async list(
    memberId: string,
    query: NoteQueryDto,
  ): Promise<PaginationResponseDto<NoteSummary>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const params: unknown[] = [memberId];
    const where = ['n.member_id = $1'];
    if (query.kind) {
      params.push(query.kind);
      where.push(`n.kind = $${params.length}`);
    }
    if (query.sermonId) {
      params.push(query.sermonId);
      where.push(`n.sermon_id = $${params.length}`);
    }
    if (query.q?.trim()) {
      params.push(`%${query.q.trim().replace(/[\\%_]/g, '\\$&')}%`);
      where.push(
        `(n.title ILIKE $${params.length} OR n.plain_text ILIKE $${params.length})`,
      );
    }
    const whereSql = where.join(' AND ');

    const [rows, countRows] = await Promise.all([
      this.txHost.tx.query(
        `SELECT n.id, n.kind, n.title, left(n.plain_text, ${EXCERPT_LENGTH}) AS excerpt, n.pinned,
                n.scripture_refs AS "scriptureRefs", n.created_at AS "createdAt", n.updated_at AS "updatedAt",
                s.id AS "sermonId", s.title AS "sermonTitle",
                e.id AS "eventId", e.name AS "eventName",
                ss.id AS "slotId", ss.name AS "slotName", ss.start_time AS "slotStart"
         FROM notes n
         LEFT JOIN sermons s ON s.id = n.sermon_id
         LEFT JOIN events e ON e.id = n.event_id
         LEFT JOIN service_slots ss ON ss.id = n.service_slot_id
         WHERE ${whereSql}
         ORDER BY n.pinned DESC, n.updated_at DESC
         LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
        params,
      ),
      this.txHost.tx.query(
        `SELECT COUNT(*)::int AS total FROM notes n WHERE ${whereSql}`,
        params,
      ),
    ]);

    const data: NoteSummary[] = (rows as Record<string, any>[]).map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      excerpt: r.excerpt,
      pinned: r.pinned,
      scriptureRefs: r.scriptureRefs ?? [],
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      sermon: r.sermonId ? { id: r.sermonId, title: r.sermonTitle } : null,
      event: r.eventId ? { id: r.eventId, name: r.eventName } : null,
      serviceSlot: r.slotId
        ? { id: r.slotId, name: r.slotName, startTime: r.slotStart }
        : null,
    }));
    const total = (countRows as { total: number }[])[0]?.total ?? 0;
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async get(memberId: string, id: string): Promise<NoteWithService> {
    return this.withService(await this.owned(memberId, id));
  }

  private async owned(memberId: string, id: string): Promise<Note> {
    const note = await this.noteRepo.findOne({ where: { id, memberId } });
    if (!note) throw new NotFoundException('Note not found');
    return note;
  }

  private async withService(note: Note): Promise<NoteWithService> {
    const [[service], [sermon]] = await Promise.all([
      note.serviceSlotId
        ? (this.txHost.tx.query(
            `SELECT ss.id AS "serviceSlotId", ss.name AS "serviceName", ss.start_time AS "startTime",
                    e.id AS "eventId", e.name AS "eventName"
             FROM service_slots ss JOIN events e ON e.id = ss.event_id
             WHERE ss.id = $1`,
            [note.serviceSlotId],
          ) as Promise<NoteService[]>)
        : [],
      note.sermonId
        ? (this.txHost.tx.query(
            `SELECT id, title, speaker_name AS "speakerName", date FROM sermons WHERE id = $1`,
            [note.sermonId],
          ) as Promise<NoteSermon[]>)
        : [],
    ]);
    return { ...note, service: service ?? null, sermon: sermon ?? null };
  }

  // Recent services the member can link a note to: events for everyone, plus any they attended.
  async linkableServices(memberId: string): Promise<LinkableService[]> {
    return (await this.txHost.tx.query(
      `SELECT ss.id AS "serviceSlotId", ss.name AS "serviceName", ss.start_time AS "startTime",
              e.id AS "eventId", e.name AS "eventName",
              (a.id IS NOT NULL) AS attended,
              n.id AS "noteId"
       FROM service_slots ss
       JOIN events e ON e.id = ss.event_id
       LEFT JOIN attendances a ON a.event_id = e.id AND a.member_id = $1
         AND a.status IN ('PRESENT', 'LATE', 'ATTENDED_ONLINE')
       LEFT JOIN notes n ON n.service_slot_id = ss.id AND n.member_id = $1
       WHERE ss.start_time >= now() - make_interval(days => $2)
         AND ss.start_time <= now() + interval '1 day'
         AND (e.audience = 'EVERYONE' OR a.id IS NOT NULL)
       ORDER BY ss.start_time DESC
       LIMIT 60`,
      [memberId, LINKABLE_SERVICE_DAYS],
    )) as LinkableService[];
  }

  async create(memberId: string, dto: CreateNoteDto): Promise<Note> {
    const content = this.validContent(dto.content);
    const note = this.noteRepo.create({
      memberId,
      kind: dto.kind ?? NoteKindEnum.PERSONAL,
      title: dto.title?.trim() ?? '',
      sermonId: null,
      eventId: null,
      serviceSlotId: null,
    });

    if (dto.serviceSlotId) {
      const existing = await this.noteRepo.findOne({
        where: { memberId, serviceSlotId: dto.serviceSlotId },
      });
      if (existing) return existing;
      const slot = await this.slotRepo.findOne({
        where: { id: dto.serviceSlotId },
        relations: { event: true },
      });
      if (!slot) throw new NotFoundException('Service not found');
      note.serviceSlotId = slot.id;
      note.eventId = slot.event.id;
      note.kind = dto.kind ?? NoteKindEnum.SERMON;
      note.title ||= slot.event.name;
    }

    if (dto.sermonId) {
      const sermon = await this.sermonRepo.findOne({
        where: { id: dto.sermonId },
      });
      if (!sermon) throw new NotFoundException('Sermon not found');
      note.sermonId = sermon.id;
      note.kind = dto.kind ?? NoteKindEnum.SERMON;
      note.title ||= sermon.title;
    }

    this.applyContent(note, content);
    try {
      const saved = await this.noteRepo.save(note);
      this.forgetStreak(memberId);
      return saved;
    } catch (err) {
      // Two taps on "Start my notes" at once: the second gets the note the first created.
      if (
        (err as { code?: string }).code === UNIQUE_VIOLATION &&
        dto.serviceSlotId
      ) {
        const existing = await this.noteRepo.findOne({
          where: { memberId, serviceSlotId: dto.serviceSlotId },
        });
        if (existing) return existing;
      }
      throw err;
    }
  }

  async update(
    memberId: string,
    id: string,
    dto: UpdateNoteDto,
  ): Promise<NoteWithService> {
    const note = await this.owned(memberId, id);
    const editsText = dto.content !== undefined || dto.title !== undefined;
    if (
      editsText &&
      dto.baseUpdatedAt &&
      note.updatedAt.getTime() > Date.parse(dto.baseUpdatedAt)
    ) {
      throw new ConflictException({
        code: 'NOTE_CONFLICT',
        message: 'This note was changed on another device.',
        note,
      });
    }

    if (dto.title !== undefined) note.title = dto.title.trim();
    if (dto.pinned !== undefined) note.pinned = dto.pinned;
    if (dto.content !== undefined) {
      this.applyContent(note, this.validContent(dto.content));
    }
    if (dto.sermonId !== undefined) {
      if (dto.sermonId) {
        const exists = await this.sermonRepo.exists({
          where: { id: dto.sermonId },
        });
        if (!exists) throw new NotFoundException('Sermon not found');
      }
      note.sermonId = dto.sermonId;
    }
    if (dto.serviceSlotId !== undefined) {
      await this.linkService(note, dto.serviceSlotId);
    }
    try {
      return this.withService(await this.noteRepo.save(note));
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw this.serviceTaken(note.serviceSlotId);
      }
      throw err;
    }
  }

  private async linkService(note: Note, serviceSlotId: string | null) {
    if (!serviceSlotId) {
      note.serviceSlotId = null;
      note.eventId = null;
      return;
    }
    const slot = await this.slotRepo.findOne({
      where: { id: serviceSlotId },
      relations: { event: true },
    });
    if (!slot) throw new NotFoundException('Service not found');
    const other = await this.noteRepo.findOne({
      where: { memberId: note.memberId, serviceSlotId },
      select: { id: true },
    });
    if (other && other.id !== note.id)
      throw this.serviceTaken(serviceSlotId, other.id);
    note.serviceSlotId = slot.id;
    note.eventId = slot.event.id;
  }

  private serviceTaken(serviceSlotId: string | null, noteId?: string) {
    return new ConflictException({
      code: 'NOTE_SERVICE_TAKEN',
      message: 'You already have a note for this service.',
      serviceSlotId,
      noteId: noteId ?? null,
    });
  }

  async remove(memberId: string, id: string): Promise<void> {
    const result = await this.noteRepo.delete({ id, memberId });
    if (!result.affected) throw new NotFoundException('Note not found');
    this.forgetStreak(memberId);
  }

  // The service happening now (or earlier today), so a note can start with its details filled in.
  async context(memberId: string): Promise<NoteContext | null> {
    const [slot] = (await this.txHost.tx.query(
      `SELECT ss.id, ss.name, ss.start_time AS "startTime", ss.end_time AS "endTime",
              e.id AS "eventId", e.name AS "eventName",
              (a.id IS NOT NULL) AS "checkedIn",
              (now() BETWEEN ss.start_time AND ss.end_time) AS "isLive"
       FROM service_slots ss
       JOIN events e ON e.id = ss.event_id
       LEFT JOIN attendances a ON a.event_id = e.id AND a.member_id = $1
         AND a.status IN ('PRESENT', 'LATE', 'ATTENDED_ONLINE')
       WHERE ss.start_time <= now() + interval '30 minutes'
         AND ss.end_time >= now() - interval '12 hours'
         AND (e.audience = 'EVERYONE' OR a.id IS NOT NULL)
       ORDER BY (a.service_slot_id = ss.id) DESC NULLS LAST,
                (now() BETWEEN ss.start_time AND ss.end_time) DESC,
                ss.start_time DESC
       LIMIT 1`,
      [memberId],
    )) as Record<string, any>[];
    if (!slot) return null;

    const timezone = await this.churchTimezone.get();
    const [[speaker], [sermon], existing] = await Promise.all([
      this.txHost.tx.query(
        `SELECT sps.topic,
                COALESCE(NULLIF(trim(concat_ws(' ', m.firstname, m.lastname)), ''), sps.guest_name) AS name
         FROM service_programmes sp
         JOIN service_programme_slots sps ON sps.programme_id = sp.id
         LEFT JOIN members m ON m.id = sps.member_id
         WHERE sp.service_slot_id = $1 AND sps.type = 'SPEAKER'
         ORDER BY sps.position
         LIMIT 1`,
        [slot.id],
      ) as Promise<Record<string, any>[]>,
      this.txHost.tx.query(
        `SELECT id, title, speaker_name AS "speakerName", series
         FROM sermons
         WHERE (date AT TIME ZONE $2)::date = ($1::timestamptz AT TIME ZONE $2)::date
         ORDER BY created_at DESC
         LIMIT 1`,
        [slot.startTime, timezone],
      ) as Promise<Record<string, any>[]>,
      this.noteRepo.findOne({
        where: { memberId, serviceSlotId: slot.id },
        select: { id: true },
      }),
    ]);

    return {
      serviceSlot: {
        id: slot.id,
        name: slot.name,
        startTime: slot.startTime,
        endTime: slot.endTime,
      },
      event: { id: slot.eventId, name: slot.eventName },
      isLive: slot.isLive,
      checkedIn: slot.checkedIn,
      speaker: speaker?.name
        ? { name: speaker.name, topic: speaker.topic ?? null }
        : null,
      sermon: sermon
        ? {
            id: sermon.id,
            title: sermon.title,
            speakerName: sermon.speakerName,
            series: sermon.series ?? null,
          }
        : null,
      noteId: existing?.id ?? null,
    };
  }

  async streak(memberId: string): Promise<NoteStreak> {
    const key = this.streakKey(memberId);
    const cached = await this.cacheService.get<{ weeks: string[] }>(key);
    const timezone = await this.churchTimezone.get();
    let weeks = cached?.weeks;
    if (!weeks) {
      const rows = (await this.txHost.tx.query(
        `SELECT DISTINCT to_char(date_trunc('week', created_at AT TIME ZONE $2), 'YYYY-MM-DD') AS week
         FROM notes
         WHERE member_id = $1 AND kind = $3 AND word_count > 0
         ORDER BY week DESC
         LIMIT 520`,
        [memberId, timezone, NoteKindEnum.SERMON],
      )) as { week: string }[];
      weeks = rows.map((r) => r.week);
      this.cacheService.set(key, { weeks }, STREAK_TTL_SECONDS);
    }
    return computeStreak(weeks, currentWeekStart(timezone));
  }

  async topScriptures(
    eventId: string,
  ): Promise<{ ref: string; count: number }[]> {
    const key = this.cacheService.key('notes-top-scriptures', eventId);
    const cached =
      await this.cacheService.get<{ ref: string; count: number }[]>(key);
    if (cached) return cached;
    const rows = (await this.txHost.tx.query(
      `SELECT ref, COUNT(DISTINCT n.member_id)::int AS count
       FROM notes n, jsonb_array_elements_text(n.scripture_refs) AS ref
       WHERE n.event_id = $1
       GROUP BY ref
       HAVING COUNT(DISTINCT n.member_id) >= $2
       ORDER BY count DESC, ref
       LIMIT 5`,
      [eventId, TOP_SCRIPTURE_MIN_MEMBERS],
    )) as { ref: string; count: number }[];
    this.cacheService.set(key, rows, TOP_SCRIPTURES_TTL_SECONDS);
    return rows;
  }

  async recordScriptureTaps(dto: ScriptureTapsDto): Promise<void> {
    if (!dto.taps.length) return;
    const day = await this.today();
    for (const tap of dto.taps) {
      await this.txHost.tx.query(
        `INSERT INTO scripture_link_taps (day, version, count) VALUES ($1, $2, $3)
         ON CONFLICT (day, version) DO UPDATE SET count = scripture_link_taps.count + EXCLUDED.count`,
        [day, tap.version, tap.count],
      );
    }
  }

  async preferences(memberId: string): Promise<{ nudges: boolean }> {
    const [row] = (await this.txHost.tx.query(
      `SELECT note_nudges AS nudges FROM members WHERE id = $1`,
      [memberId],
    )) as { nudges: boolean }[];
    return { nudges: row?.nudges ?? true };
  }

  async setPreferences(
    memberId: string,
    nudges: boolean,
  ): Promise<{ nudges: boolean }> {
    await this.txHost.tx.query(
      `UPDATE members SET note_nudges = $2 WHERE id = $1`,
      [memberId, nudges],
    );
    return { nudges };
  }

  // Counts only — note content is never exposed to admins.
  async insights(): Promise<{
    notesLast30Days: number;
    membersLast30Days: number;
    scriptureTaps: { version: string; count: number }[];
  }> {
    const [[activity], taps] = await Promise.all([
      this.txHost.tx.query(
        `SELECT COUNT(*)::int AS notes, COUNT(DISTINCT member_id)::int AS members
         FROM notes WHERE created_at >= now() - interval '30 days' AND word_count > 0`,
      ) as Promise<{ notes: number; members: number }[]>,
      this.txHost.tx.query(
        `SELECT version, SUM(count)::int AS count
         FROM scripture_link_taps WHERE day >= current_date - 90
         GROUP BY version ORDER BY count DESC`,
      ) as Promise<{ version: string; count: number }[]>,
    ]);
    return {
      notesLast30Days: activity?.notes ?? 0,
      membersLast30Days: activity?.members ?? 0,
      scriptureTaps: taps,
    };
  }

  // Backs the original GET/PUT/DELETE /sermons/:id/note routes, which only knew plain text.
  async legacySermonNote(
    sermonId: string,
    memberId: string,
  ): Promise<LegacySermonNote | null> {
    const note = await this.latestSermonNote(sermonId, memberId);
    return note ? this.toLegacy(note) : null;
  }

  async upsertLegacySermonNote(
    sermonId: string,
    memberId: string,
    text: string,
  ): Promise<LegacySermonNote> {
    const existing = await this.latestSermonNote(sermonId, memberId);
    if (existing) {
      this.applyContent(existing, docFromPlainText(text));
      return this.toLegacy(await this.noteRepo.save(existing));
    }
    return this.toLegacy(
      await this.create(memberId, {
        sermonId,
        kind: NoteKindEnum.SERMON,
        content: docFromPlainText(text),
      }),
    );
  }

  async deleteLegacySermonNote(
    sermonId: string,
    memberId: string,
  ): Promise<void> {
    await this.noteRepo.delete({ sermonId, memberId });
    this.forgetStreak(memberId);
  }

  private latestSermonNote(sermonId: string, memberId: string) {
    return this.noteRepo.findOne({
      where: { sermonId, memberId },
      order: { updatedAt: 'DESC' },
    });
  }

  private toLegacy(note: Note): LegacySermonNote {
    return {
      id: note.id,
      note: note.plainText,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    };
  }

  private validContent(content: unknown): NoteNode {
    if (!isNoteDoc(content)) {
      throw new BadRequestException('Note content must be a document.');
    }
    if (JSON.stringify(content).length > NOTE_CONTENT_MAX_BYTES) {
      throw new BadRequestException('This note is too long to save.');
    }
    return content;
  }

  private applyContent(note: Note, content: NoteNode): void {
    note.content = content;
    note.plainText = plainTextOf(content);
    note.scriptureRefs = scriptureRefsOf(content);
    note.commitment = commitmentOf(content);
    note.wordCount = wordCountOf(content);
  }

  private streakKey(memberId: string): string {
    return this.cacheService.key('notes-streak', memberId);
  }

  private forgetStreak(memberId: string): void {
    this.cacheService.del(this.streakKey(memberId));
  }

  private async today(): Promise<string> {
    return format(
      toZonedTime(new Date(), await this.churchTimezone.get()),
      'yyyy-MM-dd',
    );
  }
}
