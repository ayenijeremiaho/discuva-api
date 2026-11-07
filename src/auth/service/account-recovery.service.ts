import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DiscuvaAccountService,
  normaliseEmail,
} from '../../discuva-account/service/discuva-account.service';
import { DiscuvaAccount } from '../../discuva-account/entity/discuva-account.entity';
import { DiscuvaAccountCodePurpose } from '../../discuva-account/entity/discuva-account-code.entity';
import { MemberService } from '../../member/service/member.service';
import { Member } from '../../member/entity/member.entity';
import { AdminService } from '../../admin/service/admin.service';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { WebauthnService } from './webauthn.service';
import { AuthService } from './auth.service';

// An admin recovering someone's Discuva account in person, when the person has lost their email inbox.
@Injectable()
export class AccountRecoveryService {
  constructor(
    private readonly accounts: DiscuvaAccountService,
    private readonly memberService: MemberService,
    private readonly adminService: AdminService,
    private readonly utilityService: UtilityService,
    private readonly auditLogService: AuditLogService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly pushService: PushNotificationService,
    private readonly webauthnService: WebauthnService,
    private readonly authService: AuthService,
  ) {}

  // Emails a code to the person's new address; they read it to the admin.
  async start(
    actorId: string,
    memberId: string,
    newEmail: string,
  ): Promise<void> {
    const { member } = await this.checkAllowed(actorId, memberId, newEmail);
    const code = await this.accounts.issueCode(
      newEmail,
      DiscuvaAccountCodePurpose.RECOVER,
      this.adminDevice(actorId),
    );
    const churchName = await this.utilityService.resolveChurchName();
    const minutes = await this.platformSettings.getNumber(
      PlatformSettingKey.ACCOUNT_CODE_TTL_MINUTES,
    );
    this.utilityService.sendEmailWithTemplate(
      newEmail,
      'Your Discuva code',
      'discuva-account-code',
      {
        name: UtilityService.capitalizeFirstLetter(member.firstname),
        otp: code,
        expiresMinutes: String(minutes),
        action: `An admin at ${churchName} is helping you get your Discuva account back. Give them this code only in person.`,
      },
    );
  }

  async confirm(
    actorId: string,
    memberId: string,
    newEmail: string,
    code: string,
  ): Promise<void> {
    const { member, account } = await this.checkAllowed(
      actorId,
      memberId,
      newEmail,
    );
    await this.accounts.verifyCode(
      newEmail,
      DiscuvaAccountCodePurpose.RECOVER,
      this.adminDevice(actorId),
      code,
    );
    const oldEmail = await this.accounts.recover(account.id, newEmail);
    const churchName = await this.utilityService.resolveChurchName();

    await this.accounts.forEachLinkedMember(account.id, async (id) => {
      await this.pushService.unsubscribe(id);
      await this.webauthnService.revokeAllCredentials(id);
      // The admin is named only at this church, where they are a member.
      this.auditLogService.log('ACCOUNT_RECOVERED', {
        ...(id === member.id && { actorId }),
        targetId: id,
        targetEmail: newEmail,
        metadata: { oldEmail, recoveredAt: churchName },
      });
    });

    const name = UtilityService.capitalizeFirstLetter(member.firstname);
    this.utilityService.sendEmailWithTemplate(
      oldEmail,
      `${name}, Your Discuva Account Was Recovered`,
      'discuva-account-recovered',
      { name },
    );
    // The person sets a new password with the usual reset code, now sent to their new address.
    await this.authService.forgotPassword(newEmail);
  }

  private async checkAllowed(
    actorId: string,
    memberId: string,
    newEmail: string,
  ): Promise<{ member: Member; account: DiscuvaAccount }> {
    if (!(await this.accounts.isOn())) {
      throw new NotFoundException('This is not available yet.');
    }
    const [member, actor] = await Promise.all([
      this.memberService.getById(memberId),
      this.memberService.getById(actorId),
    ]);
    const account = await this.accounts.accountFor(member);
    if (!account) {
      throw new BadRequestException(
        'This person signs in only at this church. Use Reset Password or Clear Device instead.',
      );
    }
    if (actorId === memberId || actor.discuvaAccountId === account.id) {
      throw new ForbiddenException("You can't recover your own account.");
    }
    await this.assertRoleAllows(actorId, memberId);
    if (await this.accounts.isAdminAtAnotherChurch(account.id)) {
      throw new ForbiddenException(
        "This person is an admin at another church, so only that church's admins can recover their account.",
      );
    }
    const waitDays = await this.platformSettings.getNumber(
      PlatformSettingKey.ACCOUNT_RECOVERY_WAIT_DAYS,
    );
    if (
      account.recoveredAt &&
      Date.now() - account.recoveredAt.getTime() < waitDays * 86_400_000
    ) {
      throw new ForbiddenException(
        `This account was recovered recently. It can be recovered again ${waitDays} days after the last time.`,
      );
    }
    if (normaliseEmail(newEmail) === account.email) {
      throw new BadRequestException(
        'Recovery moves the account to a new email the person controls. This is the email it already uses.',
      );
    }
    if (await this.accounts.emailInUse(newEmail, account.id)) {
      throw new ConflictException('This email address is already in use.');
    }
    return { member, account };
  }

  // Recovering an admin needs Manage Admin Users & Roles and every permission they have.
  private async assertRoleAllows(
    actorId: string,
    memberId: string,
  ): Promise<void> {
    const target = await this.adminService.findByMemberId(memberId);
    if (!target) return;
    const actor = await this.adminService.findByMemberId(actorId);
    const mine = new Set(actor?.adminRole?.permissions ?? []);
    if (!mine.has(AdminPermission.ADMIN_WRITE)) {
      throw new ForbiddenException(
        'Recovering an admin needs the Manage Admin Users & Roles permission.',
      );
    }
    const bigger =
      (target.isOwner && !actor?.isOwner) ||
      (target.adminRole?.permissions ?? []).some((p) => !mine.has(p));
    if (bigger) {
      throw new ForbiddenException(
        "You can't recover an admin whose role can do more than yours.",
      );
    }
  }

  private adminDevice(actorId: string): string {
    return `admin:${actorId}`;
  }
}
