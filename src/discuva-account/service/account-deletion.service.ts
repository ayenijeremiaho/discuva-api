import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bull';
import { Repository } from 'typeorm';
import { DiscuvaAccount } from '../entity/discuva-account.entity';
import { DiscuvaAccountCodePurpose } from '../entity/discuva-account-code.entity';
import { DiscuvaAccountService } from './discuva-account.service';
import { DiscuvaAccountCodeService } from './discuva-account-code.service';
import { DiscuvaProfileService } from './discuva-profile.service';
import {
  ACCOUNT_DELETION_OPTIONS,
  ACCOUNT_DELETION_QUEUE,
  AccountDeletionJobData,
} from '../processor/account-deletion.processor';
import { Member } from '../../member/entity/member.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';

const DAY_MS = 86_400_000;

// Deleting a Discuva account waits out a grace period the person can cancel; a delayed job does the rest.
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    @InjectRepository(DiscuvaAccount)
    private readonly accountRepo: Repository<DiscuvaAccount>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    private readonly accounts: DiscuvaAccountService,
    private readonly codes: DiscuvaAccountCodeService,
    private readonly profiles: DiscuvaProfileService,
    private readonly utilityService: UtilityService,
    private readonly cloudinary: CloudinaryService,
    private readonly platformSettings: PlatformSettingsService,
    @InjectQueue(ACCOUNT_DELETION_QUEUE)
    private readonly queue: Queue<AccountDeletionJobData>,
  ) {}

  async request(memberId: string, password: string): Promise<Date> {
    const { member, account } = await this.holder(memberId);
    if (!(await this.accounts.verifyPassword(member, password))) {
      throw new UnauthorizedException('That password is not right.');
    }
    if (account.deleteRequestedAt) {
      throw new BadRequestException(
        'Deleting this account is already under way.',
      );
    }
    const days = await this.graceDays();
    const requestedAt = new Date();
    await this.accountRepo.update(account.id, {
      deleteRequestedAt: requestedAt,
    });
    await this.queue.add(
      { accountId: account.id, requestedAt: requestedAt.getTime() },
      {
        ...ACCOUNT_DELETION_OPTIONS,
        delay: days * DAY_MS,
        jobId: `delete:${account.id}:${requestedAt.getTime()}`,
      },
    );
    const token = await this.codes.issueLinkToken(
      account.id,
      DiscuvaAccountCodePurpose.DELETE_CANCEL,
      account.email,
      days,
    );
    const deletesOn = new Date(requestedAt.getTime() + days * DAY_MS);
    const name = UtilityService.capitalizeFirstLetter(member.firstname);
    this.utilityService.sendEmailWithTemplate(
      account.email,
      `${name}, Your Discuva Account Will Be Deleted`,
      'discuva-account-deletion',
      {
        name,
        deletes_on: deletesOn.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
        cancel_url: await this.utilityService.resolveMemberUrl(
          `/account/keep?a=${account.id}&t=${token}`,
        ),
      },
    );
    return deletesOn;
  }

  async cancel(memberId: string): Promise<void> {
    const { account } = await this.holder(memberId);
    await this.accountRepo.update(account.id, { deleteRequestedAt: null });
  }

  async cancelWithLink(accountId: string, token: string): Promise<void> {
    const record = await this.codes.findLinkToken(
      accountId,
      DiscuvaAccountCodePurpose.DELETE_CANCEL,
      token,
    );
    await this.accountRepo.update(accountId, { deleteRequestedAt: null });
    await this.codes.markUsed(record.id);
  }

  async scheduledFor(
    account: Pick<DiscuvaAccount, 'deleteRequestedAt'>,
  ): Promise<Date | null> {
    if (!account.deleteRequestedAt) return null;
    return new Date(
      new Date(account.deleteRequestedAt).getTime() +
        (await this.graceDays()) * DAY_MS,
    );
  }

  // Runs from the queue. Does nothing if the person cancelled or asked again later.
  async run(accountId: string, requestedAt: number): Promise<void> {
    const account = await this.accountRepo.findOne({
      where: { id: accountId },
      select: { id: true, deleteRequestedAt: true },
    });
    if (account?.deleteRequestedAt?.getTime() !== requestedAt) return;
    const churchFiles = await this.accounts.erase(accountId);
    for (const id of churchFiles) this.cloudinary.deleteByPublicId(id, 'image');
    this.cloudinary
      .deleteAccountFiles(accountId)
      .catch((err: Error) =>
        this.logger.error(
          `Could not remove files for deleted account ${accountId}: ${err.message}`,
        ),
      );
    this.logger.log(
      `Discuva account ${accountId} deleted at the person's request`,
    );
  }

  private async holder(
    memberId: string,
  ): Promise<{ member: Member; account: DiscuvaAccount }> {
    const member = await this.memberRepo
      .createQueryBuilder('m')
      .addSelect('m.password')
      .where('m.id = :id', { id: memberId })
      .getOne();
    const accountId = member && (await this.profiles.ownerOf(member));
    const account = accountId && (await this.accounts.findById(accountId));
    if (!member || !account) {
      throw new NotFoundException('This is not available yet.');
    }
    return { member, account };
  }

  private graceDays(): Promise<number> {
    return this.platformSettings.getNumber(
      PlatformSettingKey.ACCOUNT_DELETE_GRACE_DAYS,
    );
  }
}
