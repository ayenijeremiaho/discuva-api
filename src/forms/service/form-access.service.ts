import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Admin } from '../../admin/entity/admin.entity';
import { FormAdminAccess } from '../../admin/entity/form-admin-access.entity';
import { AdminAccessService } from '../../admin/service/admin-access.service';
import { AdminOwnerService } from '../../admin/service/admin-owner.service';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { UtilityService } from '../../utility/service/utility.service';
import { Form } from '../entity/form.entity';
import { FormField } from '../entity/form-field.entity';
import { FormAccessQueryDto, SetFormAccessDto } from '../dto/form-access.dto';

@Injectable()
export class FormAccessService {
  constructor(
    @InjectRepository(FormAdminAccess)
    private readonly grants: Repository<FormAdminAccess>,
    @InjectRepository(Form) private readonly forms: Repository<Form>,
    @InjectRepository(FormField) private readonly fields: Repository<FormField>,
    @InjectRepository(Admin) private readonly admins: Repository<Admin>,
    private readonly access: AdminAccessService,
    private readonly owners: AdminOwnerService,
    private readonly audit: AuditLogService,
  ) {}

  async assertResultAccess(
    admin: Admin,
    formId: string,
    action: 'view' | 'export' = 'view',
  ): Promise<boolean> {
    if (!admin?.isActive) throw new ForbiddenException('Form access required.');
    if (await this.access.has(admin, AdminPermission.FORMS_READ)) return true;
    await this.access.assertFormAccessEnabled();
    const grant = await this.grants.findOne({
      where: {
        formId,
        adminId: admin.id,
        canView: true,
        ...(action === 'export' ? { canExport: true } : {}),
      },
      select: { canExport: true },
    });
    if (!grant) throw new NotFoundException('Form not found.');
    return grant.canExport;
  }

  private async assertManager(actor: Admin): Promise<void> {
    await this.access.assertFormAccessEnabled();
    if (
      !(await this.access.has(actor, AdminPermission.ADMIN_WRITE)) ||
      !(await this.access.has(actor, AdminPermission.FORMS_READ))
    ) {
      throw new ForbiddenException(
        'Manage admin users and read forms permissions are required.',
      );
    }
  }

  private async assertForm(formId: string): Promise<void> {
    if (!(await this.forms.existsBy({ id: formId })))
      throw new NotFoundException('Form not found.');
  }

  private async subject(actor: Admin, adminId: string): Promise<Admin> {
    const target = await this.admins.findOne({
      where: { id: adminId, isActive: true },
      relations: ['member'],
      select: { id: true, isActive: true, isOwner: true, member: { id: true } },
    });
    if (!target) throw new NotFoundException('Active admin not found.');
    if (target.id === actor.id)
      throw new ForbiddenException('You cannot modify your own admin record.');
    await this.owners.assertCanChange(target, actor.member.id);
    return target;
  }

  async set(
    actor: Admin,
    formId: string,
    adminId: string,
    dto: SetFormAccessDto,
  ): Promise<void> {
    await this.assertManager(actor);
    await this.subject(actor, adminId);
    await this.assertForm(formId);
    if (!dto.canView)
      throw new BadRequestException(
        'View results is required. Revoke access to remove this grant.',
      );
    const previous = await this.grants.findOneBy({ formId, adminId });
    await this.grants.upsert(
      { formId, adminId, canView: true, canExport: dto.canExport },
      ['formId', 'adminId'],
    );
    this.audit.log('FORM_ACCESS_GRANTED', {
      actorId: actor.member.id,
      targetId: adminId,
      metadata: {
        formId,
        formAccessFrom: previous
          ? { canView: previous.canView, canExport: previous.canExport }
          : null,
        formAccessTo: dto,
      },
    });
  }

  async revoke(actor: Admin, formId: string, adminId: string): Promise<void> {
    await this.assertManager(actor);
    await this.subject(actor, adminId);
    await this.assertForm(formId);
    await this.grants.delete({ formId, adminId });
    this.audit.log('FORM_ACCESS_REVOKED', {
      actorId: actor.member.id,
      targetId: adminId,
      metadata: { formId, formAccessTo: null },
    });
  }

  async listAccess(actor: Admin, formId: string, query: FormAccessQueryDto) {
    await this.assertManager(actor);
    await this.assertForm(formId);
    const qb = this.grants
      .createQueryBuilder('grant')
      .innerJoin('grant.admin', 'admin')
      .innerJoin('admin.member', 'member')
      .select([
        'grant',
        'admin.id',
        'admin.isActive',
        'member.id',
        'member.firstname',
        'member.lastname',
        'member.email',
      ])
      .where('grant.formId = :formId', { formId })
      .orderBy('grant.adminId', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);
    const [data, count] = await qb.getManyAndCount();
    return UtilityService.createPaginationResponse(
      data,
      query.page,
      query.limit,
      count,
    );
  }

  async formOptions(actor: Admin, query: FormAccessQueryDto) {
    await this.assertManager(actor);
    const qb = this.forms
      .createQueryBuilder('form')
      .select(['form.id', 'form.title', 'form.purpose']);
    if (query.search?.trim())
      qb.where('form.title ILIKE :search', {
        search: `%${query.search.trim().replace(/[\\%_]/g, '\\$&')}%`,
      });
    const [data, count] = await qb
      .orderBy('form.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return UtilityService.createPaginationResponse(
      data,
      query.page,
      query.limit,
      count,
    );
  }

  async adminOptions(actor: Admin, query: FormAccessQueryDto) {
    await this.assertManager(actor);
    const qb = this.admins
      .createQueryBuilder('admin')
      .innerJoin('admin.member', 'member')
      .innerJoin('admin.adminRole', 'role')
      .select([
        'admin.id',
        'member.id',
        'member.firstname',
        'member.lastname',
        'role.id',
        'role.permissions',
      ])
      .where('admin.isActive = true AND admin.id != :actorId', {
        actorId: actor.id,
      });
    if (query.search?.trim())
      qb.andWhere(
        "concat(member.firstname, ' ', member.lastname) ILIKE :search",
        { search: `%${query.search.trim().replace(/[\\%_]/g, '\\$&')}%` },
      );
    const [admins, count] = await qb
      .orderBy('admin.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    const data = admins.map((admin) => ({
      id: admin.id,
      member: admin.member,
      globalAccess: admin.adminRole.permissions.includes(
        AdminPermission.FORMS_READ,
      ),
    }));
    return UtilityService.createPaginationResponse(
      data,
      query.page,
      query.limit,
      count,
    );
  }

  async assignedTo(actor: Admin, adminId: string, query: FormAccessQueryDto) {
    await this.assertManager(actor);
    const target = await this.admins.findOneBy({ id: adminId });
    if (!target) throw new NotFoundException('Admin not found.');
    return this.listAssigned(adminId, query);
  }

  private async listAssigned(adminId: string, query: FormAccessQueryDto) {
    const qb = this.grants
      .createQueryBuilder('grant')
      .innerJoin('grant.form', 'form')
      .select(['grant', 'form.id', 'form.title', 'form.purpose'])
      .where('grant.adminId = :adminId AND grant.canView = true', { adminId });
    if (query.search?.trim())
      qb.andWhere('form.title ILIKE :search', {
        search: `%${query.search.trim().replace(/[\\%_]/g, '\\$&')}%`,
      });
    const [data, count] = await qb
      .orderBy('grant.formId', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return UtilityService.createPaginationResponse(
      data,
      query.page,
      query.limit,
      count,
    );
  }

  async shared(admin: Admin, query: FormAccessQueryDto) {
    await this.access.assertFormAccessEnabled();
    return this.listAssigned(admin.id, query);
  }

  async context(admin: Admin, formId: string) {
    const canExport = await this.assertResultAccess(admin, formId);
    const form = await this.forms.findOne({
      where: { id: formId },
      select: { id: true, title: true, purpose: true },
    });
    if (!form) throw new NotFoundException('Form not found.');
    const fields = await this.fields.find({
      where: { form: { id: formId } },
      select: { id: true, label: true, fieldType: true, order: true },
      order: { order: 'ASC' },
    });
    return { ...form, fields, canExport };
  }
}
