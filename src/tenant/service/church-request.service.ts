import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Tenant } from '../entity/tenant.entity';
import { OrganisationTypeEnum } from '../enum/organisation-type.enum';
import { TenantOnboardingStatus } from '../enum/tenant-onboarding-status.enum';
import { TenantOnboardingActorType } from '../enum/tenant-onboarding-actor-type.enum';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { EncryptionService } from '../../utility/service/encryption.service';
import { UtilityService } from '../../utility/service/utility.service';
import { SignupDto } from '../dto/signup.dto';
import {
  emailDomain,
  emailMatchesWebsite,
  isPersonalEmail,
  isSocialPage,
} from '../util/church-request-checks';

const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CONFIRM_PURPOSE = 'church-request';

export interface ChurchRequestDetails {
  city?: string;
  country?: string;
  countryCode?: string;
  state?: string;
  stateCode?: string;
  size?: string;
  locationCount?: number;
  locationStructure?: string;
  otherLocations?: string;
  meetsOnline?: boolean;
  website?: string;
  requesterRole?: string;
  requesterPhone?: string;
  adminEmail: string;
  contactEmail: string;
  contactDomain: string | null;
  adminEmailConfirmedAt?: string;
  contactEmailConfirmedAt?: string;
}

interface PendingParams {
  adminFirstname: string;
  adminLastname: string;
  adminEmail: string;
  planId?: string;
}

export interface ChurchRequestReview {
  orgType: OrganisationTypeEnum;
  details: ChurchRequestDetails | null;
  checks: {
    bothEmailsConfirmed: boolean;
    emailMatchesWebsite: boolean;
    personalEmail: boolean;
    socialPageOnly: boolean;
    possibleDuplicates: { id: string; name: string; subdomain: string }[];
  };
}

@Injectable()
export class ChurchRequestService {
  private readonly logger = new Logger(ChurchRequestService.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly provisioningService: TenantProvisioningService,
    private readonly settingsService: PlatformSettingsService,
    private readonly encryption: EncryptionService,
    private readonly utilityService: UtilityService,
    private readonly configService: ConfigService,
  ) {}

  // A request that has been through both confirmations or review can't be replaced by a fresh form.
  assertCanSubmit(tenant: Tenant): void {
    if (
      tenant.onboardingStatus === TenantOnboardingStatus.AWAITING_APPROVAL ||
      tenant.onboardingStatus === TenantOnboardingStatus.PROVISIONING
    ) {
      throw new ConflictException('This address is already being reviewed.');
    }
  }

  async submit(tenant: Tenant, dto: SignupDto): Promise<void> {
    this.assertCanSubmit(tenant);
    const contactEmail = dto.contactEmail ?? dto.adminEmail;
    const details: ChurchRequestDetails = {
      city: dto.city,
      country: dto.country,
      countryCode: dto.countryCode,
      state: dto.state,
      stateCode: dto.stateCode,
      size: dto.size,
      locationCount: dto.locationCount,
      locationStructure: dto.locationStructure,
      otherLocations: dto.otherLocations,
      meetsOnline: dto.meetsOnline,
      website: dto.website,
      requesterRole: dto.requesterRole,
      requesterPhone: dto.requesterPhone,
      adminEmail: dto.adminEmail,
      contactEmail,
      contactDomain: isPersonalEmail(contactEmail)
        ? null
        : emailDomain(contactEmail),
    };
    const pending: PendingParams = {
      adminFirstname: dto.adminFirstname,
      adminLastname: dto.adminLastname,
      adminEmail: dto.adminEmail,
      planId: 'free',
    };
    await this.tenantRepo.update(tenant.id, {
      name: dto.churchName,
      orgType: dto.orgType ?? OrganisationTypeEnum.CHURCH,
      requestDetails: { ...details },
      pendingSignupParams: { ...pending },
      onboardingStatus: TenantOnboardingStatus.AWAITING_CONFIRMATION,
    });
    await this.provisioningService.recordEvent(
      tenant.id,
      'AWAITING_CONFIRMATION',
      TenantOnboardingActorType.SELF_SERVE,
    );
    this.sendConfirmations(tenant.id, dto.churchName, details);
  }

  async resendConfirmations(tenantId: string): Promise<void> {
    const tenant = await this.tenantRepo.findOneBy({ id: tenantId });
    if (!tenant) throw new NotFoundException('Request not found');
    if (
      tenant.onboardingStatus !==
        TenantOnboardingStatus.AWAITING_CONFIRMATION ||
      !tenant.requestDetails
    ) {
      return;
    }
    this.sendConfirmations(
      tenant.id,
      tenant.name,
      tenant.requestDetails as unknown as ChurchRequestDetails,
    );
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
    const details = tenant?.requestDetails as unknown as
      ChurchRequestDetails | undefined;
    if (!tenant || !details) throw invalid;
    if (
      tenant.onboardingStatus !== TenantOnboardingStatus.AWAITING_CONFIRMATION
    ) {
      return { status: tenant.onboardingStatus, name: tenant.name };
    }

    const patch: Partial<ChurchRequestDetails> = {};
    const now = new Date().toISOString();
    if (payload.email === details.adminEmail) patch.adminEmailConfirmedAt = now;
    if (payload.email === details.contactEmail) {
      patch.contactEmailConfirmedAt = now;
    }
    if (!Object.keys(patch).length) throw invalid;

    // Merged in SQL, so the two people confirming at once can't overwrite each other.
    await this.tenantRepo
      .createQueryBuilder()
      .update(Tenant)
      .set({ requestDetails: () => `request_details || :patch::jsonb` })
      .where('id = :id', { id: tenant.id, patch: JSON.stringify(patch) })
      .execute();
    const fresh = await this.tenantRepo.findOneByOrFail({ id: tenant.id });
    const merged = fresh.requestDetails as unknown as ChurchRequestDetails;
    if (!merged.adminEmailConfirmedAt || !merged.contactEmailConfirmedAt) {
      return { status: fresh.onboardingStatus, name: fresh.name };
    }
    return this.release(fresh);
  }

  async review(tenant: Tenant): Promise<ChurchRequestReview> {
    const details =
      tenant.requestDetails as unknown as ChurchRequestDetails | null;
    return {
      orgType: tenant.orgType,
      details,
      checks: {
        bothEmailsConfirmed:
          !!details?.adminEmailConfirmedAt &&
          !!details?.contactEmailConfirmedAt,
        emailMatchesWebsite: emailMatchesWebsite(
          details?.contactEmail,
          details?.website,
        ),
        personalEmail: isPersonalEmail(details?.contactEmail),
        socialPageOnly: isSocialPage(details?.website),
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

  private async release(
    tenant: Tenant,
  ): Promise<{ status: TenantOnboardingStatus; name: string }> {
    const pending = tenant.pendingSignupParams as unknown as PendingParams;
    const clean = await this.passesAutoApproval(tenant);
    if (!clean && (await this.settingsService.getSelfServeRequiresApproval())) {
      const moved = await this.tenantRepo.update(
        {
          id: tenant.id,
          onboardingStatus: TenantOnboardingStatus.AWAITING_CONFIRMATION,
        },
        { onboardingStatus: TenantOnboardingStatus.AWAITING_APPROVAL },
      );
      // Only the request that made the move tells the reviewers.
      if (moved.affected) {
        await this.provisioningService.holdForApproval(tenant, pending);
      }
      return {
        status: TenantOnboardingStatus.AWAITING_APPROVAL,
        name: tenant.name,
      };
    }
    const moved = await this.tenantRepo.update(
      {
        id: tenant.id,
        onboardingStatus: TenantOnboardingStatus.AWAITING_CONFIRMATION,
      },
      { onboardingStatus: TenantOnboardingStatus.PENDING },
    );
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

  private async passesAutoApproval(tenant: Tenant): Promise<boolean> {
    if (!(await this.settingsService.getSelfServeAutoApprove())) return false;
    const { checks } = await this.review(tenant);
    return (
      checks.bothEmailsConfirmed &&
      checks.emailMatchesWebsite &&
      !checks.personalEmail &&
      !checks.possibleDuplicates.length
    );
  }

  private sendConfirmations(
    tenantId: string,
    churchName: string,
    details: ChurchRequestDetails,
  ): void {
    const emails = new Map<string, boolean>();
    if (!details.adminEmailConfirmedAt) emails.set(details.adminEmail, false);
    if (!details.contactEmailConfirmedAt) {
      emails.set(
        details.contactEmail,
        details.contactEmail !== details.adminEmail,
      );
    }
    const baseUrl = this.configService.get<string>('WEB_APP_URL');
    for (const [email, isChurchAddress] of emails) {
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
        `Confirm your email to continue with ${churchName}`,
        'church-request-confirm',
        {
          organisation_name: churchName,
          is_church_address: isChurchAddress,
          confirm_url: `${baseUrl}/signup/confirm?token=${token}`,
        },
      );
    }
    this.logger.log(`Sent ${emails.size} confirmation(s) for ${tenantId}`);
  }
}
