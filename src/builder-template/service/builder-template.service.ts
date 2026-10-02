import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SaveBuilderTemplateDto } from '../dto/save-builder-template.dto';
import { BuilderTemplate } from '../entity/builder-template.entity';
import { BuilderTemplateKind } from '../enum/builder-template-kind.enum';

@Injectable()
export class BuilderTemplateService {
  constructor(
    @InjectRepository(BuilderTemplate)
    private readonly templateRepo: Repository<BuilderTemplate>,
  ) {}

  list(kind: BuilderTemplateKind): Promise<BuilderTemplate[]> {
    return this.templateRepo.find({
      where: { kind },
      order: { createdAt: 'DESC' },
    });
  }

  create(
    kind: BuilderTemplateKind,
    dto: SaveBuilderTemplateDto,
  ): Promise<BuilderTemplate> {
    return this.templateRepo.save(
      this.templateRepo.create({
        kind,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        data: dto.data,
      }),
    );
  }

  async delete(kind: BuilderTemplateKind, id: string): Promise<{ id: string }> {
    const template = await this.templateRepo.findOneBy({ id, kind });
    if (!template) throw new NotFoundException('Template not found');
    await this.templateRepo.remove(template);
    return { id };
  }
}
