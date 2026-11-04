import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, QueryFailedError, Repository } from 'typeorm';
import { ProtectedName } from './protected-name.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { OrganisationTypeEnum } from '../tenant/enum/organisation-type.enum';
import { CacheService } from '../utility/service/cache.service';
import { SaveProtectedNameDto } from './protected-name.dto';
import {
  ProtectedEntry,
  addressMatches,
  nameMatches,
} from './protected-name.match';

const CACHE_KEY = 'protected-names:v1';
const CACHE_SECONDS = 600;

interface Protection {
  listed: ProtectedEntry[];
  verifiedChurches: (ProtectedEntry & { tenantId: string })[];
}

@Injectable()
export class ProtectedNameService {
  constructor(
    @InjectRepository(ProtectedName)
    private readonly repo: Repository<ProtectedName>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly cacheService: CacheService,
  ) {}

  // Returns the protected name a candidate looks like, so a person can check it. Verified churches are protected too.
  async findNameMatch(
    name: string,
    exceptTenantId?: string,
  ): Promise<string | null> {
    const { listed, verifiedChurches } = await this.protection();
    const hit =
      listed.find((entry) => nameMatches(name, entry)) ??
      verifiedChurches.find(
        (entry) =>
          entry.tenantId !== exceptTenantId && nameMatches(name, entry),
      );
    return hit?.name ?? null;
  }

  async isReservedAddress(address: string): Promise<boolean> {
    const { listed } = await this.protection();
    return listed.some((entry) => addressMatches(address, entry));
  }

  list(): Promise<ProtectedName[]> {
    return this.repo.find({ order: { name: 'ASC' } });
  }

  async create(
    dto: SaveProtectedNameDto,
    actorId: string,
  ): Promise<ProtectedName> {
    return this.save(this.repo.create(), dto, actorId);
  }

  async update(
    id: string,
    dto: SaveProtectedNameDto,
    actorId: string,
  ): Promise<ProtectedName> {
    const entry = await this.repo.findOneBy({ id });
    if (!entry) throw new NotFoundException('Protected name not found');
    return this.save(entry, dto, actorId);
  }

  async remove(id: string): Promise<void> {
    const { affected } = await this.repo.delete({ id });
    if (!affected) throw new NotFoundException('Protected name not found');
    this.cacheService.delGlobal(CACHE_KEY);
  }

  private async save(
    entry: ProtectedName,
    dto: SaveProtectedNameDto,
    actorId: string,
  ): Promise<ProtectedName> {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Enter the name to protect.');
    entry.name = name;
    entry.shortForms = tidy(dto.shortForms);
    entry.addresses = tidy(dto.addresses);
    entry.note = dto.note?.trim() || null;
    entry.updatedById = actorId;
    try {
      const saved = await this.repo.save(entry);
      this.cacheService.delGlobal(CACHE_KEY);
      return saved;
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        /UQ_protected_names_name/.test(err.message)
      ) {
        throw new ConflictException('That name is already protected.');
      }
      throw err;
    }
  }

  private async protection(): Promise<Protection> {
    const cached = await this.cacheService.getGlobal<Protection>(CACHE_KEY);
    if (cached) return cached;
    const [listed, churches] = await Promise.all([
      this.repo.find({
        select: { name: true, shortForms: true, addresses: true },
      }),
      this.tenantRepo.find({
        select: { id: true, name: true },
        where: {
          verifiedAt: Not(IsNull()),
          orgType: OrganisationTypeEnum.CHURCH,
          isActive: true,
        },
      }),
    ]);
    const protection: Protection = {
      listed: listed.map(({ name, shortForms, addresses }) => ({
        name,
        shortForms,
        addresses,
      })),
      verifiedChurches: churches.map((t) => ({
        tenantId: t.id,
        name: t.name,
        shortForms: [],
        addresses: [],
      })),
    };
    this.cacheService.setGlobal(CACHE_KEY, protection, CACHE_SECONDS);
    return protection;
  }
}

const tidy = (values: string[] | undefined): string[] => [
  ...new Set((values ?? []).map((v) => v.trim().toLowerCase()).filter(Boolean)),
];
