import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Admin } from '../admin/entity/admin.entity';
import { AdminPermission } from '../admin/enum/admin-permission.enum';
import { Member } from '../member/entity/member.entity';
import { NotificationDispatchService } from '../utility/service/notification-dispatch.service';
import { EmailCategory } from '../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../notification-catalogue/push-catalogue';
import { CampusAdmin } from './campus.entity';

export interface CampusMoveNotice {
  requestId: string;
  memberId: string;
  fromCampus: { id: string; name: string } | null;
  toCampus: { id: string; name: string };
}

interface Person {
  memberId: string;
  email: string;
}

// Lookups run inside the request; sending never blocks or fails it.
@Injectable()
export class CampusNotifier {
  private readonly logger = new Logger(CampusNotifier.name);

  constructor(
    @InjectRepository(Admin)
    private readonly adminRepo: Repository<Admin>,
    @InjectRepository(CampusAdmin)
    private readonly campusAdminRepo: Repository<CampusAdmin>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    private readonly notifications: NotificationDispatchService,
  ) {}

  async moveRequested(notice: CampusMoveNotice): Promise<void> {
    await this.safely('request', async () => {
      const [worker, approvers, leads] = await Promise.all([
        this.member(notice.memberId),
        this.adminsFor(notice.fromCampus?.id ?? null),
        this.leadMemberIds(notice.memberId),
      ]);
      if (!worker) return;
      const vars = this.vars(notice, worker);
      const others = approvers.filter((a) => a.memberId !== worker.id);
      if (others.length) {
        this.send({
          email: {
            to: others.map((a) => a.email),
            subject: `${vars.workerName} asked to move campus`,
            template: 'campus-move-requested',
            data: vars,
          },
        });
      }
      if (leads.length) {
        this.send({
          push: {
            memberIds: leads,
            key: PushNotificationKey.CAMPUS_MOVE_REQUESTED,
            vars: this.pushVars(vars),
            idempotencyKey: `campus-move-requested:${notice.requestId}`,
          },
        });
      }
    });
  }

  async moveDecided(
    notice: CampusMoveNotice,
    approved: boolean,
  ): Promise<void> {
    await this.safely('decision', async () => {
      const worker = await this.member(notice.memberId);
      if (!worker) return;
      const vars = this.vars(notice, worker);
      this.send({
        email: {
          to: worker.email,
          subject: approved
            ? `You're now at ${notice.toCampus.name}`
            : 'Your campus move was declined',
          template: 'campus-move-decided',
          data: { ...vars, decision: approved ? 'approved' : 'declined' },
          recipientMemberId: worker.id,
        },
        push: {
          memberIds: [worker.id],
          key: approved
            ? PushNotificationKey.CAMPUS_MOVE_APPROVED
            : PushNotificationKey.CAMPUS_MOVE_DECLINED,
          vars: this.pushVars(vars),
          idempotencyKey: `campus-move-decided:${notice.requestId}`,
        },
      });
      if (!approved) return;

      const [newAdmins, leads] = await Promise.all([
        this.adminsFor(notice.toCampus.id, true),
        this.leadMemberIds(notice.memberId),
      ]);
      if (newAdmins.length) {
        this.send({
          email: {
            to: newAdmins.map((a) => a.email),
            subject: `${vars.workerName} is joining ${notice.toCampus.name}`,
            template: 'campus-worker-joining',
            data: vars,
          },
        });
      }
      if (leads.length) {
        this.send({
          push: {
            memberIds: leads,
            key: PushNotificationKey.CAMPUS_WORKER_MOVED,
            vars: this.pushVars(vars),
            idempotencyKey: `campus-worker-moved:${notice.requestId}`,
          },
        });
      }
    });
  }

  // The campus's own admins who manage members, else the church-wide ones, else the owners
  // (who can always decide). `ownOnly` stops at the campus, for telling it about a newcomer.
  async adminsFor(campusId: string | null, ownOnly = false): Promise<Person[]> {
    const [admins, links] = await Promise.all([
      this.adminRepo.find({
        where: { isActive: true },
        relations: { member: true, adminRole: true },
        select: {
          id: true,
          isOwner: true,
          member: { id: true, email: true },
          adminRole: { id: true, permissions: true },
        },
      }),
      this.campusAdminRepo.find({ select: { campusId: true, adminId: true } }),
    ]);
    const reachable = admins.filter((a) => a.member?.email);
    const manages = reachable.filter((a) =>
      a.adminRole?.permissions?.includes(AdminPermission.MEMBERS_WRITE),
    );
    const scoped = new Set(links.map((l) => l.adminId));
    const own = new Set(
      links.filter((l) => l.campusId === campusId).map((l) => l.adminId),
    );
    let chosen = manages.filter((a) => own.has(a.id));
    if (!chosen.length && !ownOnly) {
      chosen = manages.filter((a) => !scoped.has(a.id));
      if (!chosen.length) chosen = reachable.filter((a) => a.isOwner);
    }
    return chosen.map((a) => ({
      memberId: a.member.id,
      email: a.member.email,
    }));
  }

  // Heads and deputies of the worker's departments, not counting the worker.
  async leadMemberIds(workerMemberId: string): Promise<string[]> {
    const rows: { memberId: string }[] = await this.memberRepo.query(
      `SELECT DISTINCT lead.member_id AS "memberId"
         FROM worker_profiles wp
         JOIN department_leads dl
           ON dl.department_id IN (wp.department_id, wp.secondary_department_id)
         JOIN worker_profiles lead ON lead.id = dl.worker_profile_id
        WHERE wp.member_id = $1 AND lead.member_id <> $1`,
      [workerMemberId],
    );
    return rows.map((r) => r.memberId);
  }

  private member(id: string) {
    return this.memberRepo.findOne({
      select: { id: true, firstname: true, lastname: true, email: true },
      where: { id },
    });
  }

  private vars(notice: CampusMoveNotice, worker: Member) {
    return {
      workerName: `${worker.firstname} ${worker.lastname}`,
      name: worker.firstname,
      fromCampus: notice.fromCampus?.name ?? 'no campus',
      toCampus: notice.toCampus.name,
    };
  }

  private pushVars(vars: ReturnType<CampusNotifier['vars']>) {
    return {
      worker_name: vars.workerName,
      from_campus: vars.fromCampus,
      to_campus: vars.toCampus,
    };
  }

  private send(
    opts: Omit<
      Parameters<NotificationDispatchService['notifyMember']>[0],
      'category'
    >,
  ) {
    this.notifications
      .notifyMember({ category: EmailCategory.CAMPUSES, ...opts })
      .catch((err: Error) =>
        this.logger.warn(`Campus notification failed: ${err.message}`),
      );
  }

  private async safely(what: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err) {
      this.logger.warn(
        `Campus move ${what} notice skipped: ${(err as Error).message}`,
      );
    }
  }
}
