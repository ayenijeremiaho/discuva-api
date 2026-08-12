import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server';
import { MemberWebauthnCredential } from '../../member/entity/member-webauthn-credential.entity';
import { MemberService } from '../../member/service/member.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';

export interface WebauthnCredentialSummary {
  id: string;
  deviceName: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

const CHALLENGE_TTL_SECONDS = 300;

// Biometric login (Face ID / Touch ID / fingerprint / Windows Hello) via the
// browser's WebAuthn API — deliberately usernameless/discoverable
// (residentKey: 'required'): the one-tap login flow has no email to look a
// member up by, the device/OS resolves which credential to use. Each
// registered credential is a full alternative to a password for that one
// device, not subject to the existing single-`deviceId` password lock
// (AuthService.login) — that lock's threat model (shared/leaked passwords)
// doesn't apply to a hardware-bound private key that never leaves the
// device, and the whole point of allowing several credentials per member is
// several trusted devices at once.
@Injectable()
export class WebauthnService {
  constructor(
    @InjectRepository(MemberWebauthnCredential)
    private readonly credentialRepo: Repository<MemberWebauthnCredential>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly memberService: MemberService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly auditLogService: AuditLogService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  // Fixed platform-wide base domain, never the tenant subdomain — WebAuthn
  // allows an RP ID that's a registrable-domain suffix of the current
  // origin, so a credential registered on church-a.<base> still validates
  // when asserted from church-a.<base> (the origin itself still has to
  // match exactly, checked separately via expectedOrigin).
  private get rpID(): string {
    return this.configService.get<string>('APP_BASE_DOMAIN') ?? 'localhost';
  }

  // Personalizes the OS-level prompt with the member's own church name
  // where possible ("Sign in to First Baptist Church"), matching every
  // other per-tenant-branded surface in this app — falls back to the
  // platform name if the tenant lookup comes back empty for any reason.
  private async rpName(): Promise<string> {
    const tenantId = this.cls.get('tenantId');
    if (tenantId) {
      const tenant = await this.tenantRepo.findOne({
        where: { id: tenantId },
      });
      if (tenant?.name) return tenant.name;
    }
    return this.configService.get<string>('PRODUCT_NAME') ?? 'Discuva';
  }

  private challengeKey(id: string): string {
    return this.cacheService.key('webauthn_challenge', id);
  }

  private deviceNameFromUserAgent(userAgent: string | undefined): string {
    if (!userAgent) return 'Unknown device';
    if (/iPhone/i.test(userAgent)) return 'iPhone';
    if (/iPad/i.test(userAgent)) return 'iPad';
    if (/Android/i.test(userAgent)) return 'Android device';
    if (/Macintosh/i.test(userAgent)) return 'Mac';
    if (/Windows/i.test(userAgent)) return 'Windows PC';
    return 'Unknown device';
  }

  // ─── Registration (member already authenticated) ─────────────────────

  async generateRegistrationOptions(
    memberId: string,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const [member, existing] = await Promise.all([
      this.memberService.getById(memberId),
      this.credentialRepo.find({ where: { memberId } }),
    ]);

    const options = await generateRegistrationOptions({
      rpName: await this.rpName(),
      rpID: this.rpID,
      userName: member.email,
      userID: Buffer.from(memberId, 'utf8'),
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: c.transports as AuthenticatorTransportFuture[],
      })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
    });

    await this.cacheService.set(
      this.challengeKey(memberId),
      options.challenge,
      CHALLENGE_TTL_SECONDS,
    );
    return options;
  }

  async verifyRegistrationResponse(
    memberId: string,
    response: RegistrationResponseJSON,
    origin: string,
    userAgent: string | undefined,
  ): Promise<void> {
    const expectedChallenge = await this.cacheService.get<string>(
      this.challengeKey(memberId),
    );
    if (!expectedChallenge) {
      throw new BadRequestException(
        'Registration challenge expired — please try again.',
      );
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: this.rpID,
    });
    this.cacheService.del(this.challengeKey(memberId));

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException(
        'Could not verify this device — please try again.',
      );
    }

    const { credential } = verification.registrationInfo;
    const deviceName = this.deviceNameFromUserAgent(userAgent);
    await this.credentialRepo.save(
      this.credentialRepo.create({
        memberId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64'),
        counter: credential.counter,
        transports: credential.transports ?? [],
        deviceName,
      }),
    );
    this.auditLogService.log('MEMBER_WEBAUTHN_CREDENTIAL_REGISTERED', {
      targetId: memberId,
      metadata: { deviceName },
    });
  }

  // ─── Login (member not yet known — discoverable credential) ──────────

  async generateAuthenticationOptions(): Promise<{
    challengeId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }> {
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: 'required',
      // allowCredentials omitted deliberately — this is what makes the
      // browser/OS show every matching resident credential for this RP ID
      // and let the user pick via Face ID/Touch ID directly, no email typed.
    });

    const challengeId = randomUUID();
    await this.cacheService.set(
      this.challengeKey(challengeId),
      options.challenge,
      CHALLENGE_TTL_SECONDS,
    );
    return { challengeId, options };
  }

  // Returns the resolved memberId on success — the caller (AuthService)
  // still runs the same active/status checks the password path does before
  // issuing tokens; this method only proves "this device holds a
  // previously-registered credential," not "this member may currently log
  // in."
  async verifyAuthenticationResponse(
    challengeId: string,
    response: AuthenticationResponseJSON,
    origin: string,
  ): Promise<string> {
    const expectedChallenge = await this.cacheService.get<string>(
      this.challengeKey(challengeId),
    );
    if (!expectedChallenge) {
      throw new UnauthorizedException(
        'Login challenge expired — please try again.',
      );
    }
    this.cacheService.del(this.challengeKey(challengeId));

    const stored = await this.credentialRepo.findOne({
      where: { credentialId: response.id },
    });
    if (!stored) {
      throw new UnauthorizedException(
        'This device is not registered for biometric login.',
      );
    }

    const credential: WebAuthnCredential = {
      id: stored.credentialId,
      publicKey: new Uint8Array(Buffer.from(stored.publicKey, 'base64')),
      counter: Number(stored.counter),
      transports: stored.transports as AuthenticatorTransportFuture[],
    };

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: this.rpID,
      credential,
    });
    if (!verification.verified) {
      throw new UnauthorizedException('Could not verify this device.');
    }

    stored.counter = verification.authenticationInfo.newCounter;
    stored.lastUsedAt = new Date();
    await this.credentialRepo.save(stored);

    return stored.memberId;
  }

  // ─── Device management ────────────────────────────────────────────────

  async listCredentials(
    memberId: string,
  ): Promise<WebauthnCredentialSummary[]> {
    const rows = await this.credentialRepo.find({
      where: { memberId },
      order: { createdAt: 'DESC' },
    });
    // Never returns credentialId/publicKey — those aren't secrets exactly,
    // but they're not something the client needs back either.
    return rows.map((r) => ({
      id: r.id,
      deviceName: r.deviceName,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
    }));
  }

  async removeCredential(memberId: string, id: string): Promise<void> {
    const result = await this.credentialRepo.delete({ id, memberId });
    if (result.affected === 0) {
      throw new NotFoundException('Device not found.');
    }
    this.auditLogService.log('MEMBER_WEBAUTHN_CREDENTIAL_REMOVED', {
      targetId: memberId,
      metadata: { credentialRowId: id },
    });
  }
}
