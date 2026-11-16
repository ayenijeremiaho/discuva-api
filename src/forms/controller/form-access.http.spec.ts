import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { FormAdminController } from './form-admin.controller';
import { FormAccessService } from '../service/form-access.service';
import { FormService } from '../service/form.service';
import { FormSubmissionService } from '../service/form-submission.service';
import { Form } from '../entity/form.entity';
import { FormField } from '../entity/form-field.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { FormAdminAccess } from '../../admin/entity/form-admin-access.entity';
import { AdminAccessService } from '../../admin/service/admin-access.service';
import { AdminOwnerService } from '../../admin/service/admin-owner.service';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { GroupService } from '../../group/service/group.service';
import { BuilderTemplateService } from '../../builder-template/service/builder-template.service';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { SessionSurface } from '../../auth/enum/session-surface.enum';

const formA = '11111111-1111-4111-8111-111111111111';
const formB = '22222222-2222-4222-8222-222222222222';
describe('results-only form HTTP boundaries', () => {
  let app: INestApplication;
  let canExport = false;
  let assigned = true;
  const admin = {
    id: 'recipient',
    isActive: true,
    member: { id: 'member' },
    adminRole: { permissions: [] },
    additionalPermissions: [],
  };
  const grantRepo = {
    findOne: jest.fn(async ({ where }) =>
      assigned && where.formId === formA && (!where.canExport || canExport)
        ? { canExport }
        : null,
    ),
  };
  const forms = {
    getById: jest.fn(),
    getAll: jest.fn(),
    getSubmissions: jest.fn().mockResolvedValue({ data: [], totalCount: 0 }),
    getAnalytics: jest.fn().mockResolvedValue({ totalSubmissions: 0 }),
    getSubmissionsCsv: jest.fn().mockResolvedValue('Submitted At\n'),
  };
  beforeAll(async () => {
    const access = new AdminAccessService(
      { getNumber: async () => 2 } as never,
      {} as never,
      { isActive: () => false } as never,
    );
    const module = await Test.createTestingModule({
      controllers: [FormAdminController],
      providers: [
        AdminGuard,
        FormAccessService,
        { provide: AdminAccessService, useValue: access },
        {
          provide: getRepositoryToken(Admin),
          useValue: { findOne: async () => admin },
        },
        { provide: getRepositoryToken(FormAdminAccess), useValue: grantRepo },
        {
          provide: getRepositoryToken(Form),
          useValue: {
            findOne: async () => ({
              id: formA,
              title: 'Results',
              purpose: 'QUIZ',
            }),
          },
        },
        {
          provide: getRepositoryToken(FormField),
          useValue: {
            find: async () => [
              { id: 'field', label: 'Question', fieldType: 'TEXT', order: 0 },
            ],
          },
        },
        { provide: AdminOwnerService, useValue: {} },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: FormService, useValue: forms },
        { provide: FormSubmissionService, useValue: {} },
        { provide: GroupService, useValue: {} },
        { provide: BuilderTemplateService, useValue: {} },
      ],
    })
      .overrideGuard(ModuleEnabledGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PlanGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.use((req, _res, next) => {
      req.user = { id: 'member', surface: SessionSurface.ADMIN };
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
  });
  beforeEach(() => {
    assigned = true;
    canExport = false;
    jest.clearAllMocks();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('allows only assigned responses and analytics', async () => {
    await request(app.getHttpServer())
      .get(`/forms/${formA}/submissions`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/forms/${formA}/analytics`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/forms/${formB}/submissions`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/forms/${formB}/analytics`)
      .expect(404);
    expect(forms.getSubmissions).toHaveBeenCalledTimes(1);
    expect(forms.getAnalytics).toHaveBeenCalledTimes(1);
  });
  it('denies export until separately enabled and rechecks after revoke', async () => {
    await request(app.getHttpServer())
      .get(`/forms/${formA}/submissions/export`)
      .expect(404);
    expect(forms.getSubmissionsCsv).not.toHaveBeenCalled();
    canExport = true;
    await request(app.getHttpServer())
      .get(`/forms/${formA}/submissions/export`)
      .expect(200);
    assigned = false;
    await request(app.getHttpServer())
      .get(`/forms/${formA}/submissions/export`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/forms/${formA}/results-context`)
      .expect(404);
    expect(forms.getSubmissionsCsv).toHaveBeenCalledTimes(1);
  });
  it('does not turn results access into builder, lookup, write or delegation access', async () => {
    for (const path of [
      '/forms',
      '/forms/options',
      '/forms/templates',
      `/forms/${formA}`,
    ]) {
      await request(app.getHttpServer()).get(path).expect(403);
    }
    await request(app.getHttpServer())
      .patch(`/forms/${formA}`)
      .send({ title: 'Changed' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/forms/${formA}/submissions`)
      .send({ answers: {} })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/forms/${formA}/access`)
      .expect(403);
    expect(forms.getById).not.toHaveBeenCalled();
  });
  it('returns safe context with view-only export state and rejects malformed IDs', async () => {
    const res = await request(app.getHttpServer())
      .get(`/forms/${formA}/results-context`)
      .expect(200);
    expect(res.body).toEqual({
      id: formA,
      title: 'Results',
      purpose: 'QUIZ',
      fields: [{ id: 'field', label: 'Question', fieldType: 'TEXT', order: 0 }],
      canExport: false,
    });
    await request(app.getHttpServer())
      .get('/forms/not-a-uuid/results-context')
      .expect(400);
  });
});
