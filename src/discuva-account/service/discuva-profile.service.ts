import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DiscuvaProfile } from '../entity/discuva-profile.entity';
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

@Injectable()
export class DiscuvaProfileService {
  constructor(
    @InjectRepository(DiscuvaProfile)
    private readonly profileRepo: Repository<DiscuvaProfile>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    private readonly accounts: DiscuvaAccountService,
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
    return this.profileRepo.findOneOrFail({ where: { accountId } });
  }

  async get(member: ProfileOwner): Promise<DiscuvaProfile | null> {
    return (await this.ownerOf(member)) ? this.ensure(member) : null;
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
    patch: ProfilePatch,
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
