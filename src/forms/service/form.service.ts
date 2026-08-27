import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Form } from '../entity/form.entity';
import { FormField } from '../entity/form-field.entity';
import { FormSubmission } from '../entity/form-submission.entity';
import { Event } from '../../event/entity/event.entity';
import { CreateFormDto, UpdateFormDto } from '../dto/form.dto';
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
  ) {}

  async create(dto: CreateFormDto): Promise<Form> {
    if (dto.createsFirstTimers) {
      this.assertValidFirstTimerConfig(dto.visibility, dto.fields);
    }
    const form = this.formRepo.create({
      title: dto.title,
      description: dto.description ?? null,
      visibility: dto.visibility,
      event: dto.eventId ? ({ id: dto.eventId } as Event) : null,
      createsFirstTimers: dto.createsFirstTimers ?? false,
      fields: dto.fields.map((f, index) =>
        this.fieldRepo.create({
          label: f.label,
          fieldType: f.fieldType,
          required: f.required ?? false,
          options: f.options ?? null,
          order: f.order ?? index,
          autoFillKey: f.autoFillKey ?? null,
        }),
      ),
    });
    return this.formRepo.save(form);
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

    if (dto.fields) {
      const incomingIds = new Set(
        dto.fields.filter((f) => f.id).map((f) => f.id),
      );
      const toDelete = form.fields.filter((f) => !incomingIds.has(f.id));
      if (toDelete.length) {
        await this.fieldRepo.remove(toDelete);
      }
      form.fields = dto.fields.map((f, index) =>
        this.fieldRepo.create({
          id: f.id,
          label: f.label,
          fieldType: f.fieldType,
          required: f.required ?? false,
          options: f.options ?? null,
          order: f.order ?? index,
          autoFillKey: f.autoFillKey ?? null,
        }),
      );
    }

    if (form.createsFirstTimers) {
      this.assertValidFirstTimerConfig(form.visibility, form.fields);
    }

    return this.formRepo.save(form);
  }

  async delete(id: string): Promise<void> {
    const form = await this.getById(id);
    await this.formRepo.remove(form);
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
