import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformSetting } from '../platform-admin/entity/platform-setting.entity';
import { CacheService } from '../utility/service/cache.service';
import { OrganisationTypeEnum } from '../tenant/enum/organisation-type.enum';
import { KNOWN_MODULES } from '../church-settings/constants/known-modules.constant';
import {
  ACCOUNT_TERMS,
  ModuleAvailability,
  PROTECTED_PHRASES,
  SIGNUP_OPEN_BY_DEFAULT,
  Term,
  defaultAvailability,
} from './account-type.constant';
import { WordingRule } from './apply-wording';
import { UpdateAccountTypeDto } from './account-type.dto';

const CACHE_TTL_SECONDS = 300;
const MAX_TERM_LENGTH = 40;
const LABELS: Record<OrganisationTypeEnum, string> = {
  [OrganisationTypeEnum.CHURCH]: 'Church',
  [OrganisationTypeEnum.MINISTRY]: 'NGO or nonprofit',
  [OrganisationTypeEnum.GROUP]: 'Small group',
};
const AVAILABILITY: ModuleAvailability[] = ['on', 'off', 'hidden'];

interface StoredProfile {
  terms?: Record<string, Term>;
  modules?: Record<string, ModuleAvailability>;
  signupOpen?: boolean;
}
export interface AccountTypeProfile {
  signupOpen: boolean;
  terms: Record<string, Term>;
  modules: Record<string, ModuleAvailability>;
  wording: WordingRule[];
}

const storageKey = (type: OrganisationTypeEnum) => `account_type:${type}`;

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

// Each account type's dictionary and feature availability. Read live, so a change reaches every account of the type.
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
      where: { key: storageKey(type) },
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

  async listForConsole() {
    return Promise.all(
      Object.values(OrganisationTypeEnum).map((type) => this.view(type)),
    );
  }

  private async view(type: OrganisationTypeEnum) {
    const profile = await this.getProfile(type);
    const defaults = defaultAvailability(type);
    return {
      type,
      label: LABELS[type],
      signupOpen: profile.signupOpen,
      terms: ACCOUNT_TERMS.map((t) => ({
        key: t.key,
        label: t.label,
        source: t.words[OrganisationTypeEnum.CHURCH],
        value: profile.terms[t.key],
        suggested: t.words[type],
      })),
      modules: KNOWN_MODULES.map((m) => ({
        key: m.key,
        name: m.moduleName,
        availability: profile.modules[m.key],
        suggested: defaults[m.key],
      })),
    };
  }

  async update(type: OrganisationTypeEnum, dto: UpdateAccountTypeDto) {
    this.assertValid(dto);
    let row = await this.settingRepo.findOne({
      where: { key: storageKey(type) },
    });
    const current = (row?.value ?? {}) as StoredProfile;
    const value = {
      terms: { ...current.terms, ...dto.terms },
      modules: { ...current.modules, ...dto.modules },
      signupOpen: dto.signupOpen ?? current.signupOpen,
    };
    if (row) row.value = value;
    else row = this.settingRepo.create({ key: storageKey(type), value });
    await this.settingRepo.save(row);
    this.cacheService.delGlobal(this.cacheKey(type));
    return this.view(type);
  }

  private assertValid(dto: UpdateAccountTypeDto): void {
    const termKeys = new Set(ACCOUNT_TERMS.map((t) => t.key));
    for (const [key, term] of Object.entries(dto.terms ?? {})) {
      const clean = [term?.one, term?.many].every(
        (w) =>
          typeof w === 'string' &&
          w.trim().length > 0 &&
          w.length <= MAX_TERM_LENGTH &&
          !/[<>{}]/.test(w),
      );
      if (!termKeys.has(key) || !clean) {
        throw new BadRequestException(`Check the wording for '${key}'.`);
      }
    }
    const moduleKeys = new Set<string>(KNOWN_MODULES.map((m) => m.key));
    for (const [key, state] of Object.entries(dto.modules ?? {})) {
      if (!moduleKeys.has(key) || !AVAILABILITY.includes(state)) {
        throw new BadRequestException(`Check the setting for '${key}'.`);
      }
    }
  }
}
