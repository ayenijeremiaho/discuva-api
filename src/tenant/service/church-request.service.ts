import { ProtectedNameService } from '../../protected-name/protected-name.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../entity/tenant.entity';
import { OrganisationTypeEnum } from '../enum/organisation-type.enum';
import { TenantOnboardingStatus } from '../enum/tenant-onboarding-status.enum';
import { TenantOnboardingActorType } from '../enum/tenant-onboarding-actor-type.enum';
import { TenantVerificationStatus } from '../enum/tenant-verification-status.enum';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';
import { EncryptionService } from '../../utility/service/encryption.service';
import { TenantVerificationService } from '../../utility/service/tenant-verification.service';
import { UtilityService } from '../../utility/service/utility.service';
import { SignupDto, VerificationRequestDto } from '../dto/signup.dto';
import {
  emailDomain,
  emailMatchesWebsite,
  isPersonalEmail,
  isSocialPage,
  soundsLikeChurch,
} from '../util/church-request-checks';

const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CONFIRM_PURPOSE = 'church-request';

export interface ChurchRequestDetails {
  country?: string;
  countryCode?: string;
  state?: string;
  stateCode?: string;
  city?: string;
  size?: string;
  locationCount?: number;
  adminEmail: string;
  adminEmailConfirmedAt?: string;
  website?: string;
  contactEmail?: string;
  contactDomain?: string | null;
  contactEmailConfirmedAt?: string;
  seniorLeader?: string;
  requesterRole?: string;
  registrationNumber?: string;
  note?: string;
  decisionNote?: string;
}

interface PendingParams {
  adminFirstname: string;
  adminLastname: string;
  adminEmail: string;
  planId?: string;
}

export interface ChurchRequestReview {
  orgType: OrganisationTypeEnum;
  verificationStatus: TenantVerificationStatus;
  details: ChurchRequestDetails | null;
  checks: {
    contactEmailConfirmed: boolean;
    emailMatchesWebsite: boolean;
    personalEmail: boolean;
    socialPageOnly: boolean;
    groupNamedLikeChurch: boolean;
    looksLikeProtectedName: string | null;
    possibleDuplicates: { id: string; name: string; subdomain: string }[];
  };
}

export interface VerificationState {
  status: TenantVerificationStatus;
  verifiedAt: Date | null;
  reviewHours: number;
  details: Pick<
    ChurchRequestDetails,
    | 'website'
    | 'contactEmail'
    | 'contactEmailConfirmedAt'
    | 'seniorLeader'
    | 'requesterRole'
    | 'registrationNumber'
    | 'note'
    | 'decisionNote'
  >;
}

// Churches and NGOs reach strangers and handle money, so they're reviewed before the account exists.
const reviewedFirst = (orgType: OrganisationTypeEnum) =>
  orgType !== OrganisationTypeEnum.GROUP;

const detailsOf = (tenant: Tenant) =>
  tenant.requestDetails as unknown as ChurchRequestDetails | null;

@Injectable()
export class ChurchRequestService {
  private readonly logger = new Logger(ChurchRequestService.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly provisioningService: TenantProvisioningService,
    private readonly settingsService: PlatformSettingsService,
    private readonly encryption: EncryptionService,
    private readonly verification: TenantVerificationService,
    private readonly utilityService: UtilityService,
    private readonly configService: ConfigService,
    private readonly protectedNames: ProtectedNameService,
  ) {}

  // A confirmed request can't be replaced by a fresh form.
  private assertCanSubmit(tenant: Tenant): void {
    if (
      tenant.onboardingStatus === TenantOnboardingStatus.AWAITING_APPROVAL ||
      tenant.onboardingStatus === TenantOnboardingStatus.PROVISIONING
    ) {
      throw new ConflictException('This address is already in use.');
    }
  }

  async submit(tenant: Tenant, dto: SignupDto): Promise<void> {
    this.assertCanSubmit(tenant);
    const orgType = dto.orgType ?? OrganisationTypeEnum.CHURCH;
    if (
      reviewedFirst(orgType) &&
      !(
        dto.website &&
        dto.contactEmail &&
        dto.seniorLeader &&
        dto.requesterRole &&
        dto.note
      )
    ) {
      throw new BadRequestException(
        'Please complete the verification details.',
      );
    }
    const details: ChurchRequestDetails = {
      country: dto.country,
      countryCode: dto.countryCode,
      state: dto.state,
      stateCode: dto.stateCode,
      city: dto.city,
      size: dto.size,
      locationCount: dto.locationCount,
      adminEmail: dto.adminEmail,
      website: dto.website,
      contactEmail: dto.contactEmail,
      contactDomain:
        dto.contactEmail && !isPersonalEmail(dto.contactEmail)
          ? emailDomain(dto.contactEmail)
          : null,
      seniorLeader: dto.seniorLeader,
      requesterRole: dto.requesterRole,
      registrationNumber: dto.registrationNumber,
      note: dto.note,
    };
    const pending: PendingParams = {
      adminFirstname: dto.adminFirstname,
      adminLastname: dto.adminLastname,
      adminEmail: dto.adminEmail,
      planId: 'free',
    };
    await this.tenantRepo.update(tenant.id, {
      name: dto.churchName,
      orgType,
      verificationStatus: TenantVerificationStatus.NONE,
      requestDetails: { ...details },
      pendingSignupParams: { ...pending },
      onboardingStatus: TenantOnboardingStatus.AWAITING_CONFIRMATION,
    });
    await this.provisioningService.recordEvent(
      tenant.id,
      'AWAITING_CONFIRMATION',
      TenantOnboardingActorType.SELF_SERVE,
    );
    this.sendConfirmation(tenant.id, dto.churchName, dto.adminEmail, false);
    if (dto.contactEmail && dto.contactEmail !== dto.adminEmail) {
      this.sendConfirmation(tenant.id, dto.churchName, dto.contactEmail, true);
    }
  }

  async resendConfirmations(tenantId: string): Promise<void> {
    const tenant = await this.tenantRepo.findOneBy({ id: tenantId });
    if (!tenant) throw new NotFoundException('Request not found');
    const details = detailsOf(tenant);
    if (
      tenant.onboardingStatus !==
        TenantOnboardingStatus.AWAITING_CONFIRMATION ||
      !details
    ) {
      return;
    }
    this.sendConfirmation(tenant.id, tenant.name, details.adminEmail, false);
    if (details.contactEmail && details.contactEmail !== details.adminEmail) {
      this.sendConfirmation(tenant.id, tenant.name, details.contactEmail, true);
    }
  }

  // Idempotent, because people click email links twice and mail scanners may open them.
  async confirm(
    token: string,
  ): Promise<{ status: TenantOnboardingStatus; name: string }> {
    const invalid = new ConflictException(
      'This link has expired or is not valid. Please ask for a new one.',
    );
    let payload: {
      purpose: string;
      tenantId: string;
      email: string;
      expiresAt: number;
    };
    try {
      payload = JSON.parse(
        this.encryption.decrypt(
          Buffer.from(token, 'base64url').toString('utf8'),
        ),
      );
    } catch {
      throw invalid;
    }
    if (payload.purpose !== CONFIRM_PURPOSE || payload.expiresAt < Date.now()) {
      throw invalid;
    }
    const tenant = await this.tenantRepo.findOneBy({ id: payload.tenantId });
    const details = tenant && detailsOf(tenant);
    if (!tenant || !details) throw invalid;

    const now = new Date().toISOString();
    if (payload.email === details.contactEmail) {
      await this.mergeDetails(tenant.id, { contactEmailConfirmedAt: now });
    }
    if (
      tenant.onboardingStatus !== TenantOnboardingStatus.AWAITING_CONFIRMATION
    ) {
      return { status: tenant.onboardingStatus, name: tenant.name };
    }
    if (payload.email !== details.adminEmail) {
      if (payload.email === details.contactEmail) {
        return { status: tenant.onboardingStatus, name: tenant.name };
      }
      throw invalid;
    }
    await this.mergeDetails(tenant.id, { adminEmailConfirmedAt: now });
    return this.release(tenant);
  }

  async getVerification(tenantId: string): Promise<VerificationState> {
    const tenant = await this.tenantRepo.findOneByOrFail({ id: tenantId });
    const details = detailsOf(tenant);
    return {
      status: tenant.verificationStatus,
      verifiedAt: tenant.verifiedAt,
      reviewHours: await this.settingsService.getNumber(
        PlatformSettingKey.REQUEST_REVIEW_HOURS,
      ),
      details: {
        website: details?.website,
        contactEmail: details?.contactEmail,
        contactEmailConfirmedAt: details?.contactEmailConfirmedAt,
        seniorLeader: details?.seniorLeader,
        requesterRole: details?.requesterRole,
        registrationNumber: details?.registrationNumber,
        note: details?.note,
        decisionNote: details?.decisionNote,
      },
    };
  }

  async requestVerification(
    tenantId: string,
    dto: VerificationRequestDto,
  ): Promise<VerificationState> {
    const tenant = await this.tenantRepo.findOneByOrFail({ id: tenantId });
    if (tenant.verificationStatus === TenantVerificationStatus.VERIFIED) {
      throw new BadRequestException('This account is already verified.');
    }
    const details = detailsOf(tenant);
    const sameEmail = details?.contactEmail === dto.contactEmail;
    await this.mergeDetails(tenant.id, {
      website: dto.website,
      contactEmail: dto.contactEmail,
      contactDomain: isPersonalEmail(dto.contactEmail)
        ? null
        : emailDomain(dto.contactEmail),
      seniorLeader: dto.seniorLeader,
      requesterRole: dto.requesterRole,
      registrationNumber: dto.registrationNumber,
      note: dto.note,
      ...(sameEmail ? {} : { contactEmailConfirmedAt: undefined }),
    });
    await this.tenantRepo.update(tenant.id, {
      verificationStatus: TenantVerificationStatus.PENDING,
    });
    if (!sameEmail || !details?.contactEmailConfirmedAt) {
      this.sendConfirmation(tenant.id, tenant.name, dto.contactEmail, true);
    }
    return this.getVerification(tenant.id);
  }

  async decideVerification(
    tenantId: string,
    approved: boolean,
    note?: string,
  ): Promise<void> {
    const tenant = await this.tenantRepo.findOneBy({ id: tenantId });
    if (!tenant) throw new NotFoundException('Tenant not found');
    // Clearing a badge would also make the account eligible for auto-delete, so it isn't done by accident.
    if (
      !approved &&
      tenant.verificationStatus === TenantVerificationStatus.VERIFIED
    ) {
      throw new ConflictException('A verified account cannot be declined.');
    }
    await this.tenantRepo.update(tenant.id, {
      verificationStatus: approved
        ? TenantVerificationStatus.VERIFIED
        : TenantVerificationStatus.REJECTED,
      verifiedAt: approved ? new Date() : null,
    });
    // Nothing was created yet, so a declined request frees its address and can apply again.
    const applyAgain =
      !approved &&
      tenant.onboardingStatus === TenantOnboardingStatus.AWAITING_APPROVAL;
    if (applyAgain) {
      await this.tenantRepo.update(tenant.id, {
        onboardingStatus: TenantOnboardingStatus.AWAITING_CONFIRMATION,
      });
    }
    await this.mergeDetails(tenant.id, { decisionNote: note });
    this.verification.clear(tenant.id);
    const details = detailsOf(tenant);
    const to = details?.adminEmail;
    if (to) {
      this.utilityService.sendEmailWithTemplate(
        to,
        approved
          ? `${tenant.name} is verified`
          : `We couldn't verify ${tenant.name} yet`,
        'tenant-verification-result',
        {
          organisation_name: tenant.name,
          approved,
          apply_again: applyAgain,
          note: note ?? '',
        },
      );
    }
  }

  // Approving a held church or NGO is its verification, so it gets one review and no second step.
  async markVerifiedOnApproval(tenant: Tenant): Promise<void> {
    // A group held for its name still starts private, so approval isn't its badge.
    if (!reviewedFirst(tenant.orgType)) {
      await this.tenantRepo.update(tenant.id, {
        verificationStatus: TenantVerificationStatus.NONE,
      });
      return;
    }
    await this.tenantRepo.update(tenant.id, {
      verificationStatus: TenantVerificationStatus.VERIFIED,
      verifiedAt: new Date(),
    });
    this.verification.clear(tenant.id);
  }

  async review(tenant: Tenant): Promise<ChurchRequestReview> {
    const details = detailsOf(tenant);
    return {
      orgType: tenant.orgType,
      verificationStatus: tenant.verificationStatus,
      details,
      checks: {
        contactEmailConfirmed: !!details?.contactEmailConfirmedAt,
        emailMatchesWebsite: emailMatchesWebsite(
          details?.contactEmail,
          details?.website,
        ),
        personalEmail: isPersonalEmail(details?.contactEmail),
        socialPageOnly: isSocialPage(details?.website),
        groupNamedLikeChurch:
          tenant.orgType === OrganisationTypeEnum.GROUP &&
          soundsLikeChurch(tenant.name),
        looksLikeProtectedName: await this.protectedNames.findNameMatch(
          tenant.name,
          tenant.id,
        ),
        possibleDuplicates: await this.findDuplicates(tenant, details),
      },
    };
  }

  // Name and contact domain only find possible matches for a person to check. Neither proves one.
  private async findDuplicates(
    tenant: Tenant,
    details: ChurchRequestDetails | null,
  ): Promise<{ id: string; name: string; subdomain: string }[]> {
    const qb = this.tenantRepo
      .createQueryBuilder('t')
      .select(['t.id', 't.name', 't.subdomain'])
      .where('t.id != :id', { id: tenant.id })
      .take(5);
    if (details?.contactDomain) {
      qb.andWhere(
        `(lower(t.name) = lower(:name) OR t.request_details->>'contactDomain' = :domain)`,
        { name: tenant.name, domain: details.contactDomain },
      );
    } else {
      qb.andWhere('lower(t.name) = lower(:name)', { name: tenant.name });
    }
    return qb.getMany();
  }

  // Merged in SQL, so two people confirming at once can't overwrite each other.
  private async mergeDetails(
    tenantId: string,
    patch: Partial<ChurchRequestDetails>,
  ): Promise<void> {
    await this.tenantRepo
      .createQueryBuilder()
      .update(Tenant)
      .set({ requestDetails: () => `request_details || :patch::jsonb` })
      .where('id = :id', { id: tenantId, patch: JSON.stringify(patch) })
      .execute();
  }

  // The account is only created now, so an unconfirmed email costs no schema.
  private async release(
    tenant: Tenant,
  ): Promise<{ status: TenantOnboardingStatus; name: string }> {
    const pending = tenant.pendingSignupParams as unknown as PendingParams;
    const fromConfirmation = {
      id: tenant.id,
      onboardingStatus: TenantOnboardingStatus.AWAITING_CONFIRMATION,
    };
    const review =
      reviewedFirst(tenant.orgType) ||
      soundsLikeChurch(tenant.name) ||
      !!(await this.protectedNames.findNameMatch(tenant.name, tenant.id));
    if (review || (await this.settingsService.getSelfServeRequiresApproval())) {
      const moved = await this.tenantRepo.update(fromConfirmation, {
        onboardingStatus: TenantOnboardingStatus.AWAITING_APPROVAL,
      });
      if (moved.affected) {
        await this.provisioningService.holdForApproval(tenant, pending);
        if (review) {
          await this.tenantRepo.update(tenant.id, {
            verificationStatus: TenantVerificationStatus.PENDING,
          });
        }
      }
      return {
        status: TenantOnboardingStatus.AWAITING_APPROVAL,
        name: tenant.name,
      };
    }
    const moved = await this.tenantRepo.update(fromConfirmation, {
      onboardingStatus: TenantOnboardingStatus.PENDING,
    });
    if (moved.affected) {
      await this.provisioningService.enqueueProvisioning({
        tenantId: tenant.id,
        subdomain: tenant.subdomain,
        churchName: tenant.name,
        ...pending,
        actorType: TenantOnboardingActorType.SELF_SERVE,
      });
    }
    return { status: TenantOnboardingStatus.PENDING, name: tenant.name };
  }

  private sendConfirmation(
    tenantId: string,
    name: string,
    email: string,
    isChurchAddress: boolean,
  ): void {
    const baseUrl = this.configService.get<string>('WEB_APP_URL');
    const token = Buffer.from(
      this.encryption.encrypt(
        JSON.stringify({
          purpose: CONFIRM_PURPOSE,
          tenantId,
          email,
          expiresAt: Date.now() + CONFIRM_TTL_MS,
        }),
      ),
    ).toString('base64url');
    this.utilityService.sendEmailWithTemplate(
      email,
      `Confirm your email to continue with ${name}`,
      'church-request-confirm',
      {
        organisation_name: name,
        is_church_address: isChurchAddress,
        confirm_url: `${baseUrl}/signup/confirm?token=${token}`,
      },
    );
    this.logger.log(`Sent a confirmation for ${tenantId}`);
  }
}
