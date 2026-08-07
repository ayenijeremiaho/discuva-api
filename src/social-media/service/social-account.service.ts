import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialAccount } from '../entity/social-account.entity';
import { CreateSocialAccountDto } from '../dto/social-media.dto';

@Injectable()
export class SocialAccountService {
  constructor(
    @InjectRepository(SocialAccount)
    private readonly accountRepo: Repository<SocialAccount>,
  ) {}

  // Registers an account the church intends to post to. isConnected stays
  // false until a real per-platform OAuth flow exists to actually earn it —
  // see publisher/social-platform-publisher.interface.ts.
  async create(dto: CreateSocialAccountDto): Promise<SocialAccount> {
    const account = this.accountRepo.create({
      platform: dto.platform,
      displayName: dto.displayName,
      isConnected: false,
    });
    return this.accountRepo.save(account);
  }

  async getAll(): Promise<SocialAccount[]> {
    return this.accountRepo.find({ order: { createdAt: 'DESC' } });
  }

  async delete(id: string): Promise<void> {
    const account = await this.accountRepo.findOneBy({ id });
    if (!account) throw new NotFoundException('Social account not found');
    await this.accountRepo.remove(account);
  }
}
