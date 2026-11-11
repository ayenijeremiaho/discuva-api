import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { In, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';
import { Admin } from '../../admin/entity/admin.entity';
import { Member } from '../../member/entity/member.entity';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { MemberService } from '../../member/service/member.service';
import { Event } from '../../event/entity/event.entity';
import { EventSeries } from '../../event/entity/event-series.entity';
import { EventService } from '../../event/service/event.service';
import { EventSeriesService } from '../../event/service/event-series.service';
import { AnnouncementService } from '../../announcement/service/announcement.service';
import { FollowUpService } from '../../follow-up/service/follow-up.service';
import { FirstTimerSourceEnum } from '../../follow-up/enums/follow-up.enum';
import { CheckoutService } from '../../billing/service/checkout.service';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import {
  NETWORK_COPY_QUEUE,
  NetworkCopyJob,
} from '../../network-share/network-share.constants';
import { NetworkShareService } from '../../network-share/network-share.service';
import {
  BranchClosure,
  BranchClosureStatus,
  ClosureSummary,
} from '../entity/branch-closure.entity';
import { NetworkService } from './network.service';
import { NetworkSettingsService } from './network-settings.service';
import { NetworkTransferService } from './network-transfer.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS_AHEAD = 366;

type Church = Pick<
  Tenant,
  | 'id'
  | 'schemaName'
  | 'networkRootId'
  | 'timezone'
  | 'isActive'
  | 'parentTenantId'
>;

export interface ClosureView {
  id: string;
  tenantId: string;
  path: string;
  destinationTenantId: string;
  destinationPath: string;
  closesOn: string;
  status: BranchClosureStatus;
  summary: ClosureSummary | null;
  createdAt: Date;
}

const dateLabel = (isoDate: string) =>
  new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

// Closing a branch (Phase 4, decision 12): set by owners of a church above it, run once on the date by a delayed job.
@Injectable()
export class NetworkClosureService {
  private readonly logger = new Logger(NetworkClosureService.name);

  constructor(
    @InjectRepository(BranchClosure)
    private readonly closureRepo: Repository<BranchClosure>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    @InjectRepository(Admin)
    private readonly adminRepo: Repository<Admin>,
    @InjectRepository(Event)
    private readonly eventRepo: Repository<Event>,
    @InjectRepository(EventSeries)
    private readonly seriesRepo: Repository<EventSeries>,
    @InjectQueue(NETWORK_COPY_QUEUE)
    private readonly queue: Queue<NetworkCopyJob>,
    private readonly network: NetworkService,
    private readonly settings: NetworkSettingsService,
    private readonly transfers: NetworkTransferService,
    private readonly members: MemberService,
    private readonly events: EventService,
    private readonly series: EventSeriesService,
    private readonly announcements: AnnouncementService,
    private readonly followUp: FollowUpService,
    private readonly checkout: CheckoutService,
    private readonly share: NetworkShareService,
    private readonly utility: UtilityService,
    private readonly auditLog: AuditLogService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async schedule(
    admin: Admin,
    actorMemberId: string,
    dto: { tenantId: string; destinationTenantId: string; closesOn: string },
  ): Promise<ClosureView> {
    const here = await this.here(admin);
    const tree = await this.network.loadTree(here.networkRootId!);
    const under = this.network.subtreeIds(tree, here.id);
    const target = tree.byId.get(dto.tenantId);
    if (
      dto.tenantId === here.id ||
      !under.includes(dto.tenantId) ||
      !target?.isActive
    ) {
      throw new NotFoundException(
        'You can close only an open branch under your church.',
      );
    }
    if (
      (tree.children.get(dto.tenantId) ?? []).some(
        (id) => tree.byId.get(id)?.isActive,
      )
    ) {
      throw new BadRequestException(
        'Move or close the branches under it first.',
      );
    }
    const destination = tree.byId.get(dto.destinationTenantId);
    if (!destination?.isActive || dto.destinationTenantId === dto.tenantId) {
      throw new BadRequestException(
        'Choose an open branch in your network for its members to move to.',
      );
    }
    const church = await this.church(dto.tenantId);
    const rules = await this.settings.get(here.networkRootId!);
    const days = this.daysAhead(dto.closesOn, church.timezone || 'UTC');
    if (days < rules.closureNoticeDays) {
      throw new BadRequestException(
        `Choose a date at least ${rules.closureNoticeDays} days ahead, so members have time to choose.`,
      );
    }
    if (days > MAX_DAYS_AHEAD)
      throw new BadRequestException('Choose a date within the next year.');
    if (
      await this.closureRepo.exists({
        where: {
          tenantId: dto.tenantId,
          status: In([
            BranchClosureStatus.SCHEDULED,
            BranchClosureStatus.RUNNING,
          ]),
        },
      })
    ) {
      throw new ConflictException('This branch already has a closing date.');
    }

    const [{ run_at: runAt }] = await this.closureRepo.query(
      `SELECT (($1::date + time '00:05') AT TIME ZONE $2) AS run_at`,
      [dto.closesOn, church.timezone || 'UTC'],
    );
    const closure = await this.closureRepo.save(
      this.closureRepo.create({
        tenantId: dto.tenantId,
        networkRootId: here.networkRootId!,
        destinationTenantId: dto.destinationTenantId,
        closesOn: dto.closesOn,
        runAt,
        status: BranchClosureStatus.SCHEDULED,
        requestedByTenantId: here.id,
        requestedByMemberId: actorMemberId || null,
      }),
    );
    await this.queue.add(
      { kind: 'closure', sourceTenantId: dto.tenantId, sourceId: closure.id },
      {
        jobId: `closure:${closure.id}`,
        delay: Math.max(0, new Date(runAt).getTime() - Date.now()),
        attempts: 2,
        removeOnComplete: true,
      },
    );
    const paths = await this.network.pathsOf(here.networkRootId!, [
      dto.tenantId,
      dto.destinationTenantId,
    ]);
    await this.tellMembers(
      church,
      paths.get(dto.tenantId) ?? '',
      paths.get(dto.destinationTenantId) ?? '',
      dto.closesOn,
    );
    this.auditLog.log('BRANCH_CLOSURE_SCHEDULED', {
      actorId: actorMemberId,
      targetId: dto.tenantId,
      metadata: {
        closesOn: dto.closesOn,
        destination: dto.destinationTenantId,
      },
    });
    return this.toView(closure, paths);
  }

  async cancel(
    admin: Admin,
    actorMemberId: string,
    closureId: string,
  ): Promise<void> {
    const here = await this.here(admin);
    const closure = await this.closureRepo.findOne({
      where: { id: closureId, status: BranchClosureStatus.SCHEDULED },
    });
    const tree = closure
      ? await this.network.loadTree(here.networkRootId!)
      : null;
    if (
      !closure ||
      !tree ||
      closure.tenantId === here.id ||
      !this.network.subtreeIds(tree, here.id).includes(closure.tenantId)
    ) {
      throw new NotFoundException('No closing date to cancel there.');
    }
    closure.status = BranchClosureStatus.CANCELLED;
    closure.finishedAt = new Date();
    await this.closureRepo.save(closure);
    await (await this.queue.getJob(`closure:${closure.id}`))?.remove();
    const church = await this.church(closure.tenantId);
    const path =
      (await this.network.pathsOf(here.networkRootId!, [closure.tenantId])).get(
        closure.tenantId,
      ) ?? '';
    const label = path.split(' · ').at(-1) ?? path;
    await this.inChurch(church, () =>
      this.announcements.createSystemAnnouncement(
        `${label} is staying open`,
        `<p>${label} is no longer closing. Nothing changes for you.</p>`,
        actorMemberId,
      ),
    );
    this.auditLog.log('BRANCH_CLOSURE_CANCELLED', {
      actorId: actorMemberId,
      targetId: closure.tenantId,
    });
  }

  // Scheduled and recent closings for churches under the current one, newest first.
  async listHere(): Promise<ClosureView[]> {
    const here = await this.tenantRepo.findOne({
      where: { id: this.cls.get('tenantId') },
      select: { id: true, networkRootId: true },
    });
    if (!here?.networkRootId) return [];
    const tree = await this.network.loadTree(here.networkRootId);
    const under = this.network
      .subtreeIds(tree, here.id)
      .filter((id) => id !== here.id);
    if (!under.length) return [];
    const rows = await this.closureRepo.find({
      where: { networkRootId: here.networkRootId, tenantId: In(under) },
      order: { createdAt: 'DESC' },
      take: 20,
    });
    const paths = await this.network.pathsOf(
      here.networkRootId,
      rows.flatMap((r) => [r.tenantId, r.destinationTenantId]),
    );
    return rows.map((r) => this.toView(r, paths));
  }

  // Nightly safety net: anything past its time that never ran (say, the queue lost the job) runs now.
  async queueOverdue(): Promise<number> {
    const due = await this.closureRepo.find({
      where: {
        status: BranchClosureStatus.SCHEDULED,
        runAt: LessThanOrEqual(new Date()),
      },
      select: { id: true, tenantId: true },
    });
    for (const c of due) {
      await this.queue.add(
        { kind: 'closure', sourceTenantId: c.tenantId, sourceId: c.id },
        { jobId: `closure:${c.id}`, attempts: 2, removeOnComplete: true },
      );
    }
    return due.length;
  }

  // The day itself. Each member moves in their own transaction, so one failure doesn't hold up the rest.
  async run(closureId: string): Promise<void> {
    const closure = await this.closureRepo.findOne({
      where: { id: closureId },
    });
    if (
      !closure ||
      ![BranchClosureStatus.SCHEDULED, BranchClosureStatus.RUNNING].includes(
        closure.status,
      )
    )
      return;
    const [closing, destination] = await Promise.all([
      this.church(closure.tenantId),
      this.church(closure.destinationTenantId),
    ]);
    if (
      !destination.isActive ||
      destination.networkRootId !== closure.networkRootId
    ) {
      closure.status = BranchClosureStatus.FAILED;
      closure.finishedAt = new Date();
      await this.closureRepo.save(closure);
      this.logger.error(
        `Closure ${closure.id}: destination ${destination.id} is no longer open`,
      );
      return;
    }
    closure.status = BranchClosureStatus.RUNNING;
    await this.closureRepo.save(closure);
    const started = Date.now();
    const rules = await this.settings.get(closure.networkRootId);
    const paths = await this.network.pathsOf(closure.networkRootId, [
      closing.id,
      destination.id,
    ]);
    const fromPath = paths.get(closing.id) ?? '';
    const toPath = paths.get(destination.id) ?? '';

    const { people, served, firstTimers, inactive } = await this.inChurch(
      closing,
      () => this.gather(rules.firstTimerHandoverDays),
    );
    const summary: ClosureSummary = {
      moved: 0,
      copied: 0,
      alreadyThere: 0,
      stayedInactive: inactive,
      firstTimers: 0,
      eventsCancelled: 0,
      seriesStopped: 0,
      failed: 0,
    };

    for (const person of people) {
      try {
        if (person.discuvaAccountId) {
          await this.inChurch(closing, () =>
            this.transfers.moveForClosure(
              person.id,
              person.discuvaAccountId!,
              closing.id,
              destination.id,
              closure.networkRootId,
            ),
          );
          summary.moved++;
        } else {
          const from = await this.inChurch(closing, () =>
            this.members.getById(person.id),
          );
          const joinedOn = from.dateJoinedChurch ?? from.createdAt;
          const copy = await this.inChurch(destination, () =>
            this.members.createFromClosure(from, joinedOn),
          );
          await this.inChurch(closing, () =>
            this.members.markTransferred(person.id, destination.id),
          );
          if (copy) summary.copied++;
          else summary.alreadyThere++;
        }
      } catch (err) {
        summary.failed++;
        this.logger.warn(
          `Closure ${closure.id}: moving ${person.id} failed: ${(err as Error).message}`,
        );
      }
    }

    summary.firstTimers = await this.inChurch(destination, () =>
      this.handOver(firstTimers, fromPath),
    );
    const cancelled = await this.inChurch(closing, () => this.cancelUpcoming());
    summary.eventsCancelled = cancelled.events;
    summary.seriesStopped = cancelled.series;
    await this.inChurch(closing, () =>
      this.checkout.stopForClosure(closing.id),
    );

    await this.tenantRepo.update(closing.id, {
      isActive: false,
      closedAt: new Date(),
    });
    this.network.forgetPublicNetwork(closure.networkRootId);
    await this.share.queueEventsCopy(closing.id);

    const report = {
      branch: fromPath,
      to_church: toPath,
      moved: String(summary.moved + summary.copied + summary.alreadyThere),
      first_timers: String(summary.firstTimers),
      served,
    };
    await this.inChurch(destination, () =>
      this.emailAdmins(
        'network-branch-closed',
        `${fromPath} Has Closed`,
        report,
        false,
      ),
    );
    if (closure.requestedByTenantId !== destination.id) {
      const requester = await this.church(closure.requestedByTenantId);
      await this.inChurch(requester, () =>
        this.emailAdmins(
          'network-branch-closed',
          `${fromPath} Has Closed`,
          report,
          true,
        ),
      );
    }

    closure.status = BranchClosureStatus.DONE;
    closure.summary = summary;
    closure.finishedAt = new Date();
    await this.closureRepo.save(closure);
    await this.inChurch(closing, async () =>
      this.auditLog.log('BRANCH_CLOSED', {
        targetId: closing.id,
        metadata: { ...summary },
      }),
    );
    this.logger.log(
      `Closure ${closure.id} done in ${Date.now() - started} ms: ${JSON.stringify(summary)}`,
    );
  }

  // Inside the closing branch: who moves, who served where, and recent first-timers to hand over.
  private async gather(handoverDays: number) {
    const people = await this.memberRepo.find({
      where: {
        status: In([MemberStatusEnum.ACTIVE, MemberStatusEnum.PENDING]),
      },
      select: { id: true, discuvaAccountId: true },
    });
    const inactive = await this.memberRepo.count({
      where: { status: MemberStatusEnum.INACTIVE },
    });
    const served: { name: string; teams: string }[] =
      await this.txHost.tx.query(
        `SELECT m.firstname || ' ' || m.lastname AS name,
              concat_ws(', ', d1.name, d2.name) AS teams
         FROM members m
         JOIN worker_profiles wp ON wp.member_id = m.id
         LEFT JOIN departments d1 ON d1.id = wp.department_id
         LEFT JOIN departments d2 ON d2.id = wp.secondary_department_id
        WHERE m.role = 'WORKER' AND m.status IN ('ACTIVE', 'PENDING')
        ORDER BY m.firstname, m.lastname`,
      );
    const firstTimers: {
      firstname: string;
      lastname: string;
      phone: string;
      email: string | null;
      source: FirstTimerSourceEnum;
      wantsToJoinChurch: boolean;
      wantsToJoinWorkforce: boolean;
      enjoyedAboutChurch: string | null;
      notes: string | null;
      visitedOn: string;
    }[] =
      handoverDays > 0
        ? await this.txHost.tx.query(
            `SELECT firstname, lastname, phone, email, source,
                  wants_to_join_church AS "wantsToJoinChurch", wants_to_join_workforce AS "wantsToJoinWorkforce",
                  enjoyed_about_church AS "enjoyedAboutChurch", notes, to_char(visited_on, 'YYYY-MM-DD') AS "visitedOn"
             FROM first_timers
            WHERE visited_on >= CURRENT_DATE - $1::int AND converted_at IS NULL
            ORDER BY visited_on`,
            [handoverDays],
          )
        : [];
    return { people, served, firstTimers, inactive };
  }

  // Inside the destination: each first-timer gets a follow-up task as usual. A rerun skips ones already here.
  private async handOver(
    list: Awaited<ReturnType<NetworkClosureService['gather']>>['firstTimers'],
    fromPath: string,
  ): Promise<number> {
    let count = 0;
    for (const ft of list) {
      const [{ exists }] = await this.txHost.tx.query(
        `SELECT EXISTS (SELECT 1 FROM first_timers WHERE phone = $1 AND visited_on = $2) AS exists`,
        [ft.phone, ft.visitedOn],
      );
      if (exists) continue;
      await this.followUp.createFirstTimerFromHandover({
        firstname: ft.firstname,
        lastname: ft.lastname,
        phone: ft.phone,
        email: ft.email ?? undefined,
        source: ft.source,
        wantsToJoinChurch: ft.wantsToJoinChurch,
        wantsToJoinWorkforce: ft.wantsToJoinWorkforce,
        enjoyedAboutChurch: ft.enjoyedAboutChurch ?? undefined,
        notes: [`Handed over from ${fromPath} when it closed.`, ft.notes]
          .filter(Boolean)
          .join('\n'),
        visitedOn: ft.visitedOn,
      } as never);
      count++;
    }
    return count;
  }

  // Inside the closing branch: repeating series stop, and upcoming one-off services without history go.
  // No actor: the person who closed the branch belongs to another church's records.
  private async cancelUpcoming(): Promise<{ events: number; series: number }> {
    const today = new Date().toISOString().slice(0, 10);
    const active = await this.seriesRepo.find({
      where: { isActive: true },
      select: { id: true },
    });
    let events = 0;
    for (const s of active)
      events += (await this.series.stop(s.id, today, '')).removed;
    const upcoming = await this.eventRepo.find({
      where: { startTime: MoreThan(new Date()), attendanceMarked: false },
      select: { id: true },
    });
    for (const e of upcoming) {
      try {
        await this.events.deleteEvent(e.id, '');
        events++;
      } catch {
        // Has history: it stays, read-only, with the rest of the branch's records.
      }
    }
    return { events, series: active.length };
  }

  // Inside the closing branch: an announcement (with its push) for everyone, and an email to each member.
  private async tellMembers(
    church: Church,
    branch: string,
    toPath: string,
    closesOn: string,
  ): Promise<void> {
    const label = branch.split(' · ').at(-1) ?? branch;
    const date = dateLabel(closesOn);
    await this.inChurch(church, async () => {
      await this.announcements.createSystemAnnouncement(
        `${label} is closing on ${date}`,
        `<p>${label} will close on ${date}. On that day you move to ${toPath}, with your profile, milestones and the date you first joined.</p><p>Prefer another branch? Go to My Account, then Move to another branch, before the date.</p>`,
      );
      const people = await this.memberRepo.find({
        where: {
          status: In([MemberStatusEnum.ACTIVE, MemberStatusEnum.PENDING]),
        },
        select: { id: true, email: true, firstname: true },
      });
      for (const p of people) {
        const name = UtilityService.capitalizeFirstLetter(p.firstname);
        this.utility.sendEmailWithTemplate(
          p.email,
          `${name}, ${label} Is Closing on ${date}`,
          'network-branch-closing',
          {
            name,
            branch,
            closes_on: date,
            to_church: toPath,
          },
        );
      }
    });
  }

  private async emailAdmins(
    template: string,
    subject: string,
    data: Record<string, unknown>,
    ownersOnly: boolean,
  ): Promise<void> {
    const admins = await this.adminRepo
      .createQueryBuilder('a')
      .innerJoin('a.member', 'm')
      .leftJoin('a.adminRole', 'role')
      .select(['a.id', 'a.isOwner', 'm.email', 'role.permissions'])
      .where('a.isActive = true')
      .getMany();
    const emails = admins
      .filter(
        (a) =>
          a.isOwner ||
          (!ownersOnly &&
            a.adminRole?.permissions?.includes('members:write' as never)),
      )
      .map((a) => a.member.email);
    for (const email of new Set(emails))
      this.utility.sendEmailWithTemplate(email, subject, template, data);
  }

  private daysAhead(closesOn: string, timeZone: string): number {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(closesOn))
      throw new BadRequestException('Choose a closing date.');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(
      new Date(),
    );
    return Math.round(
      (Date.parse(`${closesOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
        DAY_MS,
    );
  }

  private async here(admin: Admin): Promise<Tenant> {
    if (!(await this.network.isAvailable()))
      throw new NotFoundException('Church networks are not available yet.');
    if (!admin.isOwner)
      throw new ForbiddenException('Only owners can close a branch.');
    const here = await this.tenantRepo.findOne({
      where: { id: this.cls.get('tenantId') },
      select: { id: true, networkRootId: true },
    });
    if (!here?.networkRootId)
      throw new NotFoundException('Your church is not part of a network.');
    return here;
  }

  private async church(id: string): Promise<Church> {
    const church = await this.tenantRepo.findOne({
      where: { id },
      select: {
        id: true,
        schemaName: true,
        networkRootId: true,
        timezone: true,
        isActive: true,
        parentTenantId: true,
      },
    });
    if (!church) throw new NotFoundException('Church not found.');
    return church;
  }

  private toView(c: BranchClosure, paths: Map<string, string>): ClosureView {
    return {
      id: c.id,
      tenantId: c.tenantId,
      path: paths.get(c.tenantId) ?? '',
      destinationTenantId: c.destinationTenantId,
      destinationPath: paths.get(c.destinationTenantId) ?? '',
      closesOn: c.closesOn,
      status: c.status,
      summary: c.summary,
      createdAt: c.createdAt,
    };
  }

  private inChurch<T>(
    church: Pick<Tenant, 'id' | 'schemaName'>,
    fn: () => Promise<T>,
  ): Promise<T> {
    return runInTenantContext(
      this.cls,
      this.txHost,
      { tenantId: church.id, schemaName: church.schemaName },
      fn,
    );
  }
}
