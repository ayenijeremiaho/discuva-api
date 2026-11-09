import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { DiscuvaProfile } from '../entity/discuva-profile.entity';
import { DiscuvaMilestone } from '../entity/discuva-milestone.entity';
import { MilestoneSource, MilestoneType } from '../enum/milestone.enum';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { DiscuvaAccountService } from './discuva-account.service';
import { Member } from '../../member/entity/member.entity';

// The basics the person owns once Global Profile is on; admins see them but can't change them.
export const PROFILE_FIELDS = [
  'firstname',
  'lastname',
  'phoneNumber',
  'gender',
  'birthDay',
  'birthMonth',
  'birthYear',
  'maritalStatus',
  'address',
  'emergencyContactName',
  'emergencyContactPhone',
  'emergencyContactRelationship',
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export type ProfilePatch = Partial<
  Pick<
    DiscuvaProfile,
    ProfileField | 'appearanceMode' | 'mutedNotifications' | 'photoUrl'
  >
>;

type ProfileOwner = Pick<Member, 'id' | 'discuvaAccountId'>;

export interface DetailToConfirm {
  field: ProfileField;
  yours: unknown;
  here: unknown;
}

export type DetailChoice = 'YOURS' | 'HERE';

@Injectable()
export class DiscuvaProfileService {
  constructor(
    @InjectRepository(DiscuvaProfile)
    private readonly profileRepo: Repository<DiscuvaProfile>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    @InjectRepository(DiscuvaMilestone)
    private readonly milestoneRepo: Repository<DiscuvaMilestone>,
    private readonly accounts: DiscuvaAccountService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  // The account that owns this member's basics, or null while the church still does.
  async ownerOf(
    member: Pick<Member, 'discuvaAccountId'>,
  ): Promise<string | null> {
    if (!member.discuvaAccountId) return null;
    return (await this.accounts.isProfileOn()) ? member.discuvaAccountId : null;
  }

  // Basics in the patch that would change this member's church copy.
  static changedBasics(
    member: Partial<Member>,
    patch: Partial<Record<ProfileField, unknown>>,
  ): ProfileField[] {
    return PROFILE_FIELDS.filter(
      (f) =>
        patch[f] !== undefined && (patch[f] ?? null) !== (member[f] ?? null),
    );
  }

  // Created from this church's copy the first time it's needed, so nobody fills in their details twice.
  async ensure(member: ProfileOwner): Promise<DiscuvaProfile> {
    const accountId = member.discuvaAccountId;
    if (!accountId) throw new Error(`Member ${member.id} has no account`);
    const existing = await this.profileRepo.findOne({ where: { accountId } });
    if (existing) return existing;
    const source = await this.memberRepo.findOneOrFail({
      where: { id: member.id },
    });
    await this.profileRepo
      .createQueryBuilder()
      .insert()
      .values({
        accountId,
        ...Object.fromEntries(
          PROFILE_FIELDS.map((f) => [f, source[f] ?? null]),
        ),
        photoUrl: source.photoUrl ?? null,
        appearanceMode: source.appearanceMode,
        mutedNotifications: source.mutedNotifications ?? [],
      })
      .orIgnore()
      .execute();
    await this.importFaithYears(accountId, source);
    return this.profileRepo.findOneOrFail({ where: { accountId } });
  }

  // Years the person gave their church become their own milestones; safe to repeat.
  private async importFaithYears(
    accountId: string,
    source: Member,
  ): Promise<void> {
    const sourceTenantId = this.cls.get('tenantId') ?? null;
    const rows = (
      [
        [MilestoneType.SALVATION, source.yearBornAgain],
        [MilestoneType.BAPTISM, source.yearBaptized],
      ] as const
    )
      .filter(([, date]) => date)
      .map(([type, date]) => ({
        accountId,
        type,
        year: new Date(date).getFullYear(),
        source: MilestoneSource.MEMBER,
        sourceTenantId,
        sourceRef: `import:${type.toLowerCase()}`,
      }));
    if (!rows.length) return;
    await this.milestoneRepo
      .createQueryBuilder()
      .insert()
      .values(rows)
      .orIgnore()
      .execute();
  }

  async get(member: ProfileOwner): Promise<DiscuvaProfile | null> {
    return (await this.ownerOf(member)) ? this.ensure(member) : null;
  }

  // What a new church starts with when someone joins with their account; null before they have a profile.
  async basicsFor(accountId: string): Promise<Partial<Member> | null> {
    const profile = await this.profileRepo.findOne({ where: { accountId } });
    if (!profile) return null;
    return Object.fromEntries(PROFILE_FIELDS.map((f) => [f, profile[f]]));
  }

  // Brings this church's copy and the profile together: a value missing on one side is filled from the other;
  // two different values are left for the person to choose between.
  async reconcile(member: Member): Promise<DetailToConfirm[]> {
    const profile = await this.ensure(member);
    const toProfile: Partial<Record<ProfileField, unknown>> = {};
    const toChurch: Partial<Record<ProfileField, unknown>> = {};
    const conflicts: DetailToConfirm[] = [];
    for (const field of PROFILE_FIELDS) {
      const yours = profile[field] ?? null;
      const here = member[field] ?? null;
      if (yours === here) continue;
      if (yours === null) toProfile[field] = here;
      else if (here === null) toChurch[field] = yours;
      else conflicts.push({ field, yours, here });
    }
    if (Object.keys(toProfile).length) {
      await this.update(member, toProfile as ProfilePatch);
    }
    if (Object.keys(toChurch).length) {
      await this.memberRepo.update(member.id, toChurch as ProfilePatch);
      Object.assign(member, toChurch);
    }
    return conflicts;
  }

  // The person's answer to "Which details are right?", written to the profile and every church.
  async resolve(
    member: Member,
    choices: Record<string, DetailChoice>,
  ): Promise<void> {
    const conflicts = await this.reconcile(member);
    const patch: Partial<Record<ProfileField, unknown>> = {};
    for (const { field, yours, here } of conflicts) {
      const choice = choices[field];
      if (choice !== 'YOURS' && choice !== 'HERE') {
        throw new BadRequestException('Please choose which details are right.');
      }
      patch[field] = choice === 'YOURS' ? yours : here;
    }
    await this.update(member, patch as ProfilePatch);
  }

  // Saves to the profile, then to every church's copy so existing screens and reports keep reading their own row.
  async update(
    member: ProfileOwner,
    patch: ProfilePatch,
    options: { skipCurrent?: boolean } = {},
  ): Promise<void> {
    if (!Object.keys(patch).length) return;
    const profile = await this.ensure(member);
    await this.profileRepo.save(Object.assign(profile, patch));
    await this.writeToChurches(member, patch, options);
  }

  async writeToChurches(
    member: ProfileOwner,
    patch: Partial<Member>,
    options: { skipCurrent?: boolean } = {},
  ): Promise<void> {
    await this.accounts.forEachChurchOf(
      member,
      (memberId) =>
        this.memberRepo.update(memberId, patch).then(() => undefined),
      options,
    );
  }
}
