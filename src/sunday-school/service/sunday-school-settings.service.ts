import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';
import { SundaySchoolMember } from '../entity/sunday-school-member.entity';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

type Flag =
  | 'oneClassPerMember'
  | 'teachersCanAddMembers'
  | 'teachersCanCheckInFirstTimers';

const FLAGS: Record<
  Flag,
  { storageKey: string; cacheKey: string; default: boolean }
> = {
  oneClassPerMember: {
    storageKey: 'sunday_school:one_class_per_member',
    cacheKey: 'sunday-school-settings:one-class-per-member',
    default: false,
  },
  teachersCanAddMembers: {
    storageKey: 'sunday_school:teachers_can_add_members',
    cacheKey: 'sunday-school-settings:teachers-can-add-members',
    default: true,
  },
  teachersCanCheckInFirstTimers: {
    storageKey: 'sunday_school:teachers_can_check_in_first_timers',
    cacheKey: 'sunday-school-settings:teachers-can-check-in-first-timers',
    default: true,
  },
};
const CACHE_TTL = 300;

export interface TeacherPermissions {
  // Off = only admins add members to classes (admin portal); teachers can't from the member app.
  teachersCanAddMembers: boolean;
  // Off = only admins check in first-timers at a session.
  teachersCanCheckInFirstTimers: boolean;
}

export interface SundaySchoolSettings extends TeacherPermissions {
  // When on, a member can only be in one class; off (default) allows several.
  oneClassPerMember: boolean;
  // Members currently in more than one class — not changed when the setting is turned on.
  membersInSeveralClasses: number;
}

@Injectable()
export class SundaySchoolSettingsService {
  constructor(
    @InjectRepository(ChurchSetting)
    private readonly settingRepo: Repository<ChurchSetting>,
    @InjectRepository(SundaySchoolMember)
    private readonly memberAssignRepo: Repository<SundaySchoolMember>,
    private readonly cacheService: CacheService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private async flag(name: Flag): Promise<boolean> {
    const { storageKey, cacheKey, default: fallback } = FLAGS[name];
    const cached = await this.cacheService.get<boolean>(cacheKey);
    if (cached !== undefined) return cached;
    const row = await this.settingRepo.findOne({ where: { key: storageKey } });
    const stored = (row?.value as { enabled?: boolean } | undefined)?.enabled;
    const enabled = typeof stored === 'boolean' ? stored : fallback;
    this.cacheService.set(cacheKey, enabled, CACHE_TTL);
    return enabled;
  }

  isOneClassPerMember(): Promise<boolean> {
    return this.flag('oneClassPerMember');
  }

  async teacherPermissions(): Promise<TeacherPermissions> {
    const [teachersCanAddMembers, teachersCanCheckInFirstTimers] =
      await Promise.all([
        this.flag('teachersCanAddMembers'),
        this.flag('teachersCanCheckInFirstTimers'),
      ]);
    return { teachersCanAddMembers, teachersCanCheckInFirstTimers };
  }

  async assertTeachersCanAddMembers(): Promise<void> {
    if (!(await this.flag('teachersCanAddMembers')))
      throw new ForbiddenException(
        'Your church has members added to Sunday School classes by an admin only. Ask an admin to add them from the admin portal.',
      );
  }

  async assertTeachersCanCheckInFirstTimers(): Promise<void> {
    if (!(await this.flag('teachersCanCheckInFirstTimers')))
      throw new ForbiddenException(
        'Your church has first-timers checked in by an admin only. Ask an admin to check them in from the admin portal.',
      );
  }

  async getSettings(): Promise<SundaySchoolSettings> {
    const [oneClassPerMember, teachers, rows] = await Promise.all([
      this.isOneClassPerMember(),
      this.teacherPermissions(),
      this.memberAssignRepo
        .createQueryBuilder('a')
        .select('a.member_id')
        .groupBy('a.member_id')
        .having('COUNT(*) > 1')
        .getRawMany(),
    ]);
    return {
      oneClassPerMember,
      ...teachers,
      membersInSeveralClasses: rows.length,
    };
  }

  async update(
    changes: Partial<Record<Flag, boolean>>,
    actorMemberId?: string,
  ): Promise<SundaySchoolSettings> {
    const updates = (Object.keys(FLAGS) as Flag[]).filter(
      (name) => typeof changes[name] === 'boolean',
    );
    for (const name of updates) {
      const { storageKey, cacheKey } = FLAGS[name];
      const enabled = changes[name]!;
      let row = await this.settingRepo.findOne({ where: { key: storageKey } });
      if (!row) {
        row = this.settingRepo.create({
          key: storageKey,
          moduleName: 'Sunday School',
          value: { enabled },
        });
      } else {
        row.value = { enabled };
      }
      await this.settingRepo.save(row);
      this.cacheService.del(cacheKey);
    }
    if (updates.length) {
      this.auditLogService.log('SUNDAY_SCHOOL_SETTINGS_UPDATED', {
        actorId: actorMemberId,
        metadata: Object.fromEntries(updates.map((n) => [n, changes[n]])),
      });
    }
    return this.getSettings();
  }
}
