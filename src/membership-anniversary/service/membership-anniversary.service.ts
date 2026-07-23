import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { Member } from '../../member/entity/member.entity';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { AnnouncementService } from '../../announcement/service/announcement.service';
import { UtilityService } from '../../utility/service/utility.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';

@Injectable()
export class MembershipAnniversaryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MembershipAnniversaryService.name);

  private static readonly LOCK_KEY = 'lock:membership-anniversary-greetings';
  private static readonly CATCHUP_LOCK_KEY =
    'lock:membership-anniversary-catchup';

  constructor(
    @InjectRepository(Member)
    private readonly memberRepository: Repository<Member>,
    private readonly announcementService: AnnouncementService,
    private readonly utilityService: UtilityService,
    private readonly cacheService: CacheService,
    private readonly auditLogService: AuditLogService,
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
      const celebrants = await this.memberRepository
        .createQueryBuilder('m')
        .where('m.dateJoinedChurch IS NOT NULL')
        .andWhere('EXTRACT(MONTH FROM m.dateJoinedChurch) = :month', {
          month,
        })
        .andWhere('EXTRACT(DAY FROM m.dateJoinedChurch) = :day', { day })
        .andWhere('EXTRACT(YEAR FROM m.dateJoinedChurch) < :year', { year })
        .andWhere('m.status = :status', { status: MemberStatusEnum.ACTIVE })
        .andWhere(
          '(m.anniversaryGreetedYear IS NULL OR m.anniversaryGreetedYear != :year)',
          { year },
        )
        .getMany();

      if (celebrants.length === 0) return;

      for (const member of celebrants) {
        try {
          // getUTCFullYear (not getFullYear) — dateJoinedChurch is a date-only
          // column serialized at UTC midnight; reading it in a negative-offset
          // local timezone would otherwise roll it back to the prior year.
          const years =
            year - new Date(member.dateJoinedChurch).getUTCFullYear();
          await this.greetMember(member, years);
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
    } finally {
      this.cacheService.releaseLock(MembershipAnniversaryService.LOCK_KEY);
    }
  }

  private async greetMember(member: Member, years: number): Promise<void> {
    await this.announcementService.createSystemAnnouncement(
      `Celebrating ${years} years with ${member.firstname}!`,
      `Today marks ${years} years since ${member.firstname} ${member.lastname} joined our church family. Join us in celebrating this milestone!`,
    );

    this.utilityService.sendEmailWithTemplate(
      member.email,
      `Celebrating ${years} Years, ${member.firstname}!`,
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
}
