import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Member } from '../../member/entity/member.entity';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';
import { AnnouncementService } from '../../announcement/service/announcement.service';
import { UtilityService } from '../../utility/service/utility.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';
import { DateService } from '../../utility/service/date.service';
import {
  AnniversarySettingsService,
  renderAnniversaryText,
} from './anniversary-settings.service';
import {
  AnniversaryCelebrant,
  AnniversarySettings,
} from '../dto/anniversary-settings.dto';

@Injectable()
export class MembershipAnniversaryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MembershipAnniversaryService.name);

  private static readonly LOCK_KEY = 'lock:membership-anniversary-greetings';
  private static readonly CATCHUP_LOCK_KEY =
    'lock:membership-anniversary-catchup';

  constructor(
    @InjectRepository(Member)
    private readonly memberRepository: Repository<Member>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly announcementService: AnnouncementService,
    private readonly utilityService: UtilityService,
    private readonly cacheService: CacheService,
    private readonly auditLogService: AuditLogService,
    private readonly dateService: DateService,
    private readonly settingsService: AnniversarySettingsService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  onApplicationBootstrap(): void {
    this.runCatchUp().catch((err) =>
      this.logger.error(
        'Membership anniversary catch-up failed on startup',
        err,
      ),
    );
  }

  private async runCatchUp(): Promise<void> {
    if (new Date().getHours() < 6) return;

    const acquired = await this.cacheService.acquireLock(
      MembershipAnniversaryService.CATCHUP_LOCK_KEY,
      60,
    );
    if (!acquired) return;

    try {
      await this.triggerAnniversaryGreetings();
    } finally {
      this.cacheService.releaseLock(
        MembershipAnniversaryService.CATCHUP_LOCK_KEY,
      );
    }
  }

  @Cron('0 6 * * *', { timeZone: CHURCH_TIMEZONE })
  async triggerAnniversaryGreetings(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(
      MembershipAnniversaryService.LOCK_KEY,
      270,
    );
    if (!acquired) {
      this.logger.debug(
        'Membership anniversary greetings skipped — another instance holds the lock',
      );
      return;
    }

    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    const year = today.getFullYear();

    try {
      const { succeeded, failed } = await forEachActiveTenant(
        this.tenantRepo,
        this.cls,
        this.txHost,
        this.logger,
        async () => {
          const celebrants = await this.memberRepository
            .createQueryBuilder('m')
            .where('m.dateJoinedChurch IS NOT NULL')
            .andWhere('EXTRACT(MONTH FROM m.dateJoinedChurch) = :month', {
              month,
            })
            .andWhere('EXTRACT(DAY FROM m.dateJoinedChurch) = :day', { day })
            .andWhere('EXTRACT(YEAR FROM m.dateJoinedChurch) < :year', {
              year,
            })
            .andWhere('m.status = :status', {
              status: MemberStatusEnum.ACTIVE,
            })
            .andWhere(
              '(m.anniversaryGreetedYear IS NULL OR m.anniversaryGreetedYear != :year)',
              { year },
            )
            .getMany();

          if (!celebrants.length) return;
          const settings = await this.settingsService.get();

          for (const member of celebrants) {
            try {
              // getUTCFullYear (not getFullYear) — dateJoinedChurch is a
              // date-only column serialized at UTC midnight; reading it in a
              // negative-offset local timezone would otherwise roll it back
              // to the prior year.
              const years =
                year - new Date(member.dateJoinedChurch).getUTCFullYear();
              await this.greetMember(member, years, settings);
              await this.memberRepository.update(member.id, {
                anniversaryGreetedYear: year,
              });
              this.logger.log(
                `Membership anniversary greeting sent to ${member.firstname} ${member.lastname} (${years} years)`,
              );
            } catch (err) {
              this.logger.error(
                `Membership anniversary greeting failed for member ${member.id}`,
                err,
              );
            }
          }
        },
      );
      this.logger.log(
        `Membership anniversary greetings complete for ${succeeded} tenant(s), ${failed} failure(s)`,
      );
    } finally {
      this.cacheService.releaseLock(MembershipAnniversaryService.LOCK_KEY);
    }
  }

  private async greetMember(
    member: Member,
    years: number,
    settings: AnniversarySettings,
  ): Promise<void> {
    if (settings.postEnabled) {
      await this.announcementService.createSystemAnnouncement(
        renderAnniversaryText(settings.title, member, years),
        renderAnniversaryText(settings.message, member, years),
        undefined,
        this.dateService.endOfDay(),
      );
    }

    this.utilityService.sendEmailWithTemplate(
      member.email,
      `Celebrating ${years} ${years === 1 ? 'Year' : 'Years'}, ${member.firstname}!`,
      'membership-anniversary',
      {
        name: member.firstname,
        full_name: `${member.firstname} ${member.lastname}`,
        years,
      },
      undefined,
      EmailCategory.MEMBERSHIP_ANNIVERSARY,
    );

    this.auditLogService.log('MEMBERSHIP_ANNIVERSARY_GREETED', {
      targetId: member.id,
      metadata: { years },
    });
  }

  // Today (daysAway 0) and the next `days` days, soonest first. A full year or more only.
  async getCelebrants(days: number): Promise<AnniversaryCelebrant[]> {
    const rows = await this.memberRepository.query<
      (Omit<AnniversaryCelebrant, 'years' | 'daysAway'> & {
        years: number;
        daysAway: number;
      })[]
    >(
      `WITH c AS (
         SELECT m.id, m.firstname, m.lastname, m.email,
                m.phone_number AS "phoneNumber", m.photo_url AS "photoUrl",
                to_char(m.date_joined_church, 'YYYY-MM-DD') AS "dateJoinedChurch",
                m.date_joined_church AS joined,
                EXTRACT(YEAR FROM age($1::date, m.date_joined_church))::int AS done
           FROM members m
          WHERE m.status = $3
            AND m.date_joined_church IS NOT NULL
            AND m.date_joined_church < $1::date
       ), n AS (
         SELECT c.*,
                (c.joined + c.done * interval '1 year')::date = $1::date AS is_today
           FROM c
       )
       SELECT id, firstname, lastname, email, "phoneNumber", "photoUrl", "dateJoinedChurch",
              CASE WHEN is_today THEN done ELSE done + 1 END AS years,
              CASE WHEN is_today THEN 0
                   ELSE (joined + (done + 1) * interval '1 year')::date - $1::date END AS "daysAway"
         FROM n
        WHERE (CASE WHEN is_today THEN done ELSE done + 1 END) >= 1
          AND (CASE WHEN is_today THEN 0
                    ELSE (joined + (done + 1) * interval '1 year')::date - $1::date END) <= $2
        ORDER BY "daysAway", firstname, lastname`,
      [this.dateService.today(), days, MemberStatusEnum.ACTIVE],
    );
    return rows.map((r) => ({
      ...r,
      years: Number(r.years),
      daysAway: Number(r.daysAway),
    }));
  }
}
