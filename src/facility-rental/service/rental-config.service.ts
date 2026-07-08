import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RentalFacility } from '../entity/rental-facility.entity';
import { RentalPricingTier } from '../entity/rental-pricing-tier.entity';
import { RentalAddon } from '../entity/rental-addon.entity';
import { RentalCalendarBlock } from '../entity/rental-calendar-block.entity';
import { Asset } from '../../asset-management/entity/asset.entity';
import {
  CreateRentalFacilityDto,
  UpdateRentalFacilityDto,
} from '../dto/rental-facility.dto';
import { UpsertRentalPricingTierDto } from '../dto/rental-pricing-tier.dto';
import {
  CreateRentalAddonDto,
  UpdateRentalAddonDto,
} from '../dto/rental-addon.dto';
import { CreateRentalCalendarBlockDto } from '../dto/rental-calendar-block.dto';

@Injectable()
export class RentalConfigService {
  private readonly logger = new Logger(RentalConfigService.name);

  constructor(
    @InjectRepository(RentalFacility)
    private readonly facilityRepo: Repository<RentalFacility>,
    @InjectRepository(RentalPricingTier)
    private readonly tierRepo: Repository<RentalPricingTier>,
    @InjectRepository(RentalAddon)
    private readonly addonRepo: Repository<RentalAddon>,
    @InjectRepository(RentalCalendarBlock)
    private readonly blockRepo: Repository<RentalCalendarBlock>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
  ) {}

  // ── Facilities ──────────────────────────────────────────────────────────────

  async createFacility(dto: CreateRentalFacilityDto): Promise<RentalFacility> {
    if (await this.facilityRepo.exists({ where: { name: dto.name } })) {
      throw new BadRequestException('A facility with this name already exists');
    }
    const facility = this.facilityRepo.create(dto);
    const saved = await this.facilityRepo.save(facility);
    this.logger.log(`Created facility "${saved.name}" (${saved.id})`);
    return saved;
  }

  async updateFacility(
    id: string,
    dto: UpdateRentalFacilityDto,
  ): Promise<RentalFacility> {
    const facility = await this.getFacilityById(id);
    if (dto.name && dto.name !== facility.name) {
      if (await this.facilityRepo.exists({ where: { name: dto.name } })) {
        throw new BadRequestException(
          'A facility with this name already exists',
        );
      }
    }
    Object.assign(facility, dto);
    return this.facilityRepo.save(facility);
  }

  async getFacilities(): Promise<RentalFacility[]> {
    return this.facilityRepo.find({ order: { name: 'ASC' } });
  }

  async getFacilityById(id: string): Promise<RentalFacility> {
    const facility = await this.facilityRepo.findOneBy({ id });
    if (!facility) throw new NotFoundException('Facility not found');
    return facility;
  }

  // ── Pricing tiers ───────────────────────────────────────────────────────────

  async upsertPricingTier(
    dto: UpsertRentalPricingTierDto,
  ): Promise<RentalPricingTier> {
    let tier = await this.tierRepo.findOne({
      where: { memberCategory: dto.memberCategory },
    });
    if (tier) {
      Object.assign(tier, dto);
    } else {
      tier = this.tierRepo.create(dto);
    }
    return this.tierRepo.save(tier);
  }

  async getPricingTiers(): Promise<RentalPricingTier[]> {
    return this.tierRepo.find({ order: { memberCategory: 'ASC' } });
  }

  async deletePricingTier(id: string): Promise<void> {
    const tier = await this.tierRepo.findOneBy({ id });
    if (!tier) throw new NotFoundException('Pricing tier not found');
    await this.tierRepo.remove(tier);
  }

  // ── Add-ons ─────────────────────────────────────────────────────────────────

  async createAddon(dto: CreateRentalAddonDto): Promise<RentalAddon> {
    const asset = dto.assetId
      ? await this.assetRepo.findOne({ where: { id: dto.assetId } })
      : null;
    if (dto.assetId && !asset) {
      throw new NotFoundException('Asset not found');
    }
    const { assetId: _aid, ...rest } = dto;
    const addon = this.addonRepo.create({ ...rest, asset });
    const saved = await this.addonRepo.save(addon);
    this.logger.log(`Created rental addon "${saved.name}" (${saved.id})`);
    return saved;
  }

  async updateAddon(
    id: string,
    dto: UpdateRentalAddonDto,
  ): Promise<RentalAddon> {
    const addon = await this.getAddonById(id);
    if (dto.assetId !== undefined) {
      addon.asset = dto.assetId
        ? await this.assetRepo.findOne({ where: { id: dto.assetId } })
        : null;
      if (dto.assetId && !addon.asset) {
        throw new NotFoundException('Asset not found');
      }
    }
    const { assetId: _aid, ...rest } = dto;
    Object.assign(addon, rest);
    return this.addonRepo.save(addon);
  }

  async getAddons(): Promise<RentalAddon[]> {
    return this.addonRepo.find({
      where: { isActive: true },
      relations: ['asset'],
      order: { name: 'ASC' },
    });
  }

  async getAddonById(id: string): Promise<RentalAddon> {
    const addon = await this.addonRepo.findOne({
      where: { id },
      relations: ['asset'],
    });
    if (!addon) throw new NotFoundException('Rental add-on not found');
    return addon;
  }

  // ── Calendar blocks ─────────────────────────────────────────────────────────

  async createCalendarBlock(
    dto: CreateRentalCalendarBlockDto,
  ): Promise<RentalCalendarBlock> {
    const facility = await this.getFacilityById(dto.facilityId);
    const start = new Date(dto.startDateTime);
    const end = new Date(dto.endDateTime);
    if (end <= start) {
      throw new BadRequestException('End must be after start');
    }
    const block = this.blockRepo.create({
      facility,
      startDateTime: start,
      endDateTime: end,
      reason: dto.reason,
    });
    return this.blockRepo.save(block);
  }

  async getCalendarBlocks(facilityId: string): Promise<RentalCalendarBlock[]> {
    return this.blockRepo.find({
      where: { facility: { id: facilityId } },
      order: { startDateTime: 'ASC' },
    });
  }

  async deleteCalendarBlock(id: string): Promise<void> {
    const block = await this.blockRepo.findOneBy({ id });
    if (!block) throw new NotFoundException('Calendar block not found');
    await this.blockRepo.remove(block);
  }
}
