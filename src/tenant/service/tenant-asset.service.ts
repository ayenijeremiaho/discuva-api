import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantAssetOverride } from '../entity/tenant-asset-override.entity';
import { Tenant } from '../entity/tenant.entity';
import {
  KNOWN_ASSETS,
  KnownAssetKey,
} from '../constants/known-assets.constant';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import { CacheService } from '../../utility/service/cache.service';
import { isBranch } from '../util/network-branding';

const networkKey = (rootId: string) => `network-assets:${rootId}`;

@Injectable()
export class TenantAssetService {
  constructor(
    @InjectRepository(TenantAssetOverride)
    private readonly overrideRepo: Repository<TenantAssetOverride>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly cache: CacheService,
  ) {}

  getCatalog() {
    return KNOWN_ASSETS;
  }

  // { [assetKey]: imageUrl } for whatever's been overridden — never
  // includes keys with no override, since the caller (discuva-member)
  // already knows its own bundled defaults and only needs to know what to
  // replace them with.
  async getOverrides(tenantId: string): Promise<Record<string, string>> {
    const rows = await this.overrideRepo.find({
      where: { tenant: { id: tenantId } },
    });
    return Object.fromEntries(rows.map((r) => [r.assetKey, r.imageUrl]));
  }

  // What a church's screens show: a branch's own images over its network's. `fromNetwork` lists the keys it inherits.
  async forDisplay(
    tenant: Pick<Tenant, 'id' | 'networkRootId'>,
  ): Promise<{ assets: Record<string, string>; fromNetwork: string[] }> {
    const own = await this.getOverrides(tenant.id);
    if (!isBranch(tenant)) return { assets: own, fromNetwork: [] };
    const rootId = tenant.networkRootId!;
    let network = await this.cache.getGlobal<Record<string, string>>(
      networkKey(rootId),
    );
    if (!network) {
      network = await this.getOverrides(rootId);
      this.cache.setGlobal(networkKey(rootId), network, 300);
    }
    return {
      assets: { ...network, ...own },
      fromNetwork: Object.keys(network).filter((k) => !(k in own)),
    };
  }

  async setOverride(
    tenantId: string,
    assetKey: string,
    file: Express.Multer.File,
  ): Promise<Record<string, string>> {
    this.assertKnownKey(assetKey);

    const existing = await this.overrideRepo.findOne({
      where: { tenant: { id: tenantId }, assetKey },
    });
    const previousPublicId = existing?.imagePublicId;

    const uploaded = await this.cloudinaryService.uploadBuffer(
      file.buffer,
      'tenant-assets',
      undefined,
      file.mimetype,
    );

    if (existing) {
      existing.imageUrl = uploaded.secureUrl;
      existing.imagePublicId = uploaded.publicId;
      await this.overrideRepo.save(existing);
    } else {
      await this.overrideRepo.save(
        this.overrideRepo.create({
          tenant: { id: tenantId } as Tenant,
          assetKey,
          imageUrl: uploaded.secureUrl,
          imagePublicId: uploaded.publicId,
        }),
      );
    }

    if (previousPublicId) await this.deleteIfUnused(previousPublicId);
    this.cache.delGlobal(networkKey(tenantId));

    return this.getOverrides(tenantId);
  }

  async removeOverride(
    tenantId: string,
    assetKey: string,
  ): Promise<Record<string, string>> {
    this.assertKnownKey(assetKey);

    const existing = await this.overrideRepo.findOne({
      where: { tenant: { id: tenantId }, assetKey },
    });
    if (existing) {
      await this.overrideRepo.remove(existing);
      await this.deleteIfUnused(existing.imagePublicId);
      this.cache.delGlobal(networkKey(tenantId));
    }

    return this.getOverrides(tenantId);
  }

  // Pages split from a shared image start with the same uploaded file, so only delete it once no key uses it.
  private async deleteIfUnused(publicId: string) {
    const stillUsed = await this.overrideRepo.count({
      where: { imagePublicId: publicId },
    });
    if (!stillUsed) this.cloudinaryService.deleteByPublicId(publicId, 'image');
  }

  private assertKnownKey(assetKey: string): asserts assetKey is KnownAssetKey {
    if (!KNOWN_ASSETS.some((a) => a.key === assetKey)) {
      throw new BadRequestException(`Unknown asset key "${assetKey}"`);
    }
  }
}
