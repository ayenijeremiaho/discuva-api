import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformSetting } from '../platform-admin/entity/platform-setting.entity';
import { CacheService } from '../utility/service/cache.service';
import { OrganisationTypeEnum } from '../tenant/enum/organisation-type.enum';
import {
  ACCOUNT_TERMS,
  ModuleAvailability,
  PROTECTED_PHRASES,
  SIGNUP_OPEN_BY_DEFAULT,
  Term,
  defaultAvailability,
  SWITCHABLE_CORE_MODULES,
} from './account-type.constant';
import { WordingRule } from './apply-wording';

const CACHE_TTL_SECONDS = 300;

export interface StoredProfile {
  terms?: Record<string, Term>;
  modules?: Record<string, ModuleAvailability>;
  signupOpen?: boolean;
}
export interface AccountTypeProfile {
  signupOpen: boolean;
  terms: Record<string, Term>;
  modules: Record<string, ModuleAvailability>;
  switchable: string[];
  wording: WordingRule[];
}

export const accountTypeStorageKey = (type: OrganisationTypeEnum) =>
  `account_type:${type}`;

// The word rules the apps and emails apply, in source (church) wording order. Unchanged words are left out.
function wordingRules(terms: Record<string, Term>): WordingRule[] {
  const rules: WordingRule[] = [];
  for (const entry of ACCOUNT_TERMS) {
    const source = entry.words[OrganisationTypeEnum.CHURCH];
    const target = terms[entry.key];
    if (source.one === target.one && source.many === target.many) continue;
    for (const from of [source, ...(entry.also ?? [])]) {
      rules.push({ from: from.many, to: target.many });
      rules.push({ from: from.one, to: target.one });
    }
  }
  if (!rules.length) return [];
  return [
    ...PROTECTED_PHRASES.map((phrase) => ({ from: phrase, to: phrase })),
    ...rules,
  ];
}

// Read side, used on send paths: keep it free of audit logging, which depends on email and would form an import cycle.
// Read live, so a change reaches every account of the type.
@Injectable()
export class AccountTypeService {
  constructor(
    @InjectRepository(PlatformSetting)
    private readonly settingRepo: Repository<PlatformSetting>,
    private readonly cacheService: CacheService,
  ) {}

  private cacheKey(type: OrganisationTypeEnum) {
    return `account-type-profile:${type}`;
  }

  clearCache(type: OrganisationTypeEnum): void {
    this.cacheService.delGlobal(this.cacheKey(type));
  }

  private build(
    type: OrganisationTypeEnum,
    stored?: StoredProfile,
  ): AccountTypeProfile {
    const terms = Object.fromEntries(
      ACCOUNT_TERMS.map((t) => [
        t.key,
        stored?.terms?.[t.key] ?? t.words[type],
      ]),
    );
    return {
      signupOpen: stored?.signupOpen ?? SIGNUP_OPEN_BY_DEFAULT[type],
      terms,
      modules: { ...defaultAvailability(type), ...stored?.modules },
      switchable: SWITCHABLE_CORE_MODULES[type],
      wording: wordingRules(terms),
    };
  }

  async wordingFor(type: OrganisationTypeEnum): Promise<WordingRule[]> {
    return (await this.getProfile(type)).wording;
  }

  async getProfile(type: OrganisationTypeEnum): Promise<AccountTypeProfile> {
    const cached = await this.cacheService.getGlobal<AccountTypeProfile>(
      this.cacheKey(type),
    );
    if (cached) return cached;
    const row = await this.settingRepo.findOne({
      where: { key: accountTypeStorageKey(type) },
    });
    const profile = this.build(type, row?.value as StoredProfile | undefined);
    this.cacheService.setGlobal(
      this.cacheKey(type),
      profile,
      CACHE_TTL_SECONDS,
    );
    return profile;
  }

  async openSignupTypes(): Promise<OrganisationTypeEnum[]> {
    const types = Object.values(OrganisationTypeEnum);
    const profiles = await Promise.all(types.map((t) => this.getProfile(t)));
    return types.filter((_, i) => profiles[i].signupOpen);
  }
}
