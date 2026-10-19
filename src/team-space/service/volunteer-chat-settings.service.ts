import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TeamSpace } from '../entity/team-space.entity';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import {
  VOLUNTEER_SPACE_LISTED_DAYS,
  VOLUNTEER_SPACE_OPEN_DAYS,
} from '../constant/team-space.constant';

export const VOLUNTEER_CHAT_SETTINGS_KEY = 'volunteering:chat';
export const MAX_OPEN_DAYS = 30;
export const MAX_LISTED_DAYS = 90;

export interface VolunteerChatSettings {
  // Days after the event the chat still takes posts, replies and votes.
  openDays: number;
  // Days after the event the chat stays in members' lists.
  listedDays: number;
}

// How long volunteering chats last, set per church on the admin Volunteering page.
@Injectable()
export class VolunteerChatSettingsService {
  constructor(
    @InjectRepository(TeamSpace)
    private readonly spaceRepo: Repository<TeamSpace>,
    private readonly cacheService: CacheService,
    private readonly audit: AuditLogService,
  ) {}

  async get(): Promise<VolunteerChatSettings> {
    const cached = await this.cacheService.get<VolunteerChatSettings>(
      VOLUNTEER_CHAT_SETTINGS_KEY,
    );
    if (cached) return cached;
    const rows = (await this.spaceRepo.query(
      `SELECT value FROM church_settings WHERE key = $1`,
      [VOLUNTEER_CHAT_SETTINGS_KEY],
    )) as { value: Partial<VolunteerChatSettings> }[];
    const value = rows[0]?.value ?? {};
    const settings = {
      openDays:
        typeof value.openDays === 'number'
          ? value.openDays
          : VOLUNTEER_SPACE_OPEN_DAYS,
      listedDays:
        typeof value.listedDays === 'number'
          ? value.listedDays
          : VOLUNTEER_SPACE_LISTED_DAYS,
    };
    this.cacheService.set(VOLUNTEER_CHAT_SETTINGS_KEY, settings, 600);
    return settings;
  }

  async save(input: VolunteerChatSettings, actorMemberId?: string) {
    if (input.listedDays < input.openDays)
      throw new BadRequestException(
        'Keep the chat listed at least as long as it stays open.',
      );
    await this.spaceRepo.query(
      `INSERT INTO church_settings (key, module_name, value) VALUES ($1, 'Volunteering', $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [VOLUNTEER_CHAT_SETTINGS_KEY, JSON.stringify(input)],
    );
    this.cacheService.del(VOLUNTEER_CHAT_SETTINGS_KEY);
    this.audit.log('VOLUNTEER_CHAT_SETTINGS_UPDATED', {
      actorId: actorMemberId,
      targetId: VOLUNTEER_CHAT_SETTINGS_KEY,
      metadata: { ...input },
    });
    return input;
  }
}
