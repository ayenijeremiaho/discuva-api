import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { DiscuvaPhotoRemoval } from '../entity/discuva-photo-removal.entity';
import {
  PHOTO_REMOVAL_REASON_TEXT,
  PhotoRemovalReason,
} from '../enum/photo-removal-reason.enum';
import { DiscuvaProfileService } from './discuva-profile.service';
import { DiscuvaAccountService } from './discuva-account.service';
import { Member } from '../../member/entity/member.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { UtilityService } from '../../utility/service/utility.service';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';

export interface PhotoReport {
  accountId: string;
  email: string;
  name: string | null;
  removals: number;
  lastRemovedAt: Date;
  churches: string[];
}

const DAY_MS = 86_400_000;

// Admins can remove an account holder's photo, never replace it. Each removal is logged and the person told why.
@Injectable()
export class PhotoRemovalService {
  private readonly logger = new Logger(PhotoRemovalService.name);

  constructor(
    @InjectRepository(DiscuvaPhotoRemoval)
    private readonly removalRepo: Repository<DiscuvaPhotoRemoval>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly profiles: DiscuvaProfileService,
    private readonly accounts: DiscuvaAccountService,
    private readonly utilityService: UtilityService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async remove(
    member: Member,
    actorId: string,
    reason: PhotoRemovalReason,
    note: string | null,
  ): Promise<void> {
    const accountId = await this.profiles.ownerOf(member);
    if (!accountId) throw new NotFoundException('This is not available yet.');
    await this.profiles.clearPhoto(member);
    await this.removalRepo.insert({
      accountId,
      tenantId: this.cls.get('tenantId') ?? null,
      adminId: actorId,
      reason,
      note: note?.trim() || null,
    });
    await this.tell(member, accountId, reason, note);
    await this.flagIfRepeated(accountId);
  }

  // People whose photo admins keep removing, for Discuva staff to look at.
  async reports(): Promise<PhotoReport[]> {
    const [threshold, windowDays] = await this.limits();
    const since = new Date(Date.now() - windowDays * DAY_MS);
    const rows: {
      account_id: string;
      email: string;
      firstname: string | null;
      lastname: string | null;
      removals: string;
      last_removed_at: Date;
      churches: string[] | null;
    }[] = await this.dataSource.query(
      `SELECT r.account_id, a.email, p.firstname, p.lastname,
              count(*) AS removals, max(r.created_at) AS last_removed_at,
              array_remove(array_agg(DISTINCT t.name), NULL) AS churches
         FROM public.discuva_photo_removals r
         JOIN public.discuva_accounts a ON a.id = r.account_id
         LEFT JOIN public.discuva_profiles p ON p.account_id = r.account_id
         LEFT JOIN public.tenants t ON t.id = r.tenant_id
        WHERE r.created_at > $1
        GROUP BY r.account_id, a.email, p.firstname, p.lastname
       HAVING count(*) >= $2
        ORDER BY max(r.created_at) DESC
        LIMIT 200`,
      [since, threshold],
    );
    return rows.map((r) => ({
      accountId: r.account_id,
      email: r.email,
      name: [r.firstname, r.lastname].filter(Boolean).join(' ') || null,
      removals: Number(r.removals),
      lastRemovedAt: r.last_removed_at,
      churches: r.churches ?? [],
    }));
  }

  private async tell(
    member: Member,
    accountId: string,
    reason: PhotoRemovalReason,
    note: string | null,
  ): Promise<void> {
    const account = await this.accounts.findById(accountId);
    if (!account) return;
    const name = UtilityService.capitalizeFirstLetter(member.firstname);
    this.utilityService.sendEmailWithTemplate(
      account.email,
      `${name}, Your Profile Photo Was Removed`,
      'discuva-photo-removed',
      {
        name,
        reason: PHOTO_REMOVAL_REASON_TEXT[reason],
        note: note?.trim() || null,
      },
    );
  }

  private async flagIfRepeated(accountId: string): Promise<void> {
    const [threshold, windowDays] = await this.limits();
    const count = await this.removalRepo.count({
      where: {
        accountId,
        createdAt: MoreThan(new Date(Date.now() - windowDays * DAY_MS)),
      },
    });
    if (count >= threshold) {
      this.logger.warn(
        `Account ${accountId} has had ${count} photos removed in ${windowDays} days; it is on Photo reports`,
      );
    }
  }

  private limits(): Promise<[number, number]> {
    return Promise.all([
      this.platformSettings.getNumber(PlatformSettingKey.PHOTO_REPORT_REMOVALS),
      this.platformSettings.getNumber(
        PlatformSettingKey.PHOTO_REPORT_WINDOW_DAYS,
      ),
    ]);
  }
}
