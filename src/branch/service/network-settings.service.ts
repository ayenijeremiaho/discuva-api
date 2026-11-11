import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CacheService } from '../../utility/service/cache.service';
import { NetworkSettings } from '../entity/network-settings.entity';
import {
  NETWORK_SETTING_LIMITS,
  NetworkSettingsValues,
} from '../report/network-settings.constants';

const TTL_SECONDS = 600;
const key = (rootId: string) => `network-settings:${rootId}`;

export interface NetworkSettingsView {
  values: NetworkSettingsValues;
  limits: typeof NETWORK_SETTING_LIMITS;
}

@Injectable()
export class NetworkSettingsService {
  constructor(
    @InjectRepository(NetworkSettings)
    private readonly repo: Repository<NetworkSettings>,
    private readonly cache: CacheService,
  ) {}

  async get(rootId: string): Promise<NetworkSettingsValues> {
    const cached = await this.cache.getGlobal<NetworkSettingsValues>(
      key(rootId),
    );
    if (cached) return cached;
    const row = await this.repo.findOne({ where: { networkRootId: rootId } });
    const values = this.withDefaults(row?.settings ?? {});
    this.cache.setGlobal(key(rootId), values, TTL_SECONDS);
    return values;
  }

  async view(rootId: string): Promise<NetworkSettingsView> {
    return { values: await this.get(rootId), limits: NETWORK_SETTING_LIMITS };
  }

  // Owners of the top church only; every value is kept inside the platform's range.
  async update(
    rootId: string,
    isTopOwner: boolean,
    patch: Partial<NetworkSettingsValues>,
  ): Promise<NetworkSettingsView> {
    if (!isTopOwner) {
      throw new ForbiddenException(
        'Only owners of the top church can change network settings.',
      );
    }
    const current = await this.get(rootId);
    const next = { ...current };
    for (const [name, value] of Object.entries(patch) as [
      keyof NetworkSettingsValues,
      number,
    ][]) {
      const limit = NETWORK_SETTING_LIMITS[name];
      if (!limit) throw new BadRequestException(`Unknown setting: ${name}`);
      if (!Number.isInteger(value) || value < limit.min || value > limit.max) {
        throw new BadRequestException(
          `${limit.label} must be between ${limit.min} and ${limit.max}.`,
        );
      }
      next[name] = value;
    }
    await this.repo.upsert({ networkRootId: rootId, settings: next }, [
      'networkRootId',
    ]);
    await this.cache.delGlobal(key(rootId));
    return { values: next, limits: NETWORK_SETTING_LIMITS };
  }

  private withDefaults(
    saved: Partial<NetworkSettingsValues>,
  ): NetworkSettingsValues {
    return Object.fromEntries(
      Object.entries(NETWORK_SETTING_LIMITS).map(([name, limit]) => {
        const v = saved[name as keyof NetworkSettingsValues];
        return [
          name,
          typeof v === 'number'
            ? Math.min(limit.max, Math.max(limit.min, v))
            : limit.default,
        ];
      }),
    ) as unknown as NetworkSettingsValues;
  }
}
