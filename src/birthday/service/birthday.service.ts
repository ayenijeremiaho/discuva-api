import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { BirthdayWish } from '../entity/birthday-wish.entity';
import { Member } from '../../member/entity/member.entity';
import { Announcement } from '../../announcement/entity/announcement.entity';
import { AnnouncementAudienceEnum } from '../../announcement/enum/announcement-audience.enum';
import { ConfigService } from '@nestjs/config';
import { UtilityService } from '../../utility/service/utility.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { SanitizationService } from '../../utility/service/sanitization.service';
import { CacheService } from '../../utility/service/cache.service';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';

export interface BirthdayCelebrant {
  id: string;
  firstname: string;
  lastname: string;
  birthMonth: number;
  birthDay: number;
  birthYear: number | null;
  role: MemberRoleEnum;
  departmentName: string | null;
  clergyTitleName: string | null;
  alreadyWishedByMe: boolean;
  photoUrl: string | null;
}

@Injectable()
export class BirthdayService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BirthdayService.name);

  constructor(
    @InjectRepository(BirthdayWish)
    private readonly wishRepository: Repository<BirthdayWish>,
    @InjectRepository(Member)
    private readonly memberRepository: Repository<Member>,
    @InjectRepository(Announcement)
    private readonly announcementRepository: Repository<Announcement>,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    private readonly utilityService: UtilityService,
    private readonly sanitizationService: SanitizationService,
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  private static readonly LOCK_KEY = 'lock:birthday-greetings';
  private static readonly CATCHUP_LOCK_KEY = 'lock:birthday-catchup';

  onApplicationBootstrap(): void {
    this.runBirthdayCatchUp().catch((err) =>
      this.logger.error('Birthday catch-up failed on startup', err),
    );
  }

  private async runBirthdayCatchUp(): Promise<void> {
    if (new Date().getHours() < 6) return;

    const acquired = await this.cacheService.acquireLock(
      BirthdayService.CATCHUP_LOCK_KEY,
      60,
    );
    if (!acquired) return;

    try {
      await this.triggerBirthdayGreetings();
    } finally {
      this.cacheService.releaseLock(BirthdayService.CATCHUP_LOCK_KEY);
    }
  }

  @Cron('0 6 * * *', { timeZone: CHURCH_TIMEZONE })
  async triggerBirthdayGreetings(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(
      BirthdayService.LOCK_KEY,
      270,
    );
    if (!acquired) {
      this.logger.debug(
        'Birthday greetings skipped — another instance holds the lock',
      );
      return;
    }

    try {
      await forEachActiveTenant(
        this.tenantRepository,
        this.cls,
        this.txHost,
        this.logger,
        async () => {
          const today = new Date();
          const month = today.getMonth() + 1;
          const day = today.getDate();
          const year = today.getFullYear();

          const birthdayMembers = await this.memberRepository
            .createQueryBuilder('m')
            .where('m.birthMonth = :month', { month })
            .andWhere('m.birthDay = :day', { day })
            .andWhere('m.status = :status', { status: MemberStatusEnum.ACTIVE })
            .andWhere(
              '(m.birthdayGreetedYear IS NULL OR m.birthdayGreetedYear != :year)',
              { year },
            )
            .getMany();

          if (birthdayMembers.length === 0) return;

          const endOfDay = new Date(today);
          endOfDay.setHours(23, 59, 59, 999);

          for (const member of birthdayMembers) {
            try {
              await this.createBirthdayAnnouncement(member, endOfDay);
              await this.memberRepository.update(member.id, {
                birthdayGreetedYear: year,
              });
              this.sendBirthdayEmail(member);
              this.logger.log(
                `Birthday greetings sent to ${member.firstname} ${member.lastname}`,
              );
            } catch (err) {
              this.logger.error(
                `Birthday greeting failed for member ${member.id}`,
                err,
              );
            }
          }
        },
      );
    } finally {
      this.cacheService.releaseLock(BirthdayService.LOCK_KEY);
    }
  }

  async getTodaysBirthdays(
    currentMemberId?: string,
  ): Promise<BirthdayCelebrant[]> {
    const today = new Date();
    const members = await this.memberRepository.find({
      where: {
        birthMonth: today.getMonth() + 1,
        birthDay: today.getDate(),
        status: MemberStatusEnum.ACTIVE,
      },
      relations: [
        'workerProfile',
        'workerProfile.department',
        'clergy',
        'clergy.title',
      ],
    });

    if (members.length === 0) return [];

    let wishedIds = new Set<string>();
    if (currentMemberId) {
      const wishes = await this.wishRepository.find({
        where: {
          sender: { id: currentMemberId },
          year: today.getFullYear(),
          recipient: { id: In(members.map((m) => m.id)) },
        },
        relations: ['recipient'],
      });
      wishedIds = new Set(wishes.map((w) => w.recipient.id));
    }

    // Deliberately omits email/phoneNumber from this member-facing response —
    // role/department/clergy title (and now photoUrl) disambiguate same-named
    // celebrants without exposing personal contact info to other members.
    return members.map((m) => ({
      id: m.id,
      firstname: m.firstname,
      lastname: m.lastname,
      birthMonth: m.birthMonth,
      birthDay: m.birthDay,
      birthYear: m.birthYear,
      role: m.role,
      departmentName: m.workerProfile?.department?.name ?? null,
      clergyTitleName: m.clergy?.title?.name ?? null,
      alreadyWishedByMe: wishedIds.has(m.id),
      photoUrl: m.photoUrl,
    }));
  }

  async getUpcomingBirthdays(
    days: number = 7,
  ): Promise<
    Pick<
      Member,
      | 'id'
      | 'firstname'
      | 'lastname'
      | 'email'
      | 'phoneNumber'
      | 'birthMonth'
      | 'birthDay'
      | 'birthYear'
    >[]
  > {
    const today = new Date();

    const upcoming: { month: number; day: number }[] = [];
    for (let i = 1; i <= days; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      upcoming.push({ month: d.getMonth() + 1, day: d.getDate() });
    }

    const conditions = upcoming
      .map((_, i) => `(m.birthMonth = :month${i} AND m.birthDay = :day${i})`)
      .join(' OR ');

    const params: Record<string, number> = {};
    upcoming.forEach(({ month, day }, i) => {
      params[`month${i}`] = month;
      params[`day${i}`] = day;
    });

    return this.memberRepository
      .createQueryBuilder('m')
      .select([
        'm.id',
        'm.firstname',
        'm.lastname',
        'm.email',
        'm.phoneNumber',
        'm.birthMonth',
        'm.birthDay',
        'm.birthYear',
      ])
      .where(`(${conditions})`, params)
      .andWhere('m.status = :status', { status: MemberStatusEnum.ACTIVE })
      .orderBy('m.birthMonth', 'ASC')
      .addOrderBy('m.birthDay', 'ASC')
      .getMany();
  }

  async sendWish(
    recipientId: string,
    senderId: string,
    message: string,
  ): Promise<BirthdayWish> {
    if (recipientId === senderId) {
      throw new BadRequestException('You cannot send a wish to yourself');
    }

    const dailyLimit = this.configService.get<number>('WISH_DAILY_LIMIT');
    const rateKey = this.cacheService.key('wish_rate', senderId);
    const sentToday = (await this.cacheService.get<number>(rateKey)) ?? 0;
    if (sentToday >= dailyLimit) {
      throw new HttpException(
        'You have reached your daily limit for birthday wishes. Please try again tomorrow.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const year = new Date().getFullYear();

    const existing = await this.wishRepository.findOne({
      where: {
        recipient: { id: recipientId },
        sender: { id: senderId },
        year,
      },
    });
    if (existing) {
      throw new BadRequestException(
        'You have already sent a birthday wish to this person this year',
      );
    }

    const clean = this.sanitizationService.sanitizeText(message);

    const wish = this.wishRepository.create({
      message: clean,
      recipient: { id: recipientId } as Member,
      sender: { id: senderId } as Member,
      year,
    });

    const saved = await this.wishRepository.save(wish);

    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const ttl = Math.ceil((midnight.getTime() - now.getTime()) / 1000);
    this.cacheService.incr(rateKey, ttl);

    return saved;
  }

  async getWishesForMember(
    recipientId: string,
    year?: number,
  ): Promise<BirthdayWish[]> {
    const qb = this.wishRepository
      .createQueryBuilder('w')
      .leftJoin('w.sender', 'sender')
      .addSelect(['sender.id', 'sender.firstname', 'sender.lastname'])
      .where('w.recipient.id = :recipientId', { recipientId })
      .orderBy('w.createdAt', 'DESC');

    if (year) qb.andWhere('w.year = :year', { year });

    return qb.getMany();
  }

  private async createBirthdayAnnouncement(
    member: Member,
    expiresAt: Date,
  ): Promise<void> {
    const announcement = this.announcementRepository.create({
      title: `Happy Birthday, ${member.firstname}!`,
      body: `Today is ${member.firstname} ${member.lastname}'s birthday! Join us in celebrating and sending them your warmest wishes and prayers.`,
      audience: AnnouncementAudienceEnum.ALL,
      author: null,
      department: null,
      targetMember: null,
      publishedAt: new Date(),
      expiresAt,
    });
    await this.announcementRepository.save(announcement);
  }

  private sendBirthdayEmail(member: Member): void {
    this.utilityService.sendEmailWithTemplate(
      member.email,
      `Happy Birthday, ${member.firstname}!`,
      'happy-birthday',
      {
        name: member.firstname,
        full_name: `${member.firstname} ${member.lastname}`,
      },
      undefined,
      EmailCategory.BIRTHDAY,
    );
  }
}
