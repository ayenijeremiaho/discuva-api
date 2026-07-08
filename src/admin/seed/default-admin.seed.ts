import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Admin } from '../entity/admin.entity';
import { AdminRoleService } from '../service/admin-role.service';
import { Member } from '../../member/entity/member.entity';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';

@Injectable()
export class DefaultAdminSeed {
  private readonly logger = new Logger(DefaultAdminSeed.name);

  constructor(
    @InjectRepository(Member)
    private readonly memberRepository: Repository<Member>,
    @InjectRepository(Admin)
    private readonly adminRepository: Repository<Admin>,
    private readonly adminRoleService: AdminRoleService,
    private readonly configService: ConfigService,
  ) {}

  async run(): Promise<void> {
    const adminEmail = this.configService.get<string>('DEFAULT_ADMIN_EMAIL');
    const passwordHash = this.configService.get<string>(
      'DEFAULT_ADMIN_PASSWORD_HASH',
    );

    if (!adminEmail || !passwordHash) {
      this.logger.warn(
        'DEFAULT_ADMIN_EMAIL or DEFAULT_ADMIN_PASSWORD_HASH not set — skipping admin seed',
      );
      return;
    }

    if (!passwordHash.startsWith('$argon2')) {
      this.logger.error(
        'DEFAULT_ADMIN_PASSWORD_HASH does not look like a valid argon2 hash — aborting seed',
      );
      return;
    }

    const anyAdminExists = await this.adminRepository.existsBy({});
    if (anyAdminExists) {
      this.logger.log('Admin records already exist — skipping seed');
      return;
    }

    const superAdminRole = await this.adminRoleService.findOrCreateSuperAdmin();

    let member = await this.memberRepository.findOneBy({ email: adminEmail });
    if (!member) {
      member = await this.memberRepository.save(
        this.memberRepository.create({
          firstname: 'Admin',
          lastname: 'User',
          email: adminEmail,
          password: passwordHash,
          role: MemberRoleEnum.MEMBER,
          status: MemberStatusEnum.ACTIVE,
          changedPassword: false,
        }),
      );
      this.logger.log('Default admin member created');
    }

    await this.adminRepository.save(
      this.adminRepository.create({
        member,
        adminRole: superAdminRole,
        isActive: true,
      }),
    );

    this.logger.log('Default admin seeded with SuperAdmin role');
  }
}
