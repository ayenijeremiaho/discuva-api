import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformSetting } from '../platform-admin/entity/platform-setting.entity';
import { AccountTypeChange } from './account-type-change.entity';
import { OrganisationTypeEnum } from '../tenant/enum/organisation-type.enum';
import { KNOWN_MODULES } from '../church-settings/constants/known-modules.constant';
import {
  ACCOUNT_TERMS,
  ModuleAvailability,
  defaultAvailability,
} from './account-type.constant';
import { UpdateAccountTypeDto } from './account-type.dto';
import {
  AccountTypeService,
  StoredProfile,
  accountTypeStorageKey,
} from './account-type.service';

const MAX_TERM_LENGTH = 40;
const RECENT_CHANGES = 20;
const LABELS: Record<OrganisationTypeEnum, string> = {
  [OrganisationTypeEnum.CHURCH]: 'Church',
  [OrganisationTypeEnum.MINISTRY]: 'NGO or nonprofit',
  [OrganisationTypeEnum.GROUP]: 'Small group',
};
const AVAILABILITY: ModuleAvailability[] = ['on', 'off', 'hidden'];

// Console side: edits the dictionary and features, keeping a record of who changed what.
@Injectable()
export class AccountTypeAdminService {
  constructor(
    @InjectRepository(PlatformSetting)
    private readonly settingRepo: Repository<PlatformSetting>,
    private readonly accountTypes: AccountTypeService,
    @InjectRepository(AccountTypeChange)
    private readonly changeRepo: Repository<AccountTypeChange>,
  ) {}

  async listForConsole() {
    return Promise.all(
      Object.values(OrganisationTypeEnum).map((type) => this.view(type)),
    );
  }

  private async view(type: OrganisationTypeEnum) {
    const profile = await this.accountTypes.getProfile(type);
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

  async update(
    type: OrganisationTypeEnum,
    dto: UpdateAccountTypeDto,
    actorId: string,
  ) {
    this.assertValid(dto);
    let row = await this.settingRepo.findOne({
      where: { key: accountTypeStorageKey(type) },
    });
    const current = (row?.value ?? {}) as StoredProfile;
    const value = {
      terms: { ...current.terms, ...dto.terms },
      modules: { ...current.modules, ...dto.modules },
      signupOpen: dto.signupOpen ?? current.signupOpen,
    };
    if (row) row.value = value;
    else
      row = this.settingRepo.create({
        key: accountTypeStorageKey(type),
        value,
      });
    await this.settingRepo.manager.transaction(async (tx) => {
      await tx.save(row);
      await tx.save(
        tx.create(AccountTypeChange, {
          accountType: type,
          actorId,
          changes: { ...dto },
        }),
      );
    });
    this.accountTypes.clearCache(type);
    return this.view(type);
  }

  async recentChanges(type: OrganisationTypeEnum) {
    const rows = await this.changeRepo.find({
      where: { accountType: type },
      relations: { actor: true },
      order: { createdAt: 'DESC' },
      take: RECENT_CHANGES,
    });
    return rows.map((r) => ({
      id: r.id,
      at: r.createdAt,
      by: r.actor?.email ?? null,
      changes: r.changes,
    }));
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
