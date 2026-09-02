import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import 'multer';
import { Form } from '../entity/form.entity';
import { FormField } from '../entity/form-field.entity';
import { FormSubmission } from '../entity/form-submission.entity';
import { Event } from '../../event/entity/event.entity';
import { Group } from '../../group/entity/group.entity';
import { CreateFormDto, FormFieldDto, UpdateFormDto } from '../dto/form.dto';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import {
  FormFieldAutoFill,
  FormFieldType,
  FormVisibility,
} from '../enum/form.enum';
import {
  FormAnalyticsDto,
  FormFieldAnalyticsDto,
} from '../dto/form-analytics.dto';
import { CloudinaryService } from '../../utility/service/cloudinary.service';

const FIRST_TIMER_REQUIRED_AUTOFILL_KEYS = [
  FormFieldAutoFill.FIRST_NAME,
  FormFieldAutoFill.LAST_NAME,
  FormFieldAutoFill.PHONE_NUMBER,
];

const CHOICE_FIELD_TYPES = new Set([
  FormFieldType.DROPDOWN,
  FormFieldType.CHECKBOX,
]);
const SAMPLE_ANSWER_LIMIT = 20;

@Injectable()
export class FormService {
  constructor(
    @InjectRepository(Form)
    private readonly formRepo: Repository<Form>,
    @InjectRepository(FormField)
    private readonly fieldRepo: Repository<FormField>,
    @InjectRepository(FormSubmission)
    private readonly submissionRepo: Repository<FormSubmission>,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async create(dto: CreateFormDto): Promise<Form> {
    if (dto.createsFirstTimers) {
      this.assertValidFirstTimerConfig(dto.visibility, dto.fields);
    }
    this.assertValidAudienceGroup(dto.visibility, dto.audienceGroupId);
    this.assertValidOptionMetadata(dto.fields);
    this.assertValidCrossFieldRefs(
      dto.dedupFieldId,
      dto.nextStepsFieldId,
      dto.fields,
    );
    this.assertValidGeneralAction(dto.generalActionUrl, dto.generalActionLabel);
    const form = this.formRepo.create({
      title: dto.title,
      description: dto.description ?? null,
      visibility: dto.visibility,
      event: dto.eventId ? ({ id: dto.eventId } as Event) : null,
      createsFirstTimers: dto.createsFirstTimers ?? false,
      audienceGroup: dto.audienceGroupId
        ? ({ id: dto.audienceGroupId } as Group)
        : null,
      postSubmitMessage: dto.postSubmitMessage ?? null,
      generalActionUrl: dto.generalActionUrl ?? null,
      generalActionLabel: dto.generalActionLabel ?? null,
    });
    const saved = await this.formRepo.save(form);

    // A separate fieldRepo.save(), not a cascade off `form.fields` — see
    // the comment on Form.fields for why cascading here throws a TypeORM
    // "Cyclic dependency: FormField" error (Form also has dedupField/
    // nextStepsField relations to FormField).
    saved.fields = await this.fieldRepo.save(
      dto.fields.map((f, index) =>
        this.fieldRepo.create({
          label: f.label,
          fieldType: f.fieldType,
          required: f.required ?? false,
          options: f.options ?? null,
          order: f.order ?? index,
          autoFillKey: f.autoFillKey ?? null,
          optionMetadata: f.optionMetadata ?? null,
          form: saved,
        }),
      ),
    );

    return this.applyCrossFieldRefs(
      saved,
      dto.dedupFieldId,
      dto.nextStepsFieldId,
    );
  }

  // dedupField/nextStepsField reference FormField rows that don't exist
  // until the fields themselves are saved (a new field has no id before
  // that), so these can only be wired up as a second save once `form.fields`
  // holds real, persisted ids. Called from both create() and update().
  private async applyCrossFieldRefs(
    form: Form,
    dedupFieldId: string | null | undefined,
    nextStepsFieldId: string | null | undefined,
  ): Promise<Form> {
    if (dedupFieldId === undefined && nextStepsFieldId === undefined) {
      return form;
    }
    if (dedupFieldId !== undefined) {
      form.dedupField = dedupFieldId
        ? this.findFieldOrThrow(form.fields, dedupFieldId, 'dedup field')
        : null;
    }
    if (nextStepsFieldId !== undefined) {
      form.nextStepsField = nextStepsFieldId
        ? this.findFieldOrThrow(
            form.fields,
            nextStepsFieldId,
            'next-steps field',
          )
        : null;
    }
    // A targeted column update, not save(form) — dedupField/nextStepsField
    // point at a FormField object that's also present in form.fields
    // (cascade: true, eager: true). save() re-cascades that whole array
    // alongside the dedup/next-steps FK write, and TypeORM's topological
    // sorter sees two opposing edges between the same Form/FormField pair
    // (FormField depends on Form via form_id; Form depends on FormField via
    // dedup_field_id) and throws "Cyclic dependency: FormField". update()
    // only touches these two columns and never cascades `fields`.
    await this.formRepo.update(form.id, {
      dedupField: form.dedupField,
      nextStepsField: form.nextStepsField,
    });
    return form;
  }

  private findFieldOrThrow(
    fields: FormField[],
    fieldId: string,
    label: string,
  ): FormField {
    const field = fields.find((f) => f.id === fieldId);
    if (!field) {
      throw new BadRequestException(`Unknown ${label}`);
    }
    if (
      label === 'next-steps field' &&
      field.fieldType !== FormFieldType.DROPDOWN
    ) {
      throw new BadRequestException(
        'The next-steps field must be a DROPDOWN field',
      );
    }
    return field;
  }

  private assertValidAudienceGroup(
    visibility: FormVisibility,
    audienceGroupId: string | null | undefined,
  ): void {
    if (audienceGroupId && visibility !== FormVisibility.MEMBERS) {
      throw new BadRequestException(
        'A Contact List restriction only applies to a MEMBERS-visibility form',
      );
    }
  }

  private assertValidOptionMetadata(fields: FormFieldDto[]): void {
    for (const field of fields) {
      if (!field.optionMetadata) continue;
      const options = new Set(field.options ?? []);
      for (const [key, meta] of Object.entries(field.optionMetadata)) {
        if (!options.has(key)) {
          throw new BadRequestException(
            `optionMetadata key "${key}" isn't one of this field's options`,
          );
        }
        if (meta.url !== undefined && !this.isValidUrl(meta.url)) {
          throw new BadRequestException(`Invalid URL for option "${key}"`);
        }
      }
    }
  }

  private isValidUrl(value: unknown): boolean {
    if (typeof value !== 'string' || !value) return false;
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }

  // Both fields together or neither — a link with no label has nothing to
  // put on the button, and a label with no link has nowhere to send them.
  private assertValidGeneralAction(
    url: string | null | undefined,
    label: string | null | undefined,
  ): void {
    if (!url && !label) return;
    if (!url || !label) {
      throw new BadRequestException(
        'generalActionUrl and generalActionLabel must both be set, or both left empty',
      );
    }
    if (!this.isValidUrl(url)) {
      throw new BadRequestException('Invalid general action URL');
    }
  }

  private assertValidCrossFieldRefs(
    dedupFieldId: string | null | undefined,
    nextStepsFieldId: string | null | undefined,
    fields: { id?: string }[],
  ): void {
    const incomingIds = new Set(fields.filter((f) => f.id).map((f) => f.id));
    // Only checkable here for an *existing* field id (an update referencing
    // a field already on the form); a brand-new field (no id yet, create()
    // or a newly-added field on update()) is resolved after save in
    // applyCrossFieldRefs instead, once it has a real id.
    if (dedupFieldId && incomingIds.size && !incomingIds.has(dedupFieldId)) {
      throw new BadRequestException('Unknown dedup field');
    }
    if (
      nextStepsFieldId &&
      incomingIds.size &&
      !incomingIds.has(nextStepsFieldId)
    ) {
      throw new BadRequestException('Unknown next-steps field');
    }
  }

  // Requires visibility=PUBLIC (a first-timer, by definition, isn't
  // reachable through a MEMBERS-only or ADMIN_ONLY form) and a *required*
  // field carrying each of FIRST_NAME/LAST_NAME/PHONE_NUMBER as its
  // autoFillKey — those are FirstTimer's required columns, and `required`
  // is enforced here (not left to CreateFirstTimerDto's own decorators,
  // which never run against a service-constructed object the way they
  // would at an HTTP boundary) so a visitor can't submit the form with
  // them blank and produce an empty first-timer record.
  // FormSubmissionService reads submitted answers back out via this exact
  // mapping when auto-creating the record.
  private assertValidFirstTimerConfig(
    visibility: FormVisibility,
    fields: { autoFillKey?: FormFieldAutoFill | null; required?: boolean }[],
  ): void {
    if (visibility !== FormVisibility.PUBLIC) {
      throw new BadRequestException(
        'A form that auto-creates first-timer records must be PUBLIC visibility',
      );
    }
    const requiredKeys = new Set(
      fields.filter((f) => f.required).map((f) => f.autoFillKey),
    );
    const missing = FIRST_TIMER_REQUIRED_AUTOFILL_KEYS.filter(
      (key) => !requiredKeys.has(key),
    );
    if (missing.length) {
      throw new BadRequestException(
        `A form that auto-creates first-timer records needs a required field for each of: ${missing.join(', ')}`,
      );
    }
  }

  async getAll(): Promise<Form[]> {
    return this.formRepo.find({ order: { createdAt: 'DESC' } });
  }

  async getById(id: string): Promise<Form> {
    const form = await this.formRepo.findOne({ where: { id } });
    if (!form) throw new NotFoundException('Form not found');
    return form;
  }

  // Fields are diff-synced rather than replaced wholesale: an incoming
  // field with an id updates that row in place (keeping its id stable so
  // FormSubmission.answers keys stay meaningful), one without an id is a
  // new field, and an existing row missing from the incoming array is
  // deleted. A deleted field's key just becomes a harmless orphan inside
  // past submissions' answers JSON — nothing reads/writes it again.
  async update(id: string, dto: UpdateFormDto): Promise<Form> {
    const form = await this.getById(id);

    if (dto.title !== undefined) form.title = dto.title;
    if (dto.description !== undefined) form.description = dto.description;
    if (dto.visibility !== undefined) form.visibility = dto.visibility;
    if (dto.eventId !== undefined) {
      form.event = dto.eventId ? ({ id: dto.eventId } as Event) : null;
    }
    if (dto.isActive !== undefined) form.isActive = dto.isActive;
    if (dto.createsFirstTimers !== undefined) {
      form.createsFirstTimers = dto.createsFirstTimers;
    }
    if (dto.audienceGroupId !== undefined) {
      form.audienceGroup = dto.audienceGroupId
        ? ({ id: dto.audienceGroupId } as Group)
        : null;
    }
    if (dto.postSubmitMessage !== undefined) {
      form.postSubmitMessage = dto.postSubmitMessage;
    }
    if (dto.generalActionUrl !== undefined) {
      form.generalActionUrl = dto.generalActionUrl;
    }
    if (dto.generalActionLabel !== undefined) {
      form.generalActionLabel = dto.generalActionLabel;
    }

    if (dto.fields) {
      const incomingIds = new Set(
        dto.fields.filter((f) => f.id).map((f) => f.id),
      );
      const toDelete = form.fields.filter((f) => !incomingIds.has(f.id));
      if (toDelete.length) {
        const deletedIds = new Set(toDelete.map((f) => f.id));
        // A deleted field can't remain the dedup/next-steps designee — the
        // DB's ON DELETE SET NULL will null the column regardless, but the
        // in-memory `form` still holds the stale reference; clearing it
        // here first stops the impending save from trying to write a
        // dedup_field_id/next_steps_field_id back to a row that's about to
        // no longer exist (which would otherwise fail the FK constraint).
        if (form.dedupField && deletedIds.has(form.dedupField.id)) {
          form.dedupField = null;
        }
        if (form.nextStepsField && deletedIds.has(form.nextStepsField.id)) {
          form.nextStepsField = null;
        }
        await this.fieldRepo.remove(toDelete);
      }
      // A separate fieldRepo.save(), not a cascade off `form.fields` — see
      // the comment on Form.fields for why cascading here throws a
      // TypeORM "Cyclic dependency: FormField" error.
      form.fields = await this.fieldRepo.save(
        dto.fields.map((f, index) =>
          this.fieldRepo.create({
            id: f.id,
            label: f.label,
            fieldType: f.fieldType,
            required: f.required ?? false,
            options: f.options ?? null,
            order: f.order ?? index,
            autoFillKey: f.autoFillKey ?? null,
            optionMetadata: f.optionMetadata ?? null,
            form,
          }),
        ),
      );
    }

    if (form.createsFirstTimers) {
      this.assertValidFirstTimerConfig(form.visibility, form.fields);
    }
    this.assertValidAudienceGroup(
      form.visibility,
      form.audienceGroup?.id ?? null,
    );
    if (dto.fields) this.assertValidOptionMetadata(dto.fields);
    this.assertValidCrossFieldRefs(
      dto.dedupFieldId,
      dto.nextStepsFieldId,
      form.fields,
    );
    this.assertValidGeneralAction(
      form.generalActionUrl,
      form.generalActionLabel,
    );

    const saved = await this.formRepo.save(form);
    return this.applyCrossFieldRefs(
      saved,
      dto.dedupFieldId,
      dto.nextStepsFieldId,
    );
  }

  async delete(id: string): Promise<void> {
    const form = await this.getById(id);
    await this.formRepo.remove(form);
  }

  // Mirrors TenantInfoController.uploadLogo/removeLogo's "delete the
  // previous asset only after the new one is safely saved" ordering, so a
  // failed re-upload never leaves a form with no cover image at all.
  async setCoverImage(id: string, file: Express.Multer.File): Promise<Form> {
    const form = await this.getById(id);
    const previousPublicId = form.coverImagePublicId;
    const uploaded = await this.cloudinaryService.uploadBuffer(
      file.buffer,
      'form-covers',
      undefined,
      file.mimetype,
    );
    form.coverImageUrl = uploaded.secureUrl;
    form.coverImagePublicId = uploaded.publicId;
    const saved = await this.formRepo.save(form);
    if (previousPublicId) {
      this.cloudinaryService.deleteByPublicId(previousPublicId, 'image');
    }
    return saved;
  }

  async removeCoverImage(id: string): Promise<Form> {
    const form = await this.getById(id);
    const previousPublicId = form.coverImagePublicId;
    form.coverImageUrl = null;
    form.coverImagePublicId = null;
    const saved = await this.formRepo.save(form);
    if (previousPublicId) {
      this.cloudinaryService.deleteByPublicId(previousPublicId, 'image');
    }
    return saved;
  }

  async setLogo(id: string, file: Express.Multer.File): Promise<Form> {
    const form = await this.getById(id);
    const previousPublicId = form.logoPublicId;
    const uploaded = await this.cloudinaryService.uploadBuffer(
      file.buffer,
      'form-logos',
      undefined,
      file.mimetype,
    );
    form.logoUrl = uploaded.secureUrl;
    form.logoPublicId = uploaded.publicId;
    const saved = await this.formRepo.save(form);
    if (previousPublicId) {
      this.cloudinaryService.deleteByPublicId(previousPublicId, 'image');
    }
    return saved;
  }

  async removeLogo(id: string): Promise<Form> {
    const form = await this.getById(id);
    const previousPublicId = form.logoPublicId;
    form.logoUrl = null;
    form.logoPublicId = null;
    const saved = await this.formRepo.save(form);
    if (previousPublicId) {
      this.cloudinaryService.deleteByPublicId(previousPublicId, 'image');
    }
    return saved;
  }

  async getSubmissions(
    formId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginationResponseDto<FormSubmission>> {
    await this.getById(formId);
    const [data, total] = await this.submissionRepo.findAndCount({
      where: { form: { id: formId } },
      relations: ['member'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async getSubmissionsCsv(formId: string): Promise<string> {
    const form = await this.getById(formId);
    const submissions = await this.submissionRepo.find({
      where: { form: { id: formId } },
      relations: ['member'],
      order: { createdAt: 'ASC' },
    });

    const fields = [...form.fields].sort((a, b) => a.order - b.order);
    const header = [
      'Submitted At',
      'Submitted By',
      ...fields.map((f) => f.label),
    ];
    const rows = submissions.map((s) => {
      const submittedBy = s.member
        ? `${s.member.firstname} ${s.member.lastname}`
        : 'Public';
      const answerCells = fields.map((f) => {
        const value = s.answers[f.id];
        if (Array.isArray(value)) return value.join('; ');
        return value === null || value === undefined ? '' : String(value);
      });
      return [s.createdAt.toISOString(), submittedBy, ...answerCells];
    });

    const escape = (cell: string) => `"${cell.replaceAll('"', '""')}"`;
    return [header, ...rows].map((row) => row.map(escape).join(',')).join('\n');
  }

  async getAnalytics(formId: string): Promise<FormAnalyticsDto> {
    const form = await this.getById(formId);
    const submissions = await this.submissionRepo.find({
      where: { form: { id: formId } },
      order: { createdAt: 'DESC' },
    });

    const fields = [...form.fields].sort((a, b) => a.order - b.order);
    const answersByField = fields.map((f) =>
      submissions.map((s) => s.answers[f.id]).filter((v) => !this.isBlank(v)),
    );

    return {
      formId: form.id,
      title: form.title,
      totalSubmissions: submissions.length,
      fields: fields.map((field, i) =>
        this.buildFieldAnalytics(field, answersByField[i]),
      ),
    };
  }

  private isBlank(value: unknown): boolean {
    return value === null || value === undefined || value === '';
  }

  private buildFieldAnalytics(
    field: FormField,
    answers: unknown[],
  ): FormFieldAnalyticsDto {
    const base = {
      fieldId: field.id,
      label: field.label,
      fieldType: field.fieldType,
      responseCount: answers.length,
    };

    if (CHOICE_FIELD_TYPES.has(field.fieldType)) {
      const counts = new Map<string, number>();
      for (const option of field.options ?? []) counts.set(option, 0);
      let totalSelections = 0;
      for (const answer of answers) {
        const selected = Array.isArray(answer) ? answer : [answer];
        for (const value of selected) {
          const key = String(value);
          counts.set(key, (counts.get(key) ?? 0) + 1);
          totalSelections++;
        }
      }
      return {
        ...base,
        choices: [...counts.entries()].map(([option, count]) => ({
          option,
          count,
          percentage:
            totalSelections === 0
              ? 0
              : Math.round((count / totalSelections) * 1000) / 10,
        })),
      };
    }

    if (field.fieldType === FormFieldType.NUMBER) {
      const numbers = answers
        .map((a) => Number(a))
        .filter((n) => !Number.isNaN(n));
      return {
        ...base,
        average:
          numbers.length === 0
            ? null
            : Math.round(
                (numbers.reduce((sum, n) => sum + n, 0) / numbers.length) * 100,
              ) / 100,
        min: numbers.length === 0 ? null : Math.min(...numbers),
        max: numbers.length === 0 ? null : Math.max(...numbers),
      };
    }

    return {
      ...base,
      sampleAnswers: answers
        .slice(0, SAMPLE_ANSWER_LIMIT)
        .map((a) => (Array.isArray(a) ? a.join(', ') : String(a))),
    };
  }
}
