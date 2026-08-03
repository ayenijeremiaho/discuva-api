import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PlatformAdmin } from '../entity/platform-admin.entity';
import { PlatformAdminRoleService } from '../service/platform-admin-role.service';

// Mirrors src/admin/seed/default-admin.seed.ts exactly — same env-var-driven,
// idempotent, argon2-hash-only shape — but for the platform-admin identity
// system, which had no bootstrap path at all before this (the only way to
// create the very first platform admin was a hand-written SQL insert).
// Run via `npm run seed:platform-admin` (scripts/hash-password.ts, already
// generic, produces the hash for DEFAULT_PLATFORM_ADMIN_PASSWORD_HASH).
@Injectable()
export class DefaultPlatformAdminSeed {
  private readonly logger = new Logger(DefaultPlatformAdminSeed.name);

  constructor(
    @InjectRepository(PlatformAdmin)
    private readonly platformAdminRepo: Repository<PlatformAdmin>,
    private readonly roleService: PlatformAdminRoleService,
    private readonly configService: ConfigService,
  ) {}

  async run(): Promise<void> {
    const email = this.configService.get<string>(
      'DEFAULT_PLATFORM_ADMIN_EMAIL',
    );
    const passwordHash = this.configService.get<string>(
      'DEFAULT_PLATFORM_ADMIN_PASSWORD_HASH',
    );

    if (!email || !passwordHash) {
      this.logger.warn(
        'DEFAULT_PLATFORM_ADMIN_EMAIL or DEFAULT_PLATFORM_ADMIN_PASSWORD_HASH not set — skipping platform admin seed',
      );
      return;
    }

    if (!passwordHash.startsWith('$argon2')) {
      this.logger.error(
        'DEFAULT_PLATFORM_ADMIN_PASSWORD_HASH does not look like a valid argon2 hash — aborting seed',
      );
      return;
    }

    const anyAdminExists = await this.platformAdminRepo.existsBy({});
    if (anyAdminExists) {
      this.logger.log('Platform admin records already exist — skipping seed');
      return;
    }

    const superAdminRole = await this.roleService.findOrCreateSuperAdmin();

    await this.platformAdminRepo.save(
      this.platformAdminRepo.create({
        email: email.toLowerCase().trim(),
        passwordHash,
        isActive: true,
        platformAdminRole: superAdminRole,
      }),
    );

    this.logger.log(
      `Default platform admin (${email}) seeded with SuperAdmin role`,
    );
  }
}
