import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { In, Repository } from 'typeorm';
import { DiscuvaAccountService } from './discuva-account.service';
import { DiscuvaProfileService } from './discuva-profile.service';
import { DiscuvaMilestone } from '../entity/discuva-milestone.entity';
import { DiscuvaProfile } from '../entity/discuva-profile.entity';
import {
  MILESTONE_LABELS,
  MilestoneSource,
  MilestoneVisibility,
} from '../enum/milestone.enum';
import { Member } from '../../member/entity/member.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AccountDataPdf, PdfService } from '../../utility/service/pdf.service';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export interface AccountExport {
  exportedAt: string;
  account: { email: string; createdAt: Date };
  profile: Omit<
    DiscuvaProfile,
    'accountId' | 'photoPublicId' | 'createdAt' | 'updatedAt'
  >;
  milestones: {
    type: string;
    title: string | null;
    month: number | null;
    year: number | null;
    where: string | null;
    recordedBy: string;
    visibility: MilestoneVisibility;
    hidden: boolean;
  }[];
  churches: { name: string; linkedAt: Date }[];
}

// Everything the person's Discuva account holds, never a church's own records.
@Injectable()
export class AccountDataService {
  constructor(
    @InjectRepository(DiscuvaMilestone)
    private readonly milestoneRepo: Repository<DiscuvaMilestone>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    private readonly accounts: DiscuvaAccountService,
    private readonly profiles: DiscuvaProfileService,
    private readonly pdfService: PdfService,
    private readonly config: ConfigService,
  ) {}

  async export(memberId: string): Promise<AccountExport> {
    const member = await this.memberRepo.findOne({
      where: { id: memberId },
      select: { id: true, discuvaAccountId: true },
    });
    const accountId = member && (await this.profiles.ownerOf(member));
    const account = accountId && (await this.accounts.findById(accountId));
    if (!member || !account) {
      throw new NotFoundException('This is not available yet.');
    }
    const [profile, milestones, links] = await Promise.all([
      this.profiles.ensure(member),
      this.milestoneRepo.find({
        where: { accountId: account.id },
        order: { year: 'DESC', month: 'DESC', createdAt: 'DESC' },
      }),
      this.accounts.linksOf(account.id),
    ]);
    const tenants = links.length
      ? await this.tenantRepo.find({
          where: { id: In(links.map((l) => l.tenantId)) },
          select: { id: true, name: true },
        })
      : [];
    const nameOf = new Map(tenants.map((t) => [t.id, t.name]));
    const {
      accountId: _a,
      photoPublicId: _p,
      createdAt: _c,
      updatedAt: _u,
      ...ownProfile
    } = profile;
    return {
      exportedAt: new Date().toISOString(),
      account: { email: account.email, createdAt: account.createdAt },
      profile: ownProfile,
      milestones: milestones.map((m) => ({
        type: MILESTONE_LABELS[m.type],
        title: m.title,
        month: m.month,
        year: m.year,
        where: m.placeName,
        recordedBy:
          m.source === MilestoneSource.CHURCH
            ? (m.sourceName ?? 'A church')
            : 'You',
        visibility: m.visibility,
        hidden: m.hidden,
      })),
      churches: links
        .filter((l) => nameOf.has(l.tenantId))
        .map((l) => ({ name: nameOf.get(l.tenantId)!, linkedAt: l.linkedAt })),
    };
  }

  async pdf(memberId: string): Promise<Buffer> {
    const data = await this.export(memberId);
    const p = data.profile;
    const birthday =
      p.birthDay && p.birthMonth
        ? `${p.birthDay} ${MONTHS[p.birthMonth - 1]}${p.birthYear ? ` ${p.birthYear}` : ''}`
        : '';
    const emergency = [
      p.emergencyContactName,
      p.emergencyContactRelationship && `(${p.emergencyContactRelationship})`,
      p.emergencyContactPhone,
    ]
      .filter(Boolean)
      .join(' ');
    const doc: AccountDataPdf = {
      name: `${p.firstname} ${p.lastname}`,
      timezone: this.config.get<string>('TIMEZONE') ?? 'Africa/Lagos',
      exportedAt: new Date(data.exportedAt),
      accountCreatedAt: data.account.createdAt,
      photoUrl: p.photoUrl,
      profile: [
        ['Name', `${p.firstname} ${p.lastname}`],
        ['Email', data.account.email],
        ['Phone', p.phoneNumber ?? ''],
        ['Birthday', birthday],
        ['Gender', this.title(p.gender)],
        ['Marital status', this.title(p.maritalStatus)],
        ['Address', p.address ?? ''],
        ['Emergency contact', emergency],
      ],
      milestones: data.milestones.map((m) => ({
        when: [m.month ? MONTHS[m.month - 1] : '', m.year ?? '']
          .filter(Boolean)
          .join(' '),
        what: m.title && m.title !== m.type ? `${m.type}: ${m.title}` : m.type,
        where: m.where ?? '',
        recordedBy: m.recordedBy,
        shownTo:
          (m.visibility === MilestoneVisibility.PRIVATE
            ? 'Only you'
            : 'Your churches') + (m.hidden ? ' (hidden)' : ''),
      })),
      churches: data.churches,
    };
    return this.pdfService.generateAccountData(doc);
  }

  private title(value: string | null): string {
    if (!value) return '';
    return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
  }
}
