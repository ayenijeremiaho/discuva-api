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

@Injectable()
export class TenantAssetService {
  constructor(
    @InjectRepository(TenantAssetOverride)
    private readonly overrideRepo: Repository<TenantAssetOverride>,
    private readonly cloudinaryService: CloudinaryService,
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

    if (previousPublicId) {
      this.cloudinaryService.deleteByPublicId(previousPublicId, 'image');
    }

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
      this.cloudinaryService.deleteByPublicId(existing.imagePublicId, 'image');
    }

    return this.getOverrides(tenantId);
  }

  private assertKnownKey(assetKey: string): asserts assetKey is KnownAssetKey {
    if (!KNOWN_ASSETS.some((a) => a.key === assetKey)) {
      throw new BadRequestException(`Unknown asset key "${assetKey}"`);
    }
  }
}
