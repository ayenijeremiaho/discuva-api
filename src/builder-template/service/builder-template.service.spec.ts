import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { BuilderTemplateService } from './builder-template.service';
import { BuilderTemplate } from '../entity/builder-template.entity';
import { BuilderTemplateKind } from '../enum/builder-template-kind.enum';

const mockTemplateRepo = {
  create: jest.fn((value) => value),
  save: jest.fn((value) => Promise.resolve(value)),
  find: jest.fn(),
  findOneBy: jest.fn(),
  remove: jest.fn(),
};

describe('BuilderTemplateService', () => {
  let service: BuilderTemplateService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuilderTemplateService,
        {
          provide: getRepositoryToken(BuilderTemplate),
          useValue: mockTemplateRepo,
        },
      ],
    }).compile();
    service = module.get(BuilderTemplateService);
  });

  it('lists only templates for the requested kind', async () => {
    mockTemplateRepo.find.mockResolvedValue([]);

    await service.list(BuilderTemplateKind.FIELD_GROUP);

    expect(mockTemplateRepo.find).toHaveBeenCalledWith({
      where: { kind: BuilderTemplateKind.FIELD_GROUP },
      order: { createdAt: 'DESC' },
    });
  });

  it('trims template metadata when saving', async () => {
    await service.create(BuilderTemplateKind.FORM, {
      name: '  Registration  ',
      description: '  Reusable sign-up  ',
      data: { title: 'Registration' },
    });

    expect(mockTemplateRepo.create).toHaveBeenCalledWith({
      kind: BuilderTemplateKind.FORM,
      name: 'Registration',
      description: 'Reusable sign-up',
      data: { title: 'Registration' },
    });
  });

  it('does not delete a template from a different kind', async () => {
    mockTemplateRepo.findOneBy.mockResolvedValue(null);

    await expect(
      service.delete(BuilderTemplateKind.PAGE, 'template-1'),
    ).rejects.toThrow(NotFoundException);
    expect(mockTemplateRepo.remove).not.toHaveBeenCalled();
  });
});
