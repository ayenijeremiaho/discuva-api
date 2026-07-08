import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MemberSession } from '../entity/member-session.entity';
import { SessionSurface } from '../../auth/enum/session-surface.enum';

@Injectable()
export class MemberSessionService {
  private readonly logger = new Logger(MemberSessionService.name);

  constructor(
    @InjectRepository(MemberSession)
    private readonly sessionRepository: Repository<MemberSession>,
  ) {}

  async updateLogin(
    memberId: string,
    hashedRefreshToken: string,
    surface: SessionSurface,
  ): Promise<void> {
    const existing = await this.sessionRepository.findOne({
      where: { member: { id: memberId }, surface },
    });

    if (existing) {
      existing.hashedRefreshToken = hashedRefreshToken;
      existing.lastLogin = new Date();
      existing.lastLogout = null;
      await this.sessionRepository.save(existing);
    } else {
      await this.sessionRepository.save(
        this.sessionRepository.create({
          member: { id: memberId },
          hashedRefreshToken,
          lastLogin: new Date(),
          surface,
        }),
      );
    }
    this.logger.log(`Login session recorded: member ${memberId} [${surface}]`);
  }

  async updateLogout(memberId: string, surface: SessionSurface): Promise<void> {
    const session = await this.sessionRepository.findOne({
      where: { member: { id: memberId }, surface },
    });
    if (session) {
      session.hashedRefreshToken = null;
      session.lastLogout = new Date();
      await this.sessionRepository.save(session);
      this.logger.log(
        `Logout session cleared: member ${memberId} [${surface}]`,
      );
    } else {
      this.logger.warn(
        `Logout: no active session found for member ${memberId} [${surface}]`,
      );
    }
  }

  async getSession(
    memberId: string,
    surface: SessionSurface,
  ): Promise<MemberSession | null> {
    return this.sessionRepository.findOne({
      where: { member: { id: memberId }, surface },
    });
  }

  async getHashedRefreshToken(
    memberId: string,
    surface: SessionSurface,
  ): Promise<string | null> {
    const session = await this.getSession(memberId, surface);
    return session?.hashedRefreshToken ?? null;
  }
}
