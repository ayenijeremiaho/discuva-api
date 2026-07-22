import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClassType } from '../entity/class-type.entity';
import { ChurchClass } from '../entity/church-class.entity';
import { CreateClassTypeDto, UpdateClassTypeDto } from '../dto/class-type.dto';
import { CacheService } from '../../utility/service/cache.service';

const MAX_CHAIN_DEPTH = 20;

@Injectable()
export class ClassTypesService {
  private static readonly CACHE_KEY = 'class-types:all';
  private readonly logger = new Logger(ClassTypesService.name);

  constructor(
    @InjectRepository(ClassType)
    private readonly classTypeRepo: Repository<ClassType>,
    @InjectRepository(ChurchClass)
    private readonly classRepo: Repository<ChurchClass>,
    private readonly cacheService: CacheService,
  ) {}

  async createClassType(dto: CreateClassTypeDto): Promise<ClassType> {
    const nextClassType = await this.resolveNextClassType(dto.nextClassTypeId);

    const classType = this.classTypeRepo.create({
      name: dto.name,
      description: dto.description ?? null,
      nextClassType,
    });
    const saved = await this.classTypeRepo.save(classType);
    this.cacheService.del(ClassTypesService.CACHE_KEY);
    this.logger.log(`Class type "${saved.name}" created (id: ${saved.id})`);
    return saved;
  }

  async updateClassType(
    id: string,
    dto: UpdateClassTypeDto,
  ): Promise<ClassType> {
    const classType = await this.getClassTypeOrThrow(id);

    if (dto.name !== undefined) classType.name = dto.name;
    if (dto.description !== undefined) classType.description = dto.description;
    if (dto.isActive !== undefined) classType.isActive = dto.isActive;

    if (dto.nextClassTypeId !== undefined) {
      const nextClassType = await this.resolveNextClassType(
        dto.nextClassTypeId,
        id,
      );
      classType.nextClassType = nextClassType;
    }

    const saved = await this.classTypeRepo.save(classType);
    this.cacheService.del(ClassTypesService.CACHE_KEY);
    this.logger.log(`Class type "${saved.name}" updated (id: ${saved.id})`);
    return saved;
  }

  async deleteClassType(id: string): Promise<void> {
    const classType = await this.getClassTypeOrThrow(id);

    const classCount = await this.classRepo.count({
      where: { classType: { id } },
    });
    if (classCount > 0) {
      throw new BadRequestException(
        `Cannot delete this class type — ${classCount} class(es) still reference it. Deactivate it instead.`,
      );
    }

    await this.classTypeRepo.remove(classType);
    this.cacheService.del(ClassTypesService.CACHE_KEY);
    this.logger.log(`Class type "${classType.name}" deleted (id: ${id})`);
  }

  async getAllClassTypes(): Promise<ClassType[]> {
    const cached = await this.cacheService.get<ClassType[]>(
      ClassTypesService.CACHE_KEY,
    );
    if (cached) return cached;

    const all = await this.classTypeRepo.find({
      relations: ['nextClassType'],
      order: { name: 'ASC' },
    });
    this.cacheService.set(ClassTypesService.CACHE_KEY, all);
    return all;
  }

  async getClassType(id: string): Promise<ClassType> {
    return this.getClassTypeOrThrow(id);
  }

  private async getClassTypeOrThrow(id: string): Promise<ClassType> {
    const classType = await this.classTypeRepo.findOne({
      where: { id },
      relations: ['nextClassType'],
    });
    if (!classType) throw new NotFoundException('Class type not found');
    return classType;
  }

  // Walks the chain starting at the proposed next type to make sure wiring it
  // up wouldn't eventually loop back to `selfId` — a DB FK can't express "no
  // cycles", so this has to be checked here on every write.
  private async resolveNextClassType(
    nextClassTypeId: string | undefined | null,
    selfId?: string,
  ): Promise<ClassType | null> {
    if (!nextClassTypeId) return null;

    if (nextClassTypeId === selfId) {
      throw new BadRequestException('A class type cannot point to itself');
    }

    const nextClassType = await this.classTypeRepo.findOne({
      where: { id: nextClassTypeId },
    });
    if (!nextClassType) {
      throw new NotFoundException('Next class type not found');
    }

    if (selfId) {
      let currentId: string | null = nextClassTypeId;
      for (let hops = 0; hops < MAX_CHAIN_DEPTH && currentId; hops++) {
        if (currentId === selfId) {
          throw new BadRequestException(
            'This would create a promotion cycle between class types',
          );
        }
        const row = await this.classTypeRepo.findOne({
          where: { id: currentId },
          relations: ['nextClassType'],
        });
        currentId = row?.nextClassType?.id ?? null;
      }
    }

    return nextClassType;
  }
}
