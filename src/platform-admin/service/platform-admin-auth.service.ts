import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PlatformAdmin } from '../entity/platform-admin.entity';
import {
  PlatformAdminAuth,
  PlatformAdminJwtPayload,
} from '../interface/platform-admin-auth.interface';

@Injectable()
export class PlatformAdminAuthService {
  constructor(
    @InjectRepository(PlatformAdmin)
    private readonly platformAdminRepo: Repository<PlatformAdmin>,
    private readonly jwtService: JwtService,
  ) {}

  async validateById(id: string): Promise<PlatformAdminAuth> {
    const admin = await this.platformAdminRepo.findOneBy({
      id,
      isActive: true,
    });
    if (!admin) throw new UnauthorizedException();
    return { id: admin.id, email: admin.email, role: 'platform_admin' };
  }

  async login(
    email: string,
    password: string,
  ): Promise<{ accessToken: string }> {
    const admin = await this.platformAdminRepo
      .createQueryBuilder('admin')
      .addSelect('admin.passwordHash')
      .where('admin.email = :email', { email: email.toLowerCase().trim() })
      .andWhere('admin.isActive = true')
      .getOne();

    if (!admin || !(await argon2.verify(admin.passwordHash, password))) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const payload: PlatformAdminJwtPayload = {
      sub: admin.id,
      role: 'platform_admin',
    };
    return { accessToken: await this.jwtService.signAsync(payload) };
  }
}
