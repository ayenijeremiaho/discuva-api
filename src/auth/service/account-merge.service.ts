import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DiscuvaAccountService } from '../../discuva-account/service/discuva-account.service';
import { DiscuvaAccountCodeService } from '../../discuva-account/service/discuva-account-code.service';
import { DiscuvaAccountCodePurpose } from '../../discuva-account/entity/discuva-account-code.entity';
import { DiscuvaAccount } from '../../discuva-account/entity/discuva-account.entity';
import { normaliseEmail } from '../../discuva-account/util/normalise-email';
import { MemberService } from '../../member/service/member.service';
import { Member } from '../../member/entity/member.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';

// Someone with two Discuva emails makes them one account by proving both, with a code to each.
@Injectable()
export class AccountMergeService {
  constructor(
    private readonly accounts: DiscuvaAccountService,
    private readonly codes: DiscuvaAccountCodeService,
    private readonly memberService: MemberService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async start(memberId: string, otherEmail: string): Promise<void> {
    const { member, keep, gone } = await this.pair(memberId, otherEmail);
    const action = `You asked to combine ${keep.email} and ${gone.email} into one Discuva account, signing in with ${keep.email}.`;
    for (const email of [keep.email, gone.email]) {
      await this.codes.sendCode(
        email,
        DiscuvaAccountCodePurpose.MERGE,
        this.device(member),
        { firstName: member.firstname, action },
      );
    }
  }

  async confirm(
    memberId: string,
    otherEmail: string,
    codeHere: string,
    codeOther: string,
  ): Promise<void> {
    const { member, keep, gone } = await this.pair(memberId, otherEmail);
    const device = this.device(member);
    await this.codes.verifyCode(
      keep.email,
      DiscuvaAccountCodePurpose.MERGE,
      device,
      codeHere,
    );
    await this.codes.verifyCode(
      gone.email,
      DiscuvaAccountCodePurpose.MERGE,
      device,
      codeOther,
    );
    await this.accounts.mergeInto(keep.id, gone.id);
    this.auditLogService.log('ACCOUNT_MERGED', {
      actorId: member.id,
      targetId: member.id,
      targetEmail: keep.email,
      metadata: { mergedEmail: gone.email },
    });
  }

  private async pair(
    memberId: string,
    otherEmail: string,
  ): Promise<{ member: Member; keep: DiscuvaAccount; gone: DiscuvaAccount }> {
    if (!(await this.accounts.isProfileOn())) {
      throw new NotFoundException('This is not available yet.');
    }
    const member = await this.memberService.getByIdWithCredentials(memberId);
    const keep = await this.accounts.accountFor(member);
    if (!keep) throw new NotFoundException('This is not available yet.');
    const gone = await this.accounts.findByEmail(otherEmail);
    if (!gone || gone.id === keep.id) {
      throw new BadRequestException(
        `${normaliseEmail(otherEmail)} isn't another Discuva account.`,
      );
    }
    if (gone.frozenAt || gone.deleteRequestedAt || keep.deleteRequestedAt) {
      throw new ForbiddenException(
        "One of these accounts is frozen or being deleted, so they can't be combined.",
      );
    }
    if (await this.accounts.sharesChurch(keep.id, gone.id)) {
      throw new ConflictException(
        'Both emails belong to the same church. Ask an admin there to sort out the two records first.',
      );
    }
    if (await this.accounts.emailTakenAtChurchesOf(keep.email, gone.id)) {
      throw new ConflictException(
        `Someone else at one of those churches already uses ${keep.email}. Ask an admin there for help.`,
      );
    }
    return { member, keep, gone };
  }

  private device(member: Member): string {
    return member.deviceId ?? `member:${member.id}`;
  }
}
