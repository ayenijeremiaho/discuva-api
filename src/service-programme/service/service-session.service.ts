import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { randomUUID, randomInt } from 'node:crypto';
import { ServiceSession } from '../entity/service-session.entity';
import { ServiceSessionSlot } from '../entity/service-session-slot.entity';
import { ServicePauseEntry } from '../entity/service-pause-entry.entity';
import { ServiceActionEntry } from '../entity/service-action-entry.entity';
import { ServiceSessionAccessGrant } from '../entity/service-session-access-grant.entity';
import { Member } from '../../member/entity/member.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { ServiceProgrammeService } from './service-programme.service';
import { PauseSessionDto } from '../dto/pause-session.dto';
import { RuntimeOverrideDto } from '../dto/runtime-override.dto';
import { ServiceSessionStatusEnum } from '../enum/service-session-status.enum';
import { ServiceSessionSlotStatusEnum } from '../enum/service-session-slot-status.enum';
import { ServiceActionRoleEnum } from '../enum/service-action-role.enum';
import { ServiceProgrammeStatusEnum } from '../enum/service-programme-status.enum';
import { DepartmentCapability } from '../../department/enums/department-capability.enum';
import { DepartmentAccessService } from '../../department/service/department-access.service';
import { WorkerStatusEnum } from '../../member/enums/worker-status.enum';
import { Admin } from '../../admin/entity/admin.entity';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CacheService } from '../../utility/service/cache.service';
import { EmailQueueService } from '../../utility/service/email-queue.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PdfService } from '../../utility/service/pdf.service';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import {
  withMemberNamesList,
  withEffectiveSessionSlots,
  EffectiveSessionSlot,
} from '../util/slot-display';

export interface SessionAnchor {
  currentSlotPosition: number;
  slotStartedAt: number;
  slotBaseSeconds: number;
  status: ServiceSessionStatusEnum;
  isPaused: boolean;
  pausedAt: number | null;
}

export interface SessionStatePayload {
  anchor: SessionAnchor;
  session: ServiceSession;
  effectiveSlots: EffectiveSessionSlot[];
  cautionThresholdRatio: number;
}

export interface MyLiveSlotStatus {
  sessionCode: string;
  sessionStatus: ServiceSessionStatusEnum;
  myRole: 'PRIMARY' | 'BACKUP';
  myPosition: number;
  myType: string;
  myTopic: string | null;
  currentPosition: number;
  isMyTurnNow: boolean;
  hasPassed: boolean;
  // null when it's already my turn, or my slot has already passed
  estimatedSecondsUntilMyTurn: number | null;
  runningOrder: EffectiveSessionSlot[];
}

export interface SessionSlotReport {
  position: number;
  type: string;
  topic: string | null;
  speakerName: string | null;
  speakerId: string | null;
  allocatedMinutes: number;
  actualSeconds: number | null;
  overrunSeconds: number | null;
  status: string;
}

export interface SessionReport {
  sessionCode: string;
  programme: { id: string; serviceSlotName: string | null };
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  totalDurationMinutes: number | null;
  totalPauseDurationSeconds: number;
  completedSlots: number;
  totalSlots: number;
  completionRate: number;
  totalAllocatedMinutes: number;
  slotVarianceMinutes: number;
  slots: SessionSlotReport[];
  pauseCount: number;
  pauses: Array<{
    slotPosition: number;
    reason: string;
    pausedAt: Date;
    resumedAt: Date | null;
    durationSeconds: number | null;
  }>;
}

export interface SlotTypeStats {
  type: string;
  totalSlots: number;
  completedSlots: number;
  avgActualSeconds: number | null;
  avgAllocatedMinutes: number;
  avgOverrunSeconds: number | null;
  overrunCount: number;
}

export interface TopSpeaker {
  memberId: string;
  name: string;
  slotCount: number;
  totalActualSeconds: number;
  avgActualSeconds: number;
}

export interface FullEventSessionEntry {
  serviceSlotName: string;
  slotStartTime: Date;
  slotEndTime: Date;
  report: SessionReport;
}

export interface FullEventReport {
  eventName: string;
  eventDate: string;
  sessions: FullEventSessionEntry[];
  summary: {
    sessionCount: number;
    totalAllocatedMinutes: number;
    totalSlotVarianceMinutes: number;
    totalDurationMinutes: number | null;
    totalPauseMinutes: number;
    avgCompletionRate: number;
  };
}

export interface AnalyticsResult {
  from: string | null;
  to: string | null;
  totalSessions: number;
  slotTypeStats: SlotTypeStats[];
  sessions: Array<{
    sessionCode: string;
    startedAt: Date;
    totalDurationMinutes: number | null;
    completionRate: number;
    overrunSlots: number;
    totalPauseDurationSeconds: number;
  }>;
  topSpeakers: TopSpeaker[];
}

export interface MyServiceHistoryEntry {
  eventName: string | null;
  serviceSlotName: string;
  sessionDate: Date;
  type: string;
  topic: string | null;
  allocatedMinutes: number;
  actualSeconds: number | null;
}

export interface MyServiceHistoryResult {
  totalSlots: number;
  totalActualSeconds: number;
  bySlotType: Array<{
    type: string;
    count: number;
    totalActualSeconds: number;
  }>;
  entries: MyServiceHistoryEntry[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

const SESSION_TTL_LIVE = 86400 * 2;
const SESSION_TTL_COMPLETED = 86400 * 2;
const ANALYTICS_TTL = 1800;

@Injectable()
export class ServiceSessionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cacheService: CacheService,
    private readonly programmeSvc: ServiceProgrammeService,
    private readonly emailQueueService: EmailQueueService,
    private readonly pdfService: PdfService,
    @InjectRepository(ServiceSession)
    private readonly sessionRepo: Repository<ServiceSession>,
    @InjectRepository(ServiceSessionSlot)
    private readonly sessionSlotRepo: Repository<ServiceSessionSlot>,
    @InjectRepository(ServicePauseEntry)
    private readonly pauseEntryRepo: Repository<ServicePauseEntry>,
    @InjectRepository(ServiceActionEntry)
    private readonly actionEntryRepo: Repository<ServiceActionEntry>,
    @InjectRepository(ServiceSessionAccessGrant)
    private readonly accessGrantRepo: Repository<ServiceSessionAccessGrant>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    @InjectRepository(Admin)
    private readonly adminRepo: Repository<Admin>,
    @InjectRepository(WorkerProfile)
    private readonly workerProfileRepo: Repository<WorkerProfile>,
    private readonly configService: ConfigService,
    private readonly departmentAccessService: DepartmentAccessService,
  ) {}

  private readonly logger = new Logger(ServiceSessionService.name);

  // Starts only the next service slot in the event (earliest startTime among
  // DRAFT programmes), not every slot at once — a multi-service Sunday runs
  // First Service, then calling this again once it's ended picks up Second
  // Service, and so on. Reuses start() as-is per sub-service (own session,
  // own anchor, own share token) rather than introducing a parent
  // "EventSession" concept.
  async startEvent(eventId: string, memberId: string): Promise<ServiceSession> {
    await this.assertCanControlSession(memberId);

    const liveSession = await this.sessionRepo.findOne({
      where: {
        status: ServiceSessionStatusEnum.LIVE,
        programme: { serviceSlot: { event: { id: eventId } } },
      },
    });
    if (liveSession) {
      throw new ConflictException(
        'A service session for this event is still live — end it before starting the next slot',
      );
    }

    const programmes =
      await this.programmeSvc.findStartableDraftProgrammesForEvent(eventId);
    if (!programmes.length) {
      throw new BadRequestException(
        'No draft programmes with slots are ready to start for this event',
      );
    }

    return this.start(programmes[0].id, memberId);
  }

  async start(programmeId: string, memberId: string): Promise<ServiceSession> {
    await this.assertCanControlSession(memberId);

    const programme =
      await this.programmeSvc.assertProgrammeIsDraft(programmeId);
    if (!programme.slots || programme.slots.length === 0) {
      throw new BadRequestException('Programme has no slots');
    }

    const sessionCode = this.generateSessionCode();
    const now = new Date();

    const session = await this.dataSource.transaction(async (manager) => {
      const newSession = manager.create(ServiceSession, {
        programme,
        sessionCode,
        status: ServiceSessionStatusEnum.LIVE,
        startedAt: now,
        endedAt: null,
      });
      const saved = await manager.save(ServiceSession, newSession);

      const sortedSlots = [...programme.slots].sort(
        (a, b) => a.position - b.position,
      );
      const sessionSlots = sortedSlots.map((s, index) =>
        manager.create(ServiceSessionSlot, {
          session: saved,
          programmeSlot: s,
          position: index,
          status:
            index === 0
              ? ServiceSessionSlotStatusEnum.IN_PROGRESS
              : ServiceSessionSlotStatusEnum.PENDING,
          startedAt: index === 0 ? now : null,
        }),
      );
      await manager.save(ServiceSessionSlot, sessionSlots);
      return saved;
    });

    await this.programmeSvc.setProgrammeStatus(
      programmeId,
      ServiceProgrammeStatusEnum.LIVE,
    );

    const anchor: SessionAnchor = {
      currentSlotPosition: 0,
      slotStartedAt: now.getTime(),
      slotBaseSeconds: 0,
      status: ServiceSessionStatusEnum.LIVE,
      isPaused: false,
      pausedAt: null,
    };
    this.cacheService.set(
      this.anchorKey(sessionCode),
      anchor,
      SESSION_TTL_LIVE,
    );

    const shareToken = randomUUID();
    this.cacheService.set(
      this.shareKey(sessionCode),
      shareToken,
      SESSION_TTL_LIVE,
    );

    await this.logAction(
      session.id,
      ServiceActionRoleEnum.WORKER,
      'SESSION_STARTED',
      null,
      memberId,
    );

    return session;
  }

  async getShareLinks(
    sessionCode: string,
    memberId: string,
  ): Promise<{ sessionCode: string; shareToken: string }> {
    await this.assertCanControlSession(memberId);
    await this.getAnchorOrThrow(sessionCode);

    let shareToken = await this.cacheService.get<string>(
      this.shareKey(sessionCode),
    );
    if (!shareToken) {
      // Self-heal: a session whose share token was never written (a race with
      // the fire-and-forget set() in start(), a transient Redis hiccup, or a
      // session still live from before this feature existed) would otherwise
      // 404 here forever even though the session itself is perfectly live.
      shareToken = randomUUID();
      await this.cacheService.set(
        this.shareKey(sessionCode),
        shareToken,
        SESSION_TTL_LIVE,
      );
    }

    return { sessionCode, shareToken };
  }

  async rotateShareToken(
    sessionCode: string,
    memberId: string,
  ): Promise<{ sessionCode: string; shareToken: string }> {
    await this.assertCanControlSession(memberId);
    const session = await this.getSessionOrThrow(sessionCode);

    const shareToken = randomUUID();
    this.cacheService.set(
      this.shareKey(sessionCode),
      shareToken,
      SESSION_TTL_LIVE,
    );

    await this.logAction(
      session.id,
      ServiceActionRoleEnum.WORKER,
      'SHARE_TOKEN_ROTATED',
      null,
      memberId,
    );

    return { sessionCode, shareToken };
  }

  async verifyShareToken(sessionCode: string, token: string): Promise<void> {
    const shareToken = await this.cacheService.get<string>(
      this.shareKey(sessionCode),
    );
    if (!shareToken || shareToken !== token) {
      throw new ForbiddenException('Invalid or expired share link');
    }
  }

  // Named, individually-revocable access to the public Programme Manager
  // link — layered on top of the shareToken (which only gates "has the
  // link at all"). An admin/worker grants a name a short PIN; whoever uses
  // it identifies themselves once and every subsequent action is logged
  // under their name instead of the generic PUBLIC_LINK actor.
  async generateAccessGrant(
    sessionCode: string,
    name: string,
    memberId: string,
    replaceExisting = false,
  ): Promise<{ id: string; name: string; pin: string }> {
    await this.assertCanControlSession(memberId);
    const session = await this.getSessionOrThrow(sessionCode);

    // Two active grants sharing a name make sign-in ambiguous — name+PIN
    // would match whichever row the lookup happens to find first, so a
    // correct PIN for the second grant could be rejected. Flag the clash
    // instead of silently creating an ambiguous duplicate; the caller can
    // confirm replaceExisting to revoke the old one and issue a fresh PIN.
    const normalized = name.trim().toLowerCase();
    const existingGrants = await this.accessGrantRepo.find({
      where: { session: { id: session.id } },
    });
    const existing = existingGrants.find(
      (g) => !g.revokedAt && g.name.trim().toLowerCase() === normalized,
    );

    if (existing && !replaceExisting) {
      throw new ConflictException(
        `An active access grant for "${existing.name}" already exists`,
      );
    }
    if (existing && replaceExisting) {
      existing.revokedAt = new Date();
      await this.accessGrantRepo.save(existing);
      await this.logAction(
        session.id,
        ServiceActionRoleEnum.WORKER,
        'ACCESS_GRANT_REPLACED',
        `name:${existing.name}`,
        memberId,
      );
    }

    const pin = randomInt(100000, 1000000).toString();
    const pinHash = await UtilityService.hashValue(pin);

    let grant: ServiceSessionAccessGrant;
    try {
      grant = await this.accessGrantRepo.save(
        this.accessGrantRepo.create({
          session,
          name,
          pinHash,
          grantedByMember: { id: memberId } as Member,
          revokedAt: null,
          lastUsedAt: null,
        }),
      );
    } catch (err: unknown) {
      // Safety net for the race where two identical requests land between
      // the check above and this insert — the DB's partial unique index
      // catches what the pre-check couldn't.
      if ((err as { code?: string })?.code === '23505') {
        throw new ConflictException(
          `An active access grant for "${name}" already exists`,
        );
      }
      throw err;
    }

    await this.logAction(
      session.id,
      ServiceActionRoleEnum.WORKER,
      'ACCESS_GRANT_CREATED',
      `name:${name}`,
      memberId,
    );

    // The PIN only ever exists in plaintext here — it is never stored or
    // retrievable again, only its argon2 hash.
    return { id: grant.id, name: grant.name, pin };
  }

  async listAccessGrants(
    sessionCode: string,
    memberId: string,
  ): Promise<
    {
      id: string;
      name: string;
      createdAt: Date;
      revokedAt: Date | null;
      lastUsedAt: Date | null;
    }[]
  > {
    await this.assertCanControlSession(memberId);
    const session = await this.getSessionOrThrow(sessionCode);
    const grants = await this.accessGrantRepo.find({
      where: { session: { id: session.id } },
      order: { createdAt: 'ASC' },
    });

    return grants.map((g) => ({
      id: g.id,
      name: g.name,
      createdAt: g.createdAt,
      revokedAt: g.revokedAt,
      lastUsedAt: g.lastUsedAt,
    }));
  }

  async revokeAccessGrant(
    sessionCode: string,
    grantId: string,
    memberId: string,
  ): Promise<void> {
    await this.assertCanControlSession(memberId);
    const session = await this.getSessionOrThrow(sessionCode);
    const grant = await this.accessGrantRepo.findOne({
      where: { id: grantId, session: { id: session.id } },
    });
    if (!grant) throw new NotFoundException('Access grant not found');

    grant.revokedAt = new Date();
    await this.accessGrantRepo.save(grant);

    await this.logAction(
      session.id,
      ServiceActionRoleEnum.WORKER,
      'ACCESS_GRANT_REVOKED',
      `name:${grant.name}`,
      memberId,
    );
  }

  async verifyAccessGrant(
    sessionCode: string,
    name: string,
    pin: string,
  ): Promise<{ grantToken: string; name: string }> {
    await this.getAnchorOrThrow(sessionCode);
    const session = await this.getSessionOrThrow(sessionCode);

    const grants = await this.accessGrantRepo.find({
      where: { session: { id: session.id } },
    });
    const normalized = name.trim().toLowerCase();
    const grant = grants.find(
      (g) => !g.revokedAt && g.name.trim().toLowerCase() === normalized,
    );
    // Deliberately vague on failure — don't reveal whether the name or the
    // PIN was the part that didn't match.
    if (!grant) throw new ForbiddenException('Invalid name or PIN');
    const valid = await UtilityService.verifyHashedValue(pin, grant.pinHash);
    if (!valid) throw new ForbiddenException('Invalid name or PIN');

    const grantToken = randomUUID();
    await this.cacheService.set(
      this.grantKey(sessionCode, grantToken),
      { grantId: grant.id, name: grant.name },
      SESSION_TTL_LIVE,
    );

    grant.lastUsedAt = new Date();
    await this.accessGrantRepo.save(grant);

    return { grantToken, name: grant.name };
  }

  async resolveGrantToken(
    sessionCode: string,
    grantToken: string | undefined,
  ): Promise<{ grantId: string; name: string }> {
    if (!grantToken) {
      throw new ForbiddenException(
        'Missing Programme Manager access credentials',
      );
    }
    const cached = await this.cacheService.get<{
      grantId: string;
      name: string;
    }>(this.grantKey(sessionCode, grantToken));
    if (!cached) {
      throw new ForbiddenException(
        'Access expired or not recognized — please sign in again',
      );
    }

    const grant = await this.accessGrantRepo.findOne({
      where: { id: cached.grantId },
    });
    if (!grant || grant.revokedAt) {
      throw new ForbiddenException('Access has been revoked');
    }

    void this.accessGrantRepo.update(
      { id: grant.id },
      { lastUsedAt: new Date() },
    );

    return { grantId: grant.id, name: grant.name };
  }

  async advance(
    sessionCode: string,
    memberId: string | null,
    actorLabel: string | null = null,
  ): Promise<SessionAnchor> {
    if (memberId) await this.assertCanControlSession(memberId);

    const anchor = await this.getAnchorOrThrow(sessionCode);
    const session = await this.getSessionOrThrow(sessionCode);
    const totalSlots = await this.sessionSlotRepo.count({
      where: { session: { id: session.id } },
    });

    const now = Date.now();
    const currentActualSeconds = this.calcElapsed(anchor, now);

    await this.sessionSlotRepo.update(
      { session: { id: session.id }, position: anchor.currentSlotPosition },
      {
        status: ServiceSessionSlotStatusEnum.COMPLETED,
        actualSeconds: Math.round(currentActualSeconds),
        completedAt: new Date(now),
      },
    );

    const nextPosition = anchor.currentSlotPosition + 1;
    if (nextPosition >= totalSlots) {
      throw new BadRequestException('No next slot — call end session instead');
    }

    await this.sessionSlotRepo.update(
      { session: { id: session.id }, position: nextPosition },
      {
        status: ServiceSessionSlotStatusEnum.IN_PROGRESS,
        startedAt: new Date(now),
      },
    );

    if (anchor.isPaused && anchor.pausedAt) {
      await this.pauseEntryRepo
        .createQueryBuilder()
        .update()
        .set({ resumedAt: new Date(now) })
        .where('session_id = :sid AND resumed_at IS NULL', { sid: session.id })
        .execute();
    }

    const newAnchor: SessionAnchor = {
      currentSlotPosition: nextPosition,
      slotStartedAt: now,
      slotBaseSeconds: 0,
      status: ServiceSessionStatusEnum.LIVE,
      isPaused: false,
      pausedAt: null,
    };
    this.cacheService.set(
      this.anchorKey(sessionCode),
      newAnchor,
      SESSION_TTL_LIVE,
    );
    await this.logAction(
      session.id,
      memberId
        ? ServiceActionRoleEnum.WORKER
        : ServiceActionRoleEnum.PUBLIC_LINK,
      'ADVANCE_SLOT',
      `position:${nextPosition}`,
      memberId,
      actorLabel,
    );

    return newAnchor;
  }

  async rewind(
    sessionCode: string,
    memberId: string | null,
    actorLabel: string | null = null,
  ): Promise<SessionAnchor> {
    if (memberId) await this.assertCanControlSession(memberId);

    const anchor = await this.getAnchorOrThrow(sessionCode);
    const session = await this.getSessionOrThrow(sessionCode);

    if (anchor.currentSlotPosition === 0) {
      throw new BadRequestException('Already at the first slot');
    }

    const now = Date.now();
    const prevPosition = anchor.currentSlotPosition - 1;

    // Rewind nulls out completedAt/actualSeconds on both slots it touches —
    // capture what's about to be destroyed so it's recoverable from the
    // action log instead of being lost with no trace.
    const [currentSlotBefore, prevSlotBefore] = await Promise.all([
      this.sessionSlotRepo.findOne({
        where: {
          session: { id: session.id },
          position: anchor.currentSlotPosition,
        },
      }),
      this.sessionSlotRepo.findOne({
        where: { session: { id: session.id }, position: prevPosition },
      }),
    ]);

    await this.sessionSlotRepo.update(
      { session: { id: session.id }, position: anchor.currentSlotPosition },
      {
        status: ServiceSessionSlotStatusEnum.PENDING,
        startedAt: null,
        completedAt: null,
        actualSeconds: null,
      },
    );

    await this.sessionSlotRepo.update(
      { session: { id: session.id }, position: prevPosition },
      {
        status: ServiceSessionSlotStatusEnum.IN_PROGRESS,
        startedAt: new Date(now),
        completedAt: null,
        actualSeconds: null,
      },
    );

    const newAnchor: SessionAnchor = {
      currentSlotPosition: prevPosition,
      slotStartedAt: now,
      slotBaseSeconds: 0,
      status: ServiceSessionStatusEnum.LIVE,
      isPaused: false,
      pausedAt: null,
    };
    this.cacheService.set(
      this.anchorKey(sessionCode),
      newAnchor,
      SESSION_TTL_LIVE,
    );
    const restoreDetail = {
      currentSlot: currentSlotBefore && {
        position: currentSlotBefore.position,
        status: currentSlotBefore.status,
        startedAt: currentSlotBefore.startedAt,
        completedAt: currentSlotBefore.completedAt,
        actualSeconds: currentSlotBefore.actualSeconds,
      },
      prevSlot: prevSlotBefore && {
        position: prevSlotBefore.position,
        status: prevSlotBefore.status,
        startedAt: prevSlotBefore.startedAt,
        completedAt: prevSlotBefore.completedAt,
        actualSeconds: prevSlotBefore.actualSeconds,
      },
    };
    await this.logAction(
      session.id,
      memberId
        ? ServiceActionRoleEnum.WORKER
        : ServiceActionRoleEnum.PUBLIC_LINK,
      'REWIND_SLOT',
      `position:${prevPosition}:restoredFrom:${JSON.stringify(restoreDetail)}`,
      memberId,
      actorLabel,
    );

    return newAnchor;
  }

  async pause(
    sessionCode: string,
    dto: PauseSessionDto,
    memberId: string | null,
    actorLabel: string | null = null,
  ): Promise<SessionAnchor> {
    if (memberId) await this.assertCanControlSession(memberId);

    const anchor = await this.getAnchorOrThrow(sessionCode);
    if (anchor.isPaused)
      throw new BadRequestException('Session is already paused');

    const session = await this.getSessionOrThrow(sessionCode);
    const now = Date.now();

    await this.pauseEntryRepo.save(
      this.pauseEntryRepo.create({
        session,
        slotPosition: anchor.currentSlotPosition,
        reason: dto.reason,
        pausedAt: new Date(now),
        resumedAt: null,
      }),
    );

    const newAnchor: SessionAnchor = {
      ...anchor,
      isPaused: true,
      pausedAt: now,
    };
    this.cacheService.set(
      this.anchorKey(sessionCode),
      newAnchor,
      SESSION_TTL_LIVE,
    );
    await this.logAction(
      session.id,
      memberId
        ? ServiceActionRoleEnum.WORKER
        : ServiceActionRoleEnum.PUBLIC_LINK,
      'PAUSE',
      dto.reason,
      memberId,
      actorLabel,
    );

    return newAnchor;
  }

  async resume(
    sessionCode: string,
    memberId: string | null,
    actorLabel: string | null = null,
  ): Promise<SessionAnchor> {
    if (memberId) await this.assertCanControlSession(memberId);

    const anchor = await this.getAnchorOrThrow(sessionCode);
    if (!anchor.isPaused || !anchor.pausedAt)
      throw new BadRequestException('Session is not paused');

    const session = await this.getSessionOrThrow(sessionCode);
    const now = Date.now();

    await this.pauseEntryRepo
      .createQueryBuilder()
      .update()
      .set({ resumedAt: new Date(now) })
      .where('session_id = :sid AND resumed_at IS NULL', { sid: session.id })
      .execute();

    const elapsedBeforePause =
      anchor.slotBaseSeconds + (anchor.pausedAt - anchor.slotStartedAt) / 1000;
    const newAnchor: SessionAnchor = {
      currentSlotPosition: anchor.currentSlotPosition,
      slotStartedAt: now,
      slotBaseSeconds: elapsedBeforePause,
      status: ServiceSessionStatusEnum.LIVE,
      isPaused: false,
      pausedAt: null,
    };
    this.cacheService.set(
      this.anchorKey(sessionCode),
      newAnchor,
      SESSION_TTL_LIVE,
    );
    await this.logAction(
      session.id,
      memberId
        ? ServiceActionRoleEnum.WORKER
        : ServiceActionRoleEnum.PUBLIC_LINK,
      'RESUME',
      null,
      memberId,
      actorLabel,
    );

    return newAnchor;
  }

  async adjustTime(
    sessionCode: string,
    deltaSeconds: number,
    memberId: string | null,
    actorLabel: string | null = null,
  ): Promise<SessionAnchor> {
    if (memberId) await this.assertCanControlSession(memberId);

    const anchor = await this.getAnchorOrThrow(sessionCode);
    const session = await this.getSessionOrThrow(sessionCode);
    const now = Date.now();

    const elapsed = this.calcElapsed(anchor, now);
    const newElapsed = Math.max(0, elapsed - deltaSeconds);

    const newAnchor: SessionAnchor = anchor.isPaused
      ? { ...anchor, slotBaseSeconds: newElapsed }
      : { ...anchor, slotStartedAt: now, slotBaseSeconds: newElapsed };

    this.cacheService.set(
      this.anchorKey(sessionCode),
      newAnchor,
      SESSION_TTL_LIVE,
    );
    await this.logAction(
      session.id,
      memberId
        ? ServiceActionRoleEnum.WORKER
        : ServiceActionRoleEnum.PUBLIC_LINK,
      'TIME_ADJUSTED',
      `position:${anchor.currentSlotPosition}:delta:${deltaSeconds}`,
      memberId,
      actorLabel,
    );

    return newAnchor;
  }

  async overrideSlot(
    sessionCode: string,
    position: number,
    dto: RuntimeOverrideDto,
    memberId: string | null,
    actorLabel: string | null = null,
  ): Promise<ServiceSessionSlot> {
    if (memberId) await this.assertCanControlSession(memberId);

    const session = await this.getSessionOrThrow(sessionCode);
    const sessionSlot = await this.sessionSlotRepo.findOne({
      where: { session: { id: session.id }, position },
      relations: ['overriddenMember'],
    });
    if (!sessionSlot)
      throw new NotFoundException(`No slot at position ${position}`);

    if (dto.overriddenSpeakerName !== undefined)
      sessionSlot.overriddenSpeakerName = dto.overriddenSpeakerName;
    if (dto.overriddenTopic !== undefined)
      sessionSlot.overriddenTopic = dto.overriddenTopic;
    if (dto.adjustedAllocatedMinutes !== undefined)
      sessionSlot.adjustedAllocatedMinutes = dto.adjustedAllocatedMinutes;
    if (dto.overriddenMemberId !== undefined) {
      sessionSlot.overriddenMember = dto.overriddenMemberId
        ? await this.memberRepo.findOne({
            where: { id: dto.overriddenMemberId },
          })
        : null;
    }

    const saved = await this.sessionSlotRepo.save(sessionSlot);
    await this.logAction(
      session.id,
      memberId
        ? ServiceActionRoleEnum.WORKER
        : ServiceActionRoleEnum.PUBLIC_LINK,
      'SLOT_OVERRIDE',
      `position:${position}`,
      memberId,
      actorLabel,
    );

    return saved;
  }

  async reorderLiveSlots(
    sessionCode: string,
    orderedIds: string[],
    memberId: string | null,
    actorLabel: string | null = null,
  ): Promise<ServiceSessionSlot[]> {
    if (memberId) await this.assertCanControlSession(memberId);

    const anchor = await this.getAnchorOrThrow(sessionCode);
    const session = await this.getSessionOrThrow(sessionCode);

    const allSlots = await this.sessionSlotRepo.find({
      where: { session: { id: session.id } },
      order: { position: 'ASC' },
    });

    const pendingSlots = allSlots.filter(
      (s) => s.position > anchor.currentSlotPosition,
    );
    const pendingMap = new Map(pendingSlots.map((s) => [s.id, s]));
    if (
      orderedIds.some((id) => !pendingMap.has(id)) ||
      orderedIds.length !== pendingSlots.length
    ) {
      throw new BadRequestException(
        'Slot list must contain exactly the upcoming (not-yet-started) slot IDs',
      );
    }

    const updated = orderedIds.map((id, index) => {
      const slot = pendingMap.get(id);
      slot.position = anchor.currentSlotPosition + 1 + index;
      return slot;
    });

    const saved = await this.dataSource.transaction((manager) =>
      manager.save(ServiceSessionSlot, updated),
    );

    await this.logAction(
      session.id,
      memberId
        ? ServiceActionRoleEnum.WORKER
        : ServiceActionRoleEnum.PUBLIC_LINK,
      'SLOTS_REORDERED',
      `positions:${anchor.currentSlotPosition + 1}-${allSlots.length - 1}`,
      memberId,
      actorLabel,
    );

    return saved;
  }

  async end(
    sessionCode: string,
    memberId: string | null,
    actorLabel: string | null = null,
  ): Promise<ServiceSession> {
    if (memberId) await this.assertCanControlSession(memberId);

    const anchor = await this.getAnchorOrThrow(sessionCode);
    const session = await this.getSessionOrThrow(sessionCode, [
      'programme',
      'programme.slots',
      'programme.serviceSlot',
    ]);

    const now = Date.now();
    const currentActualSeconds = this.calcElapsed(anchor, now);

    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        ServiceSessionSlot,
        { session: { id: session.id }, position: anchor.currentSlotPosition },
        {
          status: ServiceSessionSlotStatusEnum.COMPLETED,
          actualSeconds: Math.round(currentActualSeconds),
          completedAt: new Date(now),
        },
      );
      await manager.update(
        ServiceSessionSlot,
        {
          session: { id: session.id },
          status: ServiceSessionSlotStatusEnum.PENDING,
        },
        { status: ServiceSessionSlotStatusEnum.SKIPPED },
      );
      await manager.update(
        ServiceSession,
        { id: session.id },
        {
          status: ServiceSessionStatusEnum.COMPLETED,
          endedAt: new Date(now),
        },
      );
      // If the session ends while still paused, the open ServicePauseEntry
      // (resumedAt: null) would otherwise stay open forever — buildSessionReport
      // treats any unresolved pause as contributing zero duration, silently
      // dropping that entire pause interval from the report's total.
      await manager
        .createQueryBuilder()
        .update(ServicePauseEntry)
        .set({ resumedAt: new Date(now) })
        .where('session_id = :sid AND resumed_at IS NULL', { sid: session.id })
        .execute();
    });

    await this.programmeSvc.setProgrammeStatus(
      session.programme.id,
      ServiceProgrammeStatusEnum.COMPLETED,
    );

    if (session.programme.saveAsTemplate) {
      await this.programmeSvc.upsertTemplateFromProgramme(session.programme);
    }

    const completedAnchor: SessionAnchor = {
      ...anchor,
      status: ServiceSessionStatusEnum.COMPLETED,
    };
    this.cacheService.set(
      this.anchorKey(sessionCode),
      completedAnchor,
      SESSION_TTL_COMPLETED,
    );

    await this.logAction(
      session.id,
      memberId
        ? ServiceActionRoleEnum.WORKER
        : ServiceActionRoleEnum.PUBLIC_LINK,
      'SESSION_ENDED',
      null,
      memberId,
      actorLabel,
    );

    this.dispatchSessionReportEmail(
      sessionCode,
      session.programme.serviceSlot?.name ?? 'Service Session',
    );
    this.cacheService.flushNamespace('session:analytics');

    return this.sessionRepo.findOne({ where: { id: session.id } });
  }

  async getState(sessionCode: string): Promise<SessionStatePayload> {
    const session = await this.getSessionOrThrow(sessionCode, [
      'programme',
      'programme.slots',
      'programme.slots.member',
      'programme.slots.backupMember',
      'sessionSlots',
      'sessionSlots.programmeSlot',
      'sessionSlots.programmeSlot.member',
      'sessionSlots.programmeSlot.backupMember',
      'sessionSlots.overriddenMember',
    ]);

    let anchor = await this.cacheService.get<SessionAnchor>(
      this.anchorKey(sessionCode),
    );
    if (!anchor) {
      anchor = await this.reconstructAnchorFromDb(session);
    }

    if (session.programme?.slots) {
      session.programme.slots = withMemberNamesList(session.programme.slots);
    }

    return {
      anchor,
      session,
      effectiveSlots: session.sessionSlots
        ? withEffectiveSessionSlots(session.sessionSlots)
        : [],
      cautionThresholdRatio: this.configService.get<number>(
        'SERVICE_SLOT_CAUTION_THRESHOLD_RATIO',
        0.25,
      ),
    };
  }

  // Personalized view for a member/worker with a slot in this session — "am I
  // up now, and if not, roughly how long until I am." Builds on getState()
  // rather than re-querying, so it stays consistent with whatever the
  // presentation/audience views are showing at the same moment.
  async getMyLiveStatus(
    sessionCode: string,
    memberId: string,
  ): Promise<MyLiveSlotStatus> {
    const { session, anchor } = await this.getState(sessionCode);
    const sessionSlots = session.sessionSlots ?? [];

    const myPrimarySlot = sessionSlots.find(
      (s) =>
        s.programmeSlot.member?.id === memberId ||
        s.overriddenMember?.id === memberId,
    );
    const myBackupSlot = sessionSlots.find(
      (s) => s.programmeSlot.backupMember?.id === memberId,
    );
    const mySlot = myPrimarySlot ?? myBackupSlot;
    if (!mySlot) {
      throw new NotFoundException("You don't have a slot in this session");
    }
    const myRole: 'PRIMARY' | 'BACKUP' = myPrimarySlot ? 'PRIMARY' : 'BACKUP';

    const currentPosition = anchor.currentSlotPosition;
    const isMyTurnNow = mySlot.position === currentPosition;
    const hasPassed =
      mySlot.position < currentPosition ||
      mySlot.status === ServiceSessionSlotStatusEnum.COMPLETED;

    let estimatedSecondsUntilMyTurn: number | null = null;
    if (!isMyTurnNow && !hasPassed) {
      const currentSlot = sessionSlots.find(
        (s) => s.position === currentPosition,
      );
      if (currentSlot) {
        const currentAllocatedSeconds =
          (currentSlot.adjustedAllocatedMinutes ??
            currentSlot.programmeSlot.allocatedMinutes) * 60;
        const elapsed = this.calcElapsed(anchor, Date.now());
        const remainingCurrent = Math.max(0, currentAllocatedSeconds - elapsed);

        const between = sessionSlots.filter(
          (s) => s.position > currentPosition && s.position < mySlot.position,
        );
        const betweenSeconds = between.reduce(
          (sum, s) =>
            sum +
            (s.adjustedAllocatedMinutes ?? s.programmeSlot.allocatedMinutes) *
              60,
          0,
        );
        estimatedSecondsUntilMyTurn = remainingCurrent + betweenSeconds;
      }
    }

    return {
      sessionCode,
      sessionStatus: session.status,
      myRole,
      myPosition: mySlot.position,
      myType: mySlot.programmeSlot.type,
      myTopic: mySlot.overriddenTopic ?? mySlot.programmeSlot.topic,
      currentPosition,
      isMyTurnNow,
      hasPassed,
      estimatedSecondsUntilMyTurn,
      runningOrder: withEffectiveSessionSlots(sessionSlots),
    };
  }

  async getActiveSessions(): Promise<
    { sessionCode: string; serviceSlotName: string; startedAt: Date }[]
  > {
    const sessions = await this.sessionRepo.find({
      where: { status: ServiceSessionStatusEnum.LIVE },
      relations: [
        'programme',
        'programme.serviceSlot',
        'programme.serviceSlot.event',
      ],
      order: { startedAt: 'ASC' },
    });

    return sessions.map((session) => ({
      sessionCode: session.sessionCode,
      serviceSlotName: [
        session.programme?.serviceSlot?.event?.name,
        session.programme?.serviceSlot?.name,
      ]
        .filter(Boolean)
        .join(' — '),
      startedAt: session.startedAt,
    }));
  }

  async getSlotForSpeaker(
    sessionCode: string,
    position: number,
  ): Promise<{ slot: ServiceSessionSlot; anchor: SessionAnchor }> {
    const session = await this.getSessionOrThrow(sessionCode, [
      'sessionSlots',
      'sessionSlots.programmeSlot',
      'sessionSlots.programmeSlot.member',
      'sessionSlots.overriddenMember',
    ]);
    const slot = session.sessionSlots?.find((s) => s.position === position);
    if (!slot) throw new NotFoundException(`No slot at position ${position}`);

    let anchor = await this.cacheService.get<SessionAnchor>(
      this.anchorKey(sessionCode),
    );
    if (!anchor) {
      anchor = await this.reconstructAnchorFromDb(session);
    }
    return { slot, anchor };
  }

  async getSessionHistory(
    programmeId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginationResponseDto<ServiceSession>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');

    const [data, total] = await this.sessionRepo.findAndCount({
      where: { programme: { id: programmeId } },
      relations: ['sessionSlots'],
      order: { startedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data,
      page,
      limit,
      totalCount: total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getFormattedReport(sessionCode: string): Promise<SessionReport> {
    const session = await this.sessionRepo.findOne({
      where: { sessionCode },
      relations: [
        'programme',
        'programme.serviceSlot',
        'sessionSlots',
        'sessionSlots.programmeSlot',
        'sessionSlots.programmeSlot.member',
        'sessionSlots.overriddenMember',
        'pauseEntries',
      ],
      order: {
        sessionSlots: { position: 'ASC' },
        pauseEntries: { pausedAt: 'ASC' },
      },
    });
    if (!session) throw new NotFoundException('Session not found');
    return this.buildSessionReport(session);
  }

  async getReportPdf(sessionCode: string): Promise<Buffer> {
    const report = await this.getFormattedReport(sessionCode);
    return this.pdfService.generateSessionReport(report);
  }

  async getActionLogCsv(sessionCode: string): Promise<string> {
    const session = await this.getSessionOrThrow(sessionCode);
    const entries = await this.actionEntryRepo.find({
      where: { session: { id: session.id } },
      relations: ['performedByMember'],
      order: { createdAt: 'ASC' },
    });

    const escapeCsv = (value: string): string =>
      /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

    const header = ['Timestamp', 'Actor Role', 'Actor', 'Action', 'Detail'];
    const rows = entries.map((e) => [
      e.createdAt.toISOString(),
      e.actorRole,
      e.performedByMember
        ? `${e.performedByMember.firstname} ${e.performedByMember.lastname}`
        : (e.actorLabel ?? ''),
      e.action,
      e.detail ?? '',
    ]);

    return [header, ...rows]
      .map((row) => row.map(escapeCsv).join(','))
      .join('\n');
  }

  async getActionLog(
    sessionCode: string,
    memberId: string,
    limit = 10,
  ): Promise<
    {
      createdAt: Date;
      actorRole: ServiceActionRoleEnum;
      actorName: string | null;
      action: string;
      detail: string | null;
    }[]
  > {
    await this.assertCanControlSession(memberId);
    const session = await this.getSessionOrThrow(sessionCode);
    const entries = await this.actionEntryRepo.find({
      where: { session: { id: session.id } },
      relations: ['performedByMember'],
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return entries.map((e) => ({
      createdAt: e.createdAt,
      actorRole: e.actorRole,
      actorName: e.performedByMember
        ? `${e.performedByMember.firstname} ${e.performedByMember.lastname}`
        : e.actorLabel,
      action: e.action,
      detail: e.detail,
    }));
  }

  async getFullEventReportPdf(eventId: string): Promise<Buffer> {
    const sessions = await this.sessionRepo
      .createQueryBuilder('session')
      .innerJoinAndSelect('session.programme', 'programme')
      .innerJoinAndSelect('programme.serviceSlot', 'serviceSlot')
      .innerJoinAndSelect('serviceSlot.event', 'event')
      .leftJoinAndSelect('session.sessionSlots', 'sessionSlots')
      .leftJoinAndSelect('sessionSlots.programmeSlot', 'programmeSlot')
      .leftJoinAndSelect('programmeSlot.member', 'member')
      .leftJoinAndSelect('sessionSlots.overriddenMember', 'overriddenMember')
      .leftJoinAndSelect('session.pauseEntries', 'pauseEntries')
      .where('event.id = :eventId', { eventId })
      .orderBy('serviceSlot.startTime', 'ASC')
      .addOrderBy('sessionSlots.position', 'ASC')
      .addOrderBy('pauseEntries.pausedAt', 'ASC')
      .getMany();

    if (sessions.length === 0)
      throw new NotFoundException('No sessions found for this event');

    const incomplete = sessions.filter(
      (s) => s.status !== ServiceSessionStatusEnum.COMPLETED,
    );
    if (incomplete.length > 0) {
      throw new BadRequestException(
        `${incomplete.length} session(s) are not yet completed`,
      );
    }

    const event = sessions[0].programme.serviceSlot.event;
    const eventDate =
      event.eventDate instanceof Date
        ? event.eventDate.toISOString().slice(0, 10)
        : String(event.eventDate);

    const sessionReports = sessions.map((s) => this.buildSessionReport(s));
    const totalAllocatedMinutes = sessionReports.reduce(
      (sum, r) => sum + r.totalAllocatedMinutes,
      0,
    );
    const totalSlotVarianceMinutes = sessionReports.reduce(
      (sum, r) => sum + r.slotVarianceMinutes,
      0,
    );
    const totalDurationMinutes = sessionReports.every(
      (r) => r.totalDurationMinutes != null,
    )
      ? sessionReports.reduce(
          (sum, r) => sum + (r.totalDurationMinutes ?? 0),
          0,
        )
      : null;
    const totalPauseMinutes = Math.round(
      sessionReports.reduce((sum, r) => sum + r.totalPauseDurationSeconds, 0) /
        60,
    );
    const avgCompletionRate = Math.round(
      sessionReports.reduce((sum, r) => sum + r.completionRate, 0) /
        sessionReports.length,
    );

    const fullReport: FullEventReport = {
      eventName: event.name,
      eventDate,
      sessions: sessions.map((session, i) => ({
        serviceSlotName: session.programme.serviceSlot.name,
        slotStartTime: session.programme.serviceSlot.startTime,
        slotEndTime: session.programme.serviceSlot.endTime,
        report: sessionReports[i],
      })),
      summary: {
        sessionCount: sessions.length,
        totalAllocatedMinutes,
        totalSlotVarianceMinutes,
        totalDurationMinutes,
        totalPauseMinutes,
        avgCompletionRate,
      },
    };

    return this.pdfService.generateFullEventReport(fullReport);
  }

  async getEventSummaryReportPdf(eventId: string): Promise<Buffer> {
    const sessions = await this.sessionRepo
      .createQueryBuilder('session')
      .innerJoinAndSelect('session.programme', 'programme')
      .innerJoinAndSelect('programme.serviceSlot', 'serviceSlot')
      .innerJoinAndSelect('serviceSlot.event', 'event')
      .leftJoinAndSelect('session.sessionSlots', 'sessionSlots')
      .leftJoinAndSelect('sessionSlots.programmeSlot', 'programmeSlot')
      .leftJoinAndSelect('programmeSlot.member', 'member')
      .leftJoinAndSelect('sessionSlots.overriddenMember', 'overriddenMember')
      .leftJoinAndSelect('session.pauseEntries', 'pauseEntries')
      .where('event.id = :eventId', { eventId })
      .orderBy('serviceSlot.startTime', 'ASC')
      .addOrderBy('sessionSlots.position', 'ASC')
      .addOrderBy('pauseEntries.pausedAt', 'ASC')
      .getMany();

    if (sessions.length === 0)
      throw new NotFoundException('No sessions found for this event');

    const event = sessions[0].programme.serviceSlot.event;
    const eventDate =
      event.eventDate instanceof Date
        ? event.eventDate.toISOString().slice(0, 10)
        : String(event.eventDate);

    const sessionReports = sessions.map((s) => this.buildSessionReport(s));
    const totalAllocatedMinutes = sessionReports.reduce(
      (sum, r) => sum + r.totalAllocatedMinutes,
      0,
    );
    const totalSlotVarianceMinutes = sessionReports.reduce(
      (sum, r) => sum + r.slotVarianceMinutes,
      0,
    );
    const totalDurationMinutes = sessionReports.every(
      (r) => r.totalDurationMinutes != null,
    )
      ? sessionReports.reduce(
          (sum, r) => sum + (r.totalDurationMinutes ?? 0),
          0,
        )
      : null;
    const totalPauseMinutes = Math.round(
      sessionReports.reduce((sum, r) => sum + r.totalPauseDurationSeconds, 0) /
        60,
    );
    const avgCompletionRate = Math.round(
      sessionReports.reduce((sum, r) => sum + r.completionRate, 0) /
        sessionReports.length,
    );

    const fullReport: FullEventReport = {
      eventName: event.name,
      eventDate,
      sessions: sessions.map((session, i) => ({
        serviceSlotName: session.programme.serviceSlot.name,
        slotStartTime: session.programme.serviceSlot.startTime,
        slotEndTime: session.programme.serviceSlot.endTime,
        report: sessionReports[i],
      })),
      summary: {
        sessionCount: sessions.length,
        totalAllocatedMinutes,
        totalSlotVarianceMinutes,
        totalDurationMinutes,
        totalPauseMinutes,
        avgCompletionRate,
      },
    };

    return this.pdfService.generateEventSummaryReport(fullReport);
  }

  async getEventSummaryReportPdfForWorker(
    eventId: string,
    memberId: string,
  ): Promise<Buffer> {
    await this.assertIsAdminDeptWorker(memberId);
    return this.getEventSummaryReportPdf(eventId);
  }

  private buildSessionReport(session: ServiceSession): SessionReport {
    const slots = session.sessionSlots ?? [];
    const pauses = session.pauseEntries ?? [];

    const totalPauseMs = pauses.reduce((sum, p) => {
      return p.resumedAt
        ? sum + (p.resumedAt.getTime() - p.pausedAt.getTime())
        : sum;
    }, 0);

    const totalDurationMs =
      session.endedAt && session.startedAt
        ? session.endedAt.getTime() - session.startedAt.getTime()
        : null;

    const completedSlots = slots.filter(
      (s) => s.status === ServiceSessionSlotStatusEnum.COMPLETED,
    ).length;

    const formattedSlots: SessionSlotReport[] = slots.map((s) => {
      const allocatedMins =
        s.adjustedAllocatedMinutes ?? s.programmeSlot?.allocatedMinutes ?? 0;
      const overrunSeconds =
        s.actualSeconds == null
          ? null
          : Math.round(s.actualSeconds - allocatedMins * 60);
      const effectiveMember = s.overriddenMember ?? s.programmeSlot?.member;
      return {
        position: s.position,
        type: s.programmeSlot?.type ?? '',
        topic: s.overriddenTopic ?? s.programmeSlot?.topic ?? null,
        speakerName:
          s.overriddenSpeakerName ??
          (effectiveMember
            ? `${effectiveMember.firstname} ${effectiveMember.lastname}`
            : null),
        speakerId: effectiveMember?.id ?? null,
        allocatedMinutes: allocatedMins,
        actualSeconds: s.actualSeconds ?? null,
        overrunSeconds,
        status: s.status,
      };
    });

    const totalAllocatedMinutes = formattedSlots.reduce(
      (sum, s) => sum + s.allocatedMinutes,
      0,
    );
    const totalOverrunSeconds = formattedSlots
      .filter((s) => s.overrunSeconds != null)
      .reduce((sum, s) => sum + (s.overrunSeconds ?? 0), 0);
    const slotVarianceMinutes = Math.round(totalOverrunSeconds / 60);

    return {
      sessionCode: session.sessionCode,
      programme: {
        id: session.programme.id,
        serviceSlotName: session.programme.serviceSlot?.name ?? null,
      },
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt ?? null,
      totalDurationMinutes:
        totalDurationMs == null ? null : Math.round(totalDurationMs / 60000),
      totalPauseDurationSeconds: Math.round(totalPauseMs / 1000),
      completedSlots,
      totalSlots: slots.length,
      completionRate:
        slots.length > 0
          ? Math.round((completedSlots / slots.length) * 100)
          : 0,
      totalAllocatedMinutes,
      slotVarianceMinutes,
      slots: formattedSlots,
      pauseCount: pauses.length,
      pauses: pauses.map((p) => ({
        slotPosition: p.slotPosition,
        reason: p.reason,
        pausedAt: p.pausedAt,
        resumedAt: p.resumedAt ?? null,
        durationSeconds: p.resumedAt
          ? Math.round((p.resumedAt.getTime() - p.pausedAt.getTime()) / 1000)
          : null,
      })),
    };
  }

  async getAnalytics(
    from?: string,
    to?: string,
    serviceSlotName?: string,
    memberId?: string,
    slotType?: string,
  ): Promise<AnalyticsResult> {
    // An unbounded call (no from/to) previously scanned every COMPLETED
    // session ever recorded through a 6-way join — default to a bounded
    // lookback window instead of the full history when the caller doesn't
    // specify one. Computed here (not in fetchAnalytics) so the cache key
    // reflects the actual bounded range being queried.
    const effectiveFrom = from ?? this.defaultAnalyticsFrom();
    const key = `session:analytics:${effectiveFrom}:${to ?? 'all'}:${serviceSlotName ?? 'all'}:${memberId ?? 'all'}:${slotType ?? 'all'}`;
    return this.cacheService.getOrSet(
      key,
      () =>
        this.fetchAnalytics(
          effectiveFrom,
          to,
          serviceSlotName,
          memberId,
          slotType,
        ),
      ANALYTICS_TTL,
    );
  }

  private defaultAnalyticsFrom(): string {
    const d = new Date();
    d.setDate(d.getDate() - 180);
    return d.toISOString().slice(0, 10);
  }

  private async fetchAnalytics(
    from: string,
    to?: string,
    serviceSlotName?: string,
    memberId?: string,
    slotType?: string,
  ): Promise<AnalyticsResult> {
    const qb = this.sessionRepo
      .createQueryBuilder('session')
      .innerJoinAndSelect('session.programme', 'programme')
      .innerJoinAndSelect('programme.serviceSlot', 'serviceSlot')
      .leftJoinAndSelect('serviceSlot.event', 'event')
      .leftJoinAndSelect('session.sessionSlots', 'sessionSlots')
      .leftJoinAndSelect('sessionSlots.programmeSlot', 'programmeSlot')
      .leftJoinAndSelect('sessionSlots.overriddenMember', 'overriddenMember')
      .leftJoinAndSelect('programmeSlot.member', 'member')
      .leftJoinAndSelect('session.pauseEntries', 'pauseEntries')
      .where('session.status = :status', {
        status: ServiceSessionStatusEnum.COMPLETED,
      });

    qb.andWhere('session.startedAt >= :from', { from: new Date(from) });
    if (to) qb.andWhere('session.startedAt <= :to', { to: new Date(to) });
    if (serviceSlotName)
      // Matches either the sub-service label ("First Service") or the
      // parent event's name ("Sunday Service") — an admin searching by
      // "what they call the service" shouldn't need to know which of the
      // two levels the name actually lives on.
      qb.andWhere('(serviceSlot.name ILIKE :name OR event.name ILIKE :name)', {
        name: `%${serviceSlotName}%`,
      });
    if (memberId)
      // Session-level: only sessions this member actually appeared in
      // (as originally assigned, or as whoever stepped in on the day) —
      // "their history across services", not every service that happened
      // to run in the date range.
      qb.andWhere(
        `session.id IN (
          SELECT ss.session_id FROM service_session_slots ss
          INNER JOIN service_programme_slots ps ON ps.id = ss.programme_slot_id
          WHERE ps.member_id = :memberId OR ss.overridden_member_id = :memberId
        )`,
        { memberId },
      );
    qb.orderBy('session.startedAt', 'DESC');

    const sessions = await qb.getMany();

    type SlotTypeEntry = {
      total: number;
      completed: number;
      totalActualSecs: number;
      totalAllocatedMins: number;
      overrunCount: number;
      overrunTotal: number;
    };
    type SpeakerEntry = {
      name: string;
      slotCount: number;
      totalActualSeconds: number;
    };
    const slotTypeMap = new Map<string, SlotTypeEntry>();
    const speakerMap = new Map<string, SpeakerEntry>();

    const sessionSummaries = sessions.map((session) => {
      const slots = session.sessionSlots ?? [];
      const pauses = session.pauseEntries ?? [];

      const totalPauseMs = pauses.reduce((sum, p) => {
        return p.resumedAt
          ? sum + (p.resumedAt.getTime() - p.pausedAt.getTime())
          : sum;
      }, 0);

      let overrunSlots = 0;
      for (const slot of slots) {
        // Type/speaker breakdown tables only ever reflect the requested
        // slice — "just Offering segments", or "just this person's slots"
        // — while completionRate/duration below stay session-wide, since
        // those describe the whole service regardless of which slice of
        // it you're looking at.
        if (slotType && slot.programmeSlot?.type !== slotType) continue;
        if (memberId) {
          const slotMemberId =
            slot.overriddenMember?.id ?? slot.programmeSlot?.member?.id;
          if (slotMemberId !== memberId) continue;
        }
        if (this.accumulateSlotStats(slot, slotTypeMap, speakerMap))
          overrunSlots++;
      }

      const completedCount = slots.filter(
        (s) => s.status === ServiceSessionSlotStatusEnum.COMPLETED,
      ).length;
      const totalDurationMs =
        session.endedAt && session.startedAt
          ? session.endedAt.getTime() - session.startedAt.getTime()
          : null;

      return {
        sessionCode: session.sessionCode,
        startedAt: session.startedAt,
        totalDurationMinutes:
          totalDurationMs == null ? null : Math.round(totalDurationMs / 60000),
        completionRate:
          slots.length > 0
            ? Math.round((completedCount / slots.length) * 100)
            : 0,
        overrunSlots,
        totalPauseDurationSeconds: Math.round(totalPauseMs / 1000),
      };
    });

    const slotTypeStats: SlotTypeStats[] = Array.from(
      slotTypeMap.entries(),
    ).map(([type, s]) => ({
      type,
      totalSlots: s.total,
      completedSlots: s.completed,
      avgActualSeconds:
        s.completed > 0 ? Math.round(s.totalActualSecs / s.completed) : null,
      avgAllocatedMinutes:
        s.total > 0 ? Math.round(s.totalAllocatedMins / s.total) : 0,
      avgOverrunSeconds:
        s.overrunCount > 0 ? Math.round(s.overrunTotal / s.overrunCount) : null,
      overrunCount: s.overrunCount,
    }));

    const topSpeakers: TopSpeaker[] = Array.from(speakerMap.entries())
      .map(([memberId, s]) => ({
        memberId,
        name: s.name,
        slotCount: s.slotCount,
        totalActualSeconds: s.totalActualSeconds,
        avgActualSeconds:
          s.slotCount > 0 ? Math.round(s.totalActualSeconds / s.slotCount) : 0,
      }))
      .sort((a, b) => b.slotCount - a.slotCount)
      .slice(0, 10);

    return {
      from: from ?? null,
      to: to ?? null,
      totalSessions: sessions.length,
      slotTypeStats,
      sessions: sessionSummaries,
      topSpeakers,
    };
  }

  // A member/worker's own "what have I done, and how much time did I use"
  // view — same effective-speaker rule as the memberId scoping in
  // fetchAnalytics (override takes precedence, else the draft-assigned
  // member; a listed backup who never actually went on gets no entry here),
  // so the two stay consistent about what counts as "their" contribution.
  async getMyServiceHistory(
    memberId: string,
    page = 1,
    limit = 10,
  ): Promise<MyServiceHistoryResult> {
    const sessions = await this.sessionRepo
      .createQueryBuilder('session')
      .innerJoinAndSelect('session.programme', 'programme')
      .innerJoinAndSelect('programme.serviceSlot', 'serviceSlot')
      .leftJoinAndSelect('serviceSlot.event', 'event')
      .leftJoinAndSelect('session.sessionSlots', 'sessionSlots')
      .leftJoinAndSelect('sessionSlots.programmeSlot', 'programmeSlot')
      .leftJoinAndSelect('sessionSlots.overriddenMember', 'overriddenMember')
      .leftJoinAndSelect('programmeSlot.member', 'member')
      .where('session.status = :status', {
        status: ServiceSessionStatusEnum.COMPLETED,
      })
      .andWhere(
        `session.id IN (
          SELECT ss.session_id FROM service_session_slots ss
          INNER JOIN service_programme_slots ps ON ps.id = ss.programme_slot_id
          WHERE ps.member_id = :memberId OR ss.overridden_member_id = :memberId
        )`,
        { memberId },
      )
      .orderBy('session.startedAt', 'DESC')
      .getMany();

    const entries: MyServiceHistoryEntry[] = [];
    const bySlotTypeMap = new Map<
      string,
      { count: number; totalActualSeconds: number }
    >();

    for (const session of sessions) {
      for (const slot of session.sessionSlots ?? []) {
        const effectiveMemberId =
          slot.overriddenMember?.id ?? slot.programmeSlot?.member?.id;
        if (effectiveMemberId !== memberId) continue;

        entries.push({
          eventName: session.programme.serviceSlot.event?.name ?? null,
          serviceSlotName: session.programme.serviceSlot.name,
          sessionDate: session.startedAt,
          type: slot.programmeSlot.type,
          topic: slot.overriddenTopic ?? slot.programmeSlot.topic,
          allocatedMinutes:
            slot.adjustedAllocatedMinutes ??
            slot.programmeSlot.allocatedMinutes,
          actualSeconds: slot.actualSeconds,
        });

        const existing = bySlotTypeMap.get(slot.programmeSlot.type) ?? {
          count: 0,
          totalActualSeconds: 0,
        };
        existing.count += 1;
        existing.totalActualSeconds += slot.actualSeconds ?? 0;
        bySlotTypeMap.set(slot.programmeSlot.type, existing);
      }
    }

    const totalCount = entries.length;
    const totalActualSeconds = entries.reduce(
      (sum, e) => sum + (e.actualSeconds ?? 0),
      0,
    );
    const start = (page - 1) * limit;

    return {
      totalSlots: totalCount,
      totalActualSeconds,
      bySlotType: Array.from(bySlotTypeMap.entries()).map(([type, v]) => ({
        type,
        ...v,
      })),
      entries: entries.slice(start, start + limit),
      page,
      limit,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / limit)),
    };
  }

  // Session control (start, advance/rewind/pause/..., managing share links
  // and named PM access grants) is restricted to Admins holding
  // SERVICE_PROGRAMME_WRITE. Admin-department workers no longer get an
  // authenticated control path here — like anyone else, they use the public
  // Programme Manager link with a named PIN grant instead, so every control
  // action is attributable to a specific named person regardless of whether
  // they're staff or an external collaborator.
  private async assertCanControlSession(memberId: string): Promise<void> {
    const admin = await this.adminRepo.findOne({
      where: { member: { id: memberId }, isActive: true },
      relations: ['adminRole'],
    });
    if (
      admin?.adminRole.permissions.includes(
        AdminPermission.SERVICE_PROGRAMME_WRITE,
      )
    ) {
      return;
    }

    throw new ForbiddenException(
      'Only admins with service programme access can perform this action',
    );
  }

  // Separate from assertCanControlSession — this gates only the mobile
  // worker-facing event summary PDF download, a read-only report unrelated
  // to live-session control, so it keeps its own department-based rule
  // rather than sharing (and being narrowed by) the control-access check.
  private async assertIsAdminDeptWorker(memberId: string): Promise<void> {
    await this.departmentAccessService.assertHasCapability(
      memberId,
      DepartmentCapability.FRONT_DESK_OPERATIONS,
      'Only Front Desk Operations workers can perform this action',
    );
  }

  private async getAnchorOrThrow(sessionCode: string): Promise<SessionAnchor> {
    const anchor = await this.cacheService.get<SessionAnchor>(
      this.anchorKey(sessionCode),
    );
    if (!anchor) throw new NotFoundException('Session not found or expired');
    if (anchor.status === ServiceSessionStatusEnum.COMPLETED) {
      throw new BadRequestException('Session has already ended');
    }
    return anchor;
  }

  private async getSessionOrThrow(
    sessionCode: string,
    relations: string[] = [],
  ): Promise<ServiceSession> {
    const session = await this.sessionRepo.findOne({
      where: { sessionCode },
      relations,
    });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  private async reconstructAnchorFromDb(
    session: ServiceSession,
  ): Promise<SessionAnchor> {
    const inProgress = session.sessionSlots?.find(
      (s) => s.status === ServiceSessionSlotStatusEnum.IN_PROGRESS,
    );
    const position = inProgress?.position ?? 0;
    const startedAt = inProgress?.startedAt?.getTime() ?? Date.now();

    return {
      currentSlotPosition: position,
      slotStartedAt: startedAt,
      slotBaseSeconds: 0,
      status: session.status,
      isPaused: false,
      pausedAt: null,
    };
  }

  private calcElapsed(anchor: SessionAnchor, nowMs: number): number {
    const base =
      anchor.isPaused && anchor.pausedAt
        ? anchor.slotBaseSeconds +
          (anchor.pausedAt - anchor.slotStartedAt) / 1000
        : anchor.slotBaseSeconds + (nowMs - anchor.slotStartedAt) / 1000;
    return Math.max(0, base);
  }

  private anchorKey(sessionCode: string): string {
    return this.cacheService.key('session', sessionCode, 'anchor');
  }

  private shareKey(sessionCode: string): string {
    return this.cacheService.key('session', sessionCode, 'share');
  }

  private grantKey(sessionCode: string, grantToken: string): string {
    return this.cacheService.key('session-grant', sessionCode, grantToken);
  }

  private generateSessionCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const suffix = Array.from(
      { length: 6 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join('');
    return `SVC-${suffix}`;
  }

  private async logAction(
    sessionId: string,
    role: ServiceActionRoleEnum,
    action: string,
    detail: string | null,
    memberId: string | null,
    actorLabel: string | null = null,
  ): Promise<void> {
    const member = memberId
      ? await this.memberRepo.findOne({ where: { id: memberId } })
      : null;
    const entry = this.actionEntryRepo.create({
      session: { id: sessionId } as ServiceSession,
      actorRole: role,
      action,
      detail,
      performedByMember: member,
      actorLabel,
    });
    await this.actionEntryRepo.save(entry);
  }

  private accumulateSlotStats(
    slot: ServiceSessionSlot,
    slotTypeMap: Map<
      string,
      {
        total: number;
        completed: number;
        totalActualSecs: number;
        totalAllocatedMins: number;
        overrunCount: number;
        overrunTotal: number;
      }
    >,
    speakerMap: Map<
      string,
      { name: string; slotCount: number; totalActualSeconds: number }
    >,
  ): boolean {
    const type = slot.programmeSlot?.type ?? 'UNKNOWN';
    let ts = slotTypeMap.get(type);
    if (!ts) {
      ts = {
        total: 0,
        completed: 0,
        totalActualSecs: 0,
        totalAllocatedMins: 0,
        overrunCount: 0,
        overrunTotal: 0,
      };
      slotTypeMap.set(type, ts);
    }
    ts.total++;
    const allocatedMins =
      slot.adjustedAllocatedMinutes ??
      slot.programmeSlot?.allocatedMinutes ??
      0;
    ts.totalAllocatedMins += allocatedMins;

    if (
      slot.status !== ServiceSessionSlotStatusEnum.COMPLETED ||
      slot.actualSeconds == null
    ) {
      return false;
    }

    ts.completed++;
    ts.totalActualSecs += slot.actualSeconds;
    const overrun = slot.actualSeconds - allocatedMins * 60;
    let isOverrun = false;
    if (overrun > 0) {
      ts.overrunCount++;
      ts.overrunTotal += overrun;
      isOverrun = true;
    }

    if (type === 'SPEAKER') {
      const speakerId =
        slot.overriddenMember?.id ?? slot.programmeSlot?.member?.id;
      if (speakerId) {
        const m = slot.overriddenMember ?? slot.programmeSlot?.member;
        const name = m ? `${m.firstname} ${m.lastname}` : 'Unknown';
        let sp = speakerMap.get(speakerId);
        if (!sp) {
          sp = { name, slotCount: 0, totalActualSeconds: 0 };
          speakerMap.set(speakerId, sp);
        }
        sp.slotCount++;
        sp.totalActualSeconds += slot.actualSeconds;
      }
    }

    return isOverrun;
  }

  private dispatchSessionReportEmail(
    sessionCode: string,
    serviceName: string,
  ): void {
    Promise.all([
      this.findAdminWorkerEmails(),
      this.getFormattedReport(sessionCode).then((r) =>
        this.pdfService.generateSessionReport(r),
      ),
    ])
      .then(([emails, pdfBuffer]) => {
        if (emails.length === 0) return;
        const date = new Date().toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        });
        this.emailQueueService.queueEmailWithTemplateAndAttachments(
          emails,
          `Session Report: ${serviceName}`,
          'service-session-report',
          { sessionCode, serviceName, date },
          [
            {
              filename: `session-report-${sessionCode}.pdf`,
              content: pdfBuffer,
            },
          ],
          undefined,
          EmailCategory.SESSION_REPORT,
        );
      })
      .catch((err) =>
        this.logger.error(
          'Failed to dispatch session report email',
          err?.stack,
        ),
      );
  }

  private async findAdminWorkerEmails(): Promise<string[]> {
    const workers = await this.workerProfileRepo
      .createQueryBuilder('wp')
      .innerJoinAndSelect('wp.member', 'member')
      .leftJoin('wp.department', 'dept')
      .leftJoin('wp.secondaryDepartment', 'secDept')
      .where('wp.status = :status', { status: WorkerStatusEnum.ACTIVE })
      .andWhere(
        '(:capability = ANY(dept.capabilities) OR :capability = ANY(secDept.capabilities))',
        { capability: DepartmentCapability.FRONT_DESK_OPERATIONS },
      )
      .getMany();
    return workers
      .map((w) => w.member?.email)
      .filter((e): e is string => e != null && e !== '');
  }
}
