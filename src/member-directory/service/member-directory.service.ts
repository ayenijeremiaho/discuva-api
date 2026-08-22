import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MemberDirectoryProfile } from '../entity/member-directory-profile.entity';
import { Member } from '../../member/entity/member.entity';
import { UpdateDirectoryProfileDto } from '../dto/update-directory-profile.dto';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';

export interface DirectorySearchResult {
  id: string;
  firstname: string;
  lastname: string;
  photoUrl: string | null;
  occupation: string | null;
  businessName: string | null;
  skills: string | null;
  bio: string | null;
  phoneNumber?: string;
  email?: string;
}

export interface DirectoryCompletionStatus {
  isVisible: boolean;
  hasOccupation: boolean;
  hasBusinessName: boolean;
  hasSkills: boolean;
  hasBio: boolean;
  isDiscoverable: boolean;
}

export interface OccupationAnalyticsEntry {
  occupation: string;
  members: { id: string; firstname: string; lastname: string }[];
}

export interface DirectoryAnalytics {
  totalMembers: number;
  totalOptedIn: number;
  occupationBreakdown: OccupationAnalyticsEntry[];
}

export interface MyDirectoryProfile {
  occupation: string | null;
  businessName: string | null;
  skills: string | null;
  bio: string | null;
  isVisible: boolean;
  showPhone: boolean;
  showEmail: boolean;
}

const DEFAULT_PROFILE: MyDirectoryProfile = {
  occupation: null,
  businessName: null,
  skills: null,
  bio: null,
  isVisible: false,
  showPhone: false,
  showEmail: false,
};

@Injectable()
export class MemberDirectoryService {
  constructor(
    @InjectRepository(MemberDirectoryProfile)
    private readonly profileRepo: Repository<MemberDirectoryProfile>,
  ) {}

  async getMyProfile(memberId: string): Promise<MyDirectoryProfile> {
    const profile = await this.profileRepo.findOne({
      where: { member: { id: memberId } },
    });
    if (!profile) return DEFAULT_PROFILE;
    const {
      occupation,
      businessName,
      skills,
      bio,
      isVisible,
      showPhone,
      showEmail,
    } = profile;
    return {
      occupation,
      businessName,
      skills,
      bio,
      isVisible,
      showPhone,
      showEmail,
    };
  }

  async upsertMyProfile(
    memberId: string,
    dto: UpdateDirectoryProfileDto,
  ): Promise<MyDirectoryProfile> {
    let profile = await this.profileRepo.findOne({
      where: { member: { id: memberId } },
    });
    if (!profile) {
      profile = this.profileRepo.create({
        member: { id: memberId } as Member,
        ...DEFAULT_PROFILE,
      });
    }
    Object.assign(profile, dto);
    const {
      occupation,
      businessName,
      skills,
      bio,
      isVisible,
      showPhone,
      showEmail,
    } = await this.profileRepo.save(profile);
    return {
      occupation,
      businessName,
      skills,
      bio,
      isVisible,
      showPhone,
      showEmail,
    };
  }

  // Only ever finds *other* opted-in members — never used to fetch the
  // caller's own row (getMyProfile is the one place for that, and never
  // filters fields, since a member always sees their own full profile).
  async search(
    query: string | undefined,
    page = 1,
    limit = 20,
  ): Promise<PaginationResponseDto<DirectorySearchResult>> {
    const qb = this.profileRepo
      .createQueryBuilder('profile')
      .innerJoinAndSelect('profile.member', 'member')
      .where('profile.isVisible = true')
      .orderBy('member.firstname', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    if (query?.trim()) {
      qb.andWhere(
        '(LOWER(member.firstname) LIKE LOWER(:s) OR LOWER(member.lastname) LIKE LOWER(:s) OR LOWER(profile.occupation) LIKE LOWER(:s) OR LOWER(profile.businessName) LIKE LOWER(:s) OR LOWER(profile.skills) LIKE LOWER(:s))',
        { s: `%${query.trim()}%` },
      );
    }

    const [profiles, total] = await qb.getManyAndCount();

    const data: DirectorySearchResult[] = profiles.map((p) => ({
      id: p.member.id,
      firstname: p.member.firstname,
      lastname: p.member.lastname,
      photoUrl: p.member.photoUrl,
      occupation: p.occupation,
      businessName: p.businessName,
      skills: p.skills,
      bio: p.bio,
      ...(p.showPhone ? { phoneNumber: p.member.phoneNumber } : {}),
      ...(p.showEmail ? { email: p.member.email } : {}),
    }));

    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async getCompletionStatus(
    memberId: string,
  ): Promise<DirectoryCompletionStatus> {
    const profile = await this.profileRepo.findOne({
      where: { member: { id: memberId } },
    });
    const hasOccupation = !!profile?.occupation;
    const hasBusinessName = !!profile?.businessName;
    const hasSkills = !!profile?.skills;
    const hasBio = !!profile?.bio;
    return {
      isVisible: profile?.isVisible ?? false,
      hasOccupation,
      hasBusinessName,
      hasSkills,
      hasBio,
      isDiscoverable:
        (profile?.isVisible ?? false) &&
        (hasOccupation || hasBusinessName || hasSkills),
    };
  }

  // Admin, read-only — aggregate profession/business statistics for opted-in
  // members only. Never surfaces phone/email regardless of showPhone/
  // showEmail, since this is a church-wide statistics view, not a directory
  // lookup — an admin who needs to actually contact a member already has
  // that via the regular member record.
  async getAnalytics(totalMembers: number): Promise<DirectoryAnalytics> {
    const profiles = await this.profileRepo.find({
      where: { isVisible: true },
      relations: ['member'],
    });

    const byOccupation = new Map<
      string,
      { id: string; firstname: string; lastname: string }[]
    >();
    for (const p of profiles) {
      const occupation = p.occupation?.trim();
      if (!occupation) continue;
      const list = byOccupation.get(occupation) ?? [];
      list.push({
        id: p.member.id,
        firstname: p.member.firstname,
        lastname: p.member.lastname,
      });
      byOccupation.set(occupation, list);
    }

    const occupationBreakdown = Array.from(byOccupation.entries())
      .map(([occupation, members]) => ({ occupation, members }))
      .sort((a, b) => b.members.length - a.members.length);

    return {
      totalMembers,
      totalOptedIn: profiles.length,
      occupationBreakdown,
    };
  }
}
