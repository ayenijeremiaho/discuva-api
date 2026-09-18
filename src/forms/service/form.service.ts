import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';
import 'multer';
import {
  Form,
  PostSubmitOutcome,
  PostSubmitOutcomeCondition,
} from '../entity/form.entity';
import { FormField } from '../entity/form-field.entity';
import { FormSubmission } from '../entity/form-submission.entity';
import { Event } from '../../event/entity/event.entity';
import { Group } from '../../group/entity/group.entity';
import {
  CloneFormDto,
  CreateFormDto,
  FormFieldDto,
  FormOptionDto,
  PostSubmitOutcomeDto,
  UpdateFormDto,
} from '../dto/form.dto';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import {
  FIELD_TYPES_REQUIRING_OPTIONS,
  FormFieldAutoFill,
  FormFieldType,
  FormPurpose,
  FormVisibility,
} from '../enum/form.enum';
import {
  FormAnalyticsDto,
  FormFieldAnalyticsDto,
} from '../dto/form-analytics.dto';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import { DateService } from '../../utility/service/date.service';

const FIRST_TIMER_REQUIRED_AUTOFILL_KEYS = [
  FormFieldAutoFill.FIRST_NAME,
  FormFieldAutoFill.LAST_NAME,
  FormFieldAutoFill.PHONE_NUMBER,
];

const CHOICE_FIELD_TYPES = new Set([
  FormFieldType.DROPDOWN,
  FormFieldType.CHECKBOX,
]);
// A VOTE field must be a choice — reuses CHOICE_FIELD_TYPES's exact set
// (a vote is always Dropdown/Checkbox, never anything else). A QUIZ field
// also allows Text/Long Text for a short-answer/essay question a teacher
// grades manually (never auto-scored) — everything else (Number, Email,
// Phone, Date, File) has no real place on either, so both stay a strict
// allowlist rather than "everything except a denylist".
const QUIZ_FIELD_TYPES = new Set([
  ...CHOICE_FIELD_TYPES,
  FormFieldType.TEXT,
  FormFieldType.TEXTAREA,
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
    private readonly dateService: DateService,
  ) {}

  async create(dto: CreateFormDto): Promise<Form> {
    if (dto.createsFirstTimers) {
      this.assertValidFirstTimerConfig(dto.visibility, dto.fields);
    }
    this.assertValidAudienceGroup(dto.visibility, dto.audienceGroupId);
    this.assertValidOptionMetadata(dto.fields);
    this.assertValidFieldConstraints(dto.fields);
    this.assertValidVisibilityRules(dto.fields);
    this.assertValidCrossFieldRefs(
      dto.dedupFieldId,
      dto.nextStepsFieldId,
      dto.fields,
    );
    this.assertValidGeneralAction(dto.generalActionUrl, dto.generalActionLabel);
    this.assertValidPostSubmitOutcomes(dto.fields, dto.postSubmitOutcomes);
    const purpose = dto.purpose ?? FormPurpose.STANDARD;
    this.assertValidPurposeConfig(purpose, {
      visibility: dto.visibility,
      timeLimitMinutes: dto.timeLimitMinutes ?? null,
      fields: dto.fields,
    });
    const opensAt = this.parseChurchInstant(dto.opensAt);
    const closesAt = this.parseChurchInstant(dto.closesAt);
    this.assertValidWindow(opensAt, closesAt);
    const form = this.formRepo.create({
      title: dto.title,
      description: dto.description ?? null,
      visibility: dto.visibility,
      event: dto.eventId ? ({ id: dto.eventId } as Event) : null,
      createsFirstTimers: dto.createsFirstTimers ?? false,
      notifyOnSubmission: dto.notifyOnSubmission ?? false,
      // A quiz answer can never be edited after the fact, regardless of
      // what the request sent — letting someone revise an answer after
      // their score was already computed (and very possibly shown to
      // them) turns "test" into "look up the answer key and fix it".
      // oneResponsePerMember + the retake flow (FormAttemptService) is
      // the correct, timer-respecting way to let someone try again —
      // never a silent edit of a past submission.
      editableAfterSubmit:
        purpose === FormPurpose.QUIZ
          ? false
          : (dto.editableAfterSubmit ?? true),
      audienceGroup: dto.audienceGroupId
        ? ({ id: dto.audienceGroupId } as Group)
        : null,
      postSubmitMessage: dto.postSubmitMessage ?? null,
      generalActionUrl: dto.generalActionUrl ?? null,
      generalActionLabel: dto.generalActionLabel ?? null,
      postSubmitOutcomes: this.normalizePostSubmitOutcomes(
        dto.postSubmitOutcomes,
      ),
      purpose,
      oneResponsePerMember: dto.oneResponsePerMember ?? false,
      opensAt,
      closesAt,
      timeLimitMinutes: dto.timeLimitMinutes ?? null,
      revealScoreImmediately: dto.revealScoreImmediately ?? true,
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
          description: f.description ?? null,
          fieldType: f.fieldType,
          required: f.required ?? false,
          options: f.options ?? null,
          order: f.order ?? index,
          autoFillKey: f.autoFillKey ?? null,
          optionMetadata: f.optionMetadata ?? null,
          minValue: f.minValue ?? null,
          maxValue: f.maxValue ?? null,
          minLength: f.minLength ?? null,
          maxLength: f.maxLength ?? null,
          minSelections: f.minSelections ?? null,
          maxSelections: f.maxSelections ?? null,
          validationRegex: f.validationRegex ?? null,
          validationMessage: f.validationMessage ?? null,
          visibilityRule: f.visibilityRule ?? null,
          pageIndex: f.pageIndex ?? 0,
          correctOptions:
            purpose === FormPurpose.QUIZ ? (f.correctOptions ?? null) : null,
          points: purpose === FormPurpose.QUIZ ? (f.points ?? null) : null,
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

  // Modeled on PrayerConfigService.cloneProgram: only `title` is required,
  // every other scalar is inherited from `source` unless the dto overrides
  // it (see CloneFormDto's own comment for the omitted/null/value
  // convention). Starts inactive and branding-less regardless of the
  // source — see the comments on isActive/cover/logo in
  // buildCloneScalars(). Never clones FormSubmission[].
  async cloneForm(sourceId: string, dto: CloneFormDto): Promise<Form> {
    const source = await this.getById(sourceId);
    const scalars = this.buildCloneScalars(source, dto);

    this.assertValidAudienceGroup(scalars.visibility, scalars.audienceGroupId);
    this.assertValidGeneralAction(
      scalars.generalActionUrl,
      scalars.generalActionLabel,
    );

    const newForm = this.formRepo.create({
      title: dto.title,
      description: scalars.description,
      visibility: scalars.visibility,
      event: scalars.eventId ? ({ id: scalars.eventId } as Event) : null,
      isActive: false,
      createsFirstTimers: scalars.createsFirstTimers,
      notifyOnSubmission: scalars.notifyOnSubmission,
      // A QUIZ clone stays locked-after-submit too — see the identical
      // override in create()/update() for why. source.purpose (not
      // scalars, which has no purpose field of its own — see below) since
      // purpose always carries over verbatim on a clone.
      editableAfterSubmit:
        source.purpose === FormPurpose.QUIZ
          ? false
          : scalars.editableAfterSubmit,
      audienceGroup: scalars.audienceGroupId
        ? ({ id: scalars.audienceGroupId } as Group)
        : null,
      postSubmitMessage: scalars.postSubmitMessage,
      generalActionUrl: scalars.generalActionUrl,
      generalActionLabel: scalars.generalActionLabel,
      // Not copied verbatim, same reasoning as fields' own visibilityRule
      // below — every condition's fieldId points at a source field id that
      // no longer exists post-clone. remapClonedPostSubmitOutcomes fills
      // in the re-matched version once the cloned fields have their new
      // ids; CloneFormDto deliberately has no override for this (there's
      // no sensible fieldId an admin could supply before the clone's own
      // fields exist).
      postSubmitOutcomes: null,
      // Structural behaviour (purpose, one-vote enforcement, quiz timer
      // length, reveal timing) is worth preserving on a duplicate — it's
      // the same reasoning as carrying over `fields` verbatim. A specific
      // schedule is not: opensAt/closesAt are always reset to null,
      // consistent with "always starts inactive... regardless of what the
      // source had" above — a clone always needs its own explicit window.
      purpose: source.purpose,
      oneResponsePerMember: source.oneResponsePerMember,
      opensAt: null,
      closesAt: null,
      timeLimitMinutes: source.timeLimitMinutes,
      revealScoreImmediately: source.revealScoreImmediately,
    });
    const saved = await this.formRepo.save(newForm);

    // A separate fieldRepo.save(), not a cascade — same cyclic-dependency
    // reason as create()/update().
    saved.fields = await this.fieldRepo.save(
      source.fields.map((f) =>
        this.fieldRepo.create({
          label: f.label,
          description: f.description,
          fieldType: f.fieldType,
          required: f.required,
          options: f.options,
          order: f.order,
          autoFillKey: f.autoFillKey,
          optionMetadata: f.optionMetadata,
          correctOptions: f.correctOptions,
          points: f.points,
          minValue: f.minValue,
          maxValue: f.maxValue,
          minLength: f.minLength,
          maxLength: f.maxLength,
          minSelections: f.minSelections,
          maxSelections: f.maxSelections,
          validationRegex: f.validationRegex,
          validationMessage: f.validationMessage,
          // Not copied verbatim — a source rule's fieldId points at a
          // FormField row that no longer exists post-clone (fresh ids).
          // remapClonedVisibilityRules fills in the re-matched version
          // below, once every field has its new id.
          visibilityRule: null,
          pageIndex: f.pageIndex,
          form: saved,
        }),
      ),
    );

    if (scalars.createsFirstTimers) {
      this.assertValidFirstTimerConfig(scalars.visibility, saved.fields);
    }

    // dedupField/nextStepsField point at FormField rows that no longer
    // exist post-clone (fresh ids) — re-matched by label, the only stable
    // key that survives the copy, same idea as applyCrossFieldRefs' own
    // "resolve after save" step.
    const dedupFieldId = source.dedupField
      ? this.matchClonedFieldByLabel(saved.fields, source.dedupField)
      : undefined;
    const nextStepsFieldId = source.nextStepsField
      ? this.matchClonedFieldByLabel(saved.fields, source.nextStepsField)
      : undefined;
    const result = await this.applyCrossFieldRefs(
      saved,
      dedupFieldId,
      nextStepsFieldId,
    );
    await this.remapClonedVisibilityRules(source.fields, result.fields);

    const remappedOutcomes = this.remapClonedPostSubmitOutcomes(
      source,
      result.fields,
    );
    if (remappedOutcomes) {
      result.postSubmitOutcomes = remappedOutcomes;
      await this.formRepo.save(result);
    }
    return result;
  }

  // Same by-label re-matching dedupField/nextStepsField use, applied per
  // field instead of per form: a rule referencing a source field that
  // didn't survive the clone (shouldn't happen — every source field is
  // always cloned) is silently dropped rather than left dangling with a
  // stale source-form field id. Mutates `clonedFields` in place so the
  // Form object cloneForm ultimately returns already reflects the
  // remapped rules, not just the DB rows. Plain `fieldRepo.save()` is safe
  // here (no `.update()` workaround needed) — visibilityRule is jsonb, not
  // a relation, so it never enters TypeORM's cyclic-dependency territory.
  private async remapClonedVisibilityRules(
    sourceFields: FormField[],
    clonedFields: FormField[],
  ): Promise<void> {
    const toUpdate: FormField[] = [];
    for (const sourceField of sourceFields) {
      if (!sourceField.visibilityRule) continue;
      const clonedOwner = clonedFields.find(
        (cf) => cf.label === sourceField.label,
      );
      const referencedSource = sourceFields.find(
        (sf) => sf.id === sourceField.visibilityRule!.fieldId,
      );
      const clonedTargetId = referencedSource
        ? this.matchClonedFieldByLabel(clonedFields, referencedSource)
        : null;
      if (!clonedOwner || !clonedTargetId) continue;
      clonedOwner.visibilityRule = {
        ...sourceField.visibilityRule,
        fieldId: clonedTargetId,
      };
      toUpdate.push(clonedOwner);
    }
    if (toUpdate.length) {
      await this.fieldRepo.save(toUpdate);
    }
  }

  // Same by-label re-matching remapClonedVisibilityRules uses, applied to
  // Form.postSubmitOutcomes instead of a per-field rule — every
  // condition's fieldId across every outcome points at a source field id
  // that no longer exists post-clone. Unlike a single visibilityRule
  // condition, an outcome can have several conditions (ALL must match to
  // apply) — if even one of them can't be remapped, the whole outcome is
  // dropped rather than left partially-broken, same "drop rather than
  // leave dangling" stance remapClonedVisibilityRules takes. Returns null
  // (not an empty array) when there's nothing to carry over, so the
  // caller can skip an unnecessary extra save.
  private remapClonedPostSubmitOutcomes(
    source: Form,
    clonedFields: FormField[],
  ): PostSubmitOutcome[] | null {
    if (!source.postSubmitOutcomes?.length) return null;
    const remapped: PostSubmitOutcome[] = [];
    for (const outcome of source.postSubmitOutcomes) {
      const remappedConditions: PostSubmitOutcomeCondition[] = [];
      let unresolvable = false;
      for (const condition of outcome.conditions) {
        const referencedSource = source.fields.find(
          (sf) => sf.id === condition.fieldId,
        );
        const clonedTargetId = referencedSource
          ? this.matchClonedFieldByLabel(clonedFields, referencedSource)
          : null;
        if (!clonedTargetId) {
          unresolvable = true;
          break;
        }
        remappedConditions.push({ ...condition, fieldId: clonedTargetId });
      }
      if (unresolvable) continue;
      remapped.push({ ...outcome, conditions: remappedConditions });
    }
    return remapped.length ? remapped : null;
  }

  // omitted (undefined) = inherited from source, explicit null = cleared,
  // value = override — see CloneFormDto's own comment. isActive and
  // cover/logo are deliberately absent here: a clone always starts inactive
  // (an admin reviews/edits it before it goes live) and branding-less
  // (sharing a Cloudinary publicId across two Forms means removing the
  // clone's cover would delete the original's — setCoverImage/
  // removeCoverImage both unconditionally deleteByPublicId the previous
  // asset), regardless of what the source had.
  private buildCloneScalars(source: Form, dto: CloneFormDto) {
    const scalars = {
      description: source.description,
      visibility: dto.visibility ?? source.visibility,
      eventId: source.event?.id ?? null,
      createsFirstTimers: dto.createsFirstTimers ?? source.createsFirstTimers,
      notifyOnSubmission: dto.notifyOnSubmission ?? source.notifyOnSubmission,
      editableAfterSubmit:
        dto.editableAfterSubmit ?? source.editableAfterSubmit,
      audienceGroupId: source.audienceGroup?.id ?? null,
      postSubmitMessage: source.postSubmitMessage,
      generalActionUrl: source.generalActionUrl,
      generalActionLabel: source.generalActionLabel,
    };
    if (dto.description !== undefined) scalars.description = dto.description;
    if (dto.eventId !== undefined) scalars.eventId = dto.eventId;
    if (dto.audienceGroupId !== undefined) {
      scalars.audienceGroupId = dto.audienceGroupId;
    }
    if (dto.postSubmitMessage !== undefined) {
      scalars.postSubmitMessage = dto.postSubmitMessage;
    }
    if (dto.generalActionUrl !== undefined) {
      scalars.generalActionUrl = dto.generalActionUrl;
    }
    if (dto.generalActionLabel !== undefined) {
      scalars.generalActionLabel = dto.generalActionLabel;
    }
    return scalars;
  }

  private matchClonedFieldByLabel(
    clonedFields: FormField[],
    sourceField: FormField,
  ): string | null {
    return clonedFields.find((f) => f.label === sourceField.label)?.id ?? null;
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

  // Naive date-time string (no UTC offset) -> the correct UTC instant for
  // the church's configured timezone. Null/undefined pass through as null
  // (always-open, the default) — matches this DTO field's own convention.
  private parseChurchInstant(value: string | null | undefined): Date | null {
    return value ? this.dateService.toChurchInstant(value) : null;
  }

  private assertValidWindow(opensAt: Date | null, closesAt: Date | null): void {
    if (opensAt && closesAt && closesAt <= opensAt) {
      throw new BadRequestException('"Closes At" must be after "Opens At"');
    }
  }

  // VOTE requires MEMBERS visibility (no anonymity/secret-ballot design
  // exists yet — see the plan's own note) and rejects a duplicate option
  // value within a single field's choice list, so two candidates/choices
  // can never accidentally collide. QUIZ validates correctOptions against
  // each field's own `options`, and requires MEMBERS visibility whenever a
  // per-attempt timer is configured — an anonymous PUBLIC submission has no
  // identity for FormAttempt to track a personal countdown against.
  private assertValidPurposeConfig(
    purpose: FormPurpose,
    config: {
      visibility: FormVisibility;
      timeLimitMinutes: number | null;
      fields: {
        label: string;
        fieldType: FormFieldType;
        options?: string[] | null;
        correctOptions?: string[] | null;
      }[];
    },
  ): void {
    if (purpose === FormPurpose.VOTE) {
      if (config.visibility !== FormVisibility.MEMBERS) {
        throw new BadRequestException('A vote must be MEMBERS visibility');
      }
      // A vote is always a choice — a voter's identity is already the
      // logged-in member (MEMBERS-only, enforced above), so there's never
      // a reason to collect a name/email/phone/etc. alongside it. Kept
      // narrow rather than "whatever an admin happens to pick," since the
      // full 9-type picker (built for STANDARD forms) reads as confusing
      // clutter here — every option other than a choice is a dead end.
      for (const field of config.fields) {
        if (!CHOICE_FIELD_TYPES.has(field.fieldType)) {
          throw new BadRequestException(
            `"${field.label}": a vote field must be Dropdown or Checkbox`,
          );
        }
      }
      for (const field of config.fields) {
        if (!field.options?.length) continue;
        const seen = new Set<string>();
        for (const option of field.options) {
          const key = option.trim().toLowerCase();
          if (seen.has(key)) {
            throw new BadRequestException(
              `Vote choices must be unique — "${option}" is listed twice.`,
            );
          }
          seen.add(key);
        }
      }
    }

    if (purpose === FormPurpose.QUIZ) {
      if (
        config.timeLimitMinutes != null &&
        config.visibility !== FormVisibility.MEMBERS
      ) {
        throw new BadRequestException(
          'A timed quiz must be MEMBERS visibility',
        );
      }
      // Dropdown/Checkbox are the only auto-graded types; Text/Long Text
      // stay allowed for a short-answer/essay question a teacher reviews
      // manually (never scored — see FormSubmissionService.
      // scoreQuizSubmission). Every other type (Number, Email, Phone,
      // Date, File) has no real place on a quiz question, so it's left
      // out of the picker/rejected here rather than left in "just in
      // case" — the same clutter/confusion problem VOTE_FIELD_TYPES
      // above avoids.
      for (const field of config.fields) {
        if (!QUIZ_FIELD_TYPES.has(field.fieldType)) {
          throw new BadRequestException(
            `"${field.label}": a quiz field must be Dropdown, Checkbox, Text, or Long Text`,
          );
        }
      }
      for (const field of config.fields) {
        if (!field.correctOptions?.length) continue;
        if (!FIELD_TYPES_REQUIRING_OPTIONS.has(field.fieldType)) {
          throw new BadRequestException(
            `"${field.label}": correctOptions only applies to DROPDOWN/CHECKBOX fields`,
          );
        }
        const options = new Set(field.options ?? []);
        for (const correct of field.correctOptions) {
          if (!options.has(correct)) {
            throw new BadRequestException(
              `"${field.label}": correctOptions value "${correct}" isn't one of this field's own options`,
            );
          }
        }
      }
    }
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

  // Mirrors assertValidGeneralAction's simple relational-check shape,
  // applied to each of the three bound pairs a field can carry. A bound is
  // only meaningful for its matching fieldType — set on the wrong type is
  // rejected outright rather than silently ignored, so a form builder finds
  // out immediately rather than the bound quietly never taking effect.
  private assertValidFieldConstraints(fields: FormFieldDto[]): void {
    for (const field of fields) {
      this.assertBoundPairValid(
        field,
        'minValue',
        'maxValue',
        FormFieldType.NUMBER,
      );
      this.assertBoundPairValid(field, 'minLength', 'maxLength', [
        FormFieldType.TEXT,
        FormFieldType.TEXTAREA,
      ]);
      this.assertBoundPairValid(field, 'minSelections', 'maxSelections', [
        FormFieldType.CHECKBOX,
      ]);
      this.assertValidFieldPattern(field);
    }
  }

  private assertBoundPairValid(
    field: FormFieldDto,
    minKey: 'minValue' | 'minLength' | 'minSelections',
    maxKey: 'maxValue' | 'maxLength' | 'maxSelections',
    allowedTypes: FormFieldType | FormFieldType[],
  ): void {
    const min = field[minKey];
    const max = field[maxKey];
    // Loose `== null` (not `=== undefined`) — the admin field editor sends
    // an explicit `null` for every bound that doesn't apply to whatever
    // fieldType is newly selected (e.g. switching a field to PHONE clears
    // minValue/maxValue), and a full-field-array replace like this has no
    // meaningful distinction between "omitted" and "explicitly cleared" the
    // way the top-level Form scalars in update() do — both just mean "no
    // bound configured".
    if (min == null && max == null) return;

    const allowed = Array.isArray(allowedTypes) ? allowedTypes : [allowedTypes];
    if (!allowed.includes(field.fieldType)) {
      throw new BadRequestException(
        `"${field.label}": ${minKey}/${maxKey} only apply to ${allowed.join('/')} fields`,
      );
    }
    if (min != null && max != null && max < min) {
      throw new BadRequestException(
        `"${field.label}": ${maxKey} must be greater than or equal to ${minKey}`,
      );
    }
  }

  // TEXT/TEXTAREA only, same "wrong fieldType is rejected outright" stance
  // as assertBoundPairValid. A regex is admin-authored (AdminGuard +
  // FORMS_WRITE), not visitor input, but its *syntax* still needs checking
  // here — `new RegExp()` throws a SyntaxError on a malformed pattern, and
  // that must surface as a 400 at save time, not as an unhandled 500 the
  // first time someone submits against it.
  private assertValidFieldPattern(field: FormFieldDto): void {
    // Loose `== null` — see assertBoundPairValid's own comment on why an
    // explicit null (sent whenever the field editor switches a field away
    // from TEXT/TEXTAREA) must be treated the same as omitted here.
    if (field.validationRegex == null) return;
    if (
      field.fieldType !== FormFieldType.TEXT &&
      field.fieldType !== FormFieldType.TEXTAREA
    ) {
      throw new BadRequestException(
        `"${field.label}": validationRegex only applies to TEXT/TEXTAREA fields`,
      );
    }
    try {
      new RegExp(field.validationRegex);
    } catch {
      throw new BadRequestException(
        `"${field.label}": validationRegex is not a valid regular expression`,
      );
    }
  }

  // A rule's fieldId can only reference a field that already exists among
  // the incoming `fields` (has an `id`) — same constraint the admin UI's
  // own picker enforces (only offers fields with an id, mirroring
  // dedupFieldId/nextStepsFieldId's own select). On create(), every
  // incoming field is brand-new (no ids yet), so incomingIds is always
  // empty and any visibilityRule is rejected outright — conditional
  // visibility can only be added once a form has been saved at least once,
  // same real-world constraint dedupField/nextStepsField already have.
  // Unlike those two, there's no separate post-save resolution phase here:
  // visibilityRule is a plain jsonb column (not a `@ManyToOne` relation),
  // so it's set directly in the same fieldRepo.create() call as every
  // other field property — no cyclic-dependency workaround needed.
  private assertValidVisibilityRules(fields: FormFieldDto[]): void {
    const incomingIds = new Set(fields.filter((f) => f.id).map((f) => f.id));
    for (const field of fields) {
      if (!field.visibilityRule) continue;
      if (field.id && field.visibilityRule.fieldId === field.id) {
        throw new BadRequestException(
          `"${field.label}": a visibility condition can't depend on the field's own answer`,
        );
      }
      if (!incomingIds.has(field.visibilityRule.fieldId)) {
        throw new BadRequestException(
          `"${field.label}": visibility condition references an unknown field`,
        );
      }
      // A condition value that isn't one of the trigger field's own
      // options can never match anything a visitor actually submits —
      // caught here rather than left to silently never fire. Only
      // meaningful when the trigger has a fixed option set at all
      // (DROPDOWN/CHECKBOX); free-text triggers (TEXT, NUMBER, ...) have
      // no fixed set to check against.
      const referencedField = fields.find(
        (f) => f.id === field.visibilityRule!.fieldId,
      );
      if (
        referencedField?.options?.length &&
        !referencedField.options.includes(field.visibilityRule.value)
      ) {
        throw new BadRequestException(
          `"${field.label}": visibility condition value "${field.visibilityRule.value}" isn't one of "${referencedField.label}"'s options`,
        );
      }
    }
  }

  // Same "only an existing field can be referenced" constraint
  // assertValidVisibilityRules enforces, applied to every condition across
  // every outcome — same real-world consequence too: a fresh create() call
  // rejects any outcome outright, since none of `fields` have ids yet.
  // actionUrl/actionLabel reuse assertValidGeneralAction's own pairing
  // check, just once per outcome instead of once for the whole form.
  private assertValidPostSubmitOutcomes(
    fields: { id?: string }[],
    outcomes: PostSubmitOutcomeDto[] | null | undefined,
  ): void {
    if (!outcomes) return;
    const incomingIds = new Set(fields.filter((f) => f.id).map((f) => f.id));
    outcomes.forEach((outcome, index) => {
      for (const condition of outcome.conditions) {
        if (!incomingIds.has(condition.fieldId)) {
          throw new BadRequestException(
            `Post-submit outcome #${index + 1}: condition references an unknown field`,
          );
        }
      }
      // Skipped entirely when hideAction is set — actionUrl/actionLabel
      // are forced null regardless in normalizePostSubmitOutcomes below,
      // so there's nothing meaningful to pair-check, and any stray value
      // the client didn't clear shouldn't block the save.
      if (!outcome.hideAction) {
        this.assertValidGeneralAction(outcome.actionUrl, outcome.actionLabel);
      }
    });
  }

  // DTO -> entity shape: the DTO's per-outcome message/actionUrl/
  // actionLabel are each `?: string | null` (omitted meaning "not
  // provided in this outcome", same as everywhere else in this DTO), but
  // the stored PostSubmitOutcome always carries every field explicitly —
  // there's no partial-outcome-patch concept the way Form's own top-level
  // scalars have, a save always replaces the whole outcomes array.
  // hideMessage/hideAction forcing message/actionUrl/actionLabel to null
  // keeps storage unambiguous — "hidden" can never coexist with a leftover
  // value that a naive read might mistake for a custom override.
  private normalizePostSubmitOutcomes(
    outcomes: PostSubmitOutcomeDto[] | null | undefined,
  ): PostSubmitOutcome[] | null {
    if (!outcomes) return null;
    return outcomes.map((o) => ({
      conditions: o.conditions,
      hideMessage: o.hideMessage ?? false,
      message: o.hideMessage ? null : (o.message ?? null),
      hideAction: o.hideAction ?? false,
      actionUrl: o.hideAction ? null : (o.actionUrl ?? null),
      actionLabel: o.hideAction ? null : (o.actionLabel ?? null),
    }));
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

  // Server-side paginated/filtered replacement for the old getAll() — Quiz/
  // Vote turned Forms from a handful of long-lived things into something
  // that genuinely accumulates (a weekly sermon quiz, a recurring vote),
  // so this now matches the pattern GameService/VolunteerService/
  // SmallGroupService already use rather than shipping every row and
  // filtering client-side. search is ILIKE across title/description
  // (IDX_forms_title_trgm/IDX_forms_description_trgm back it); purpose/
  // visibility/status are exact-match (IDX_forms_purpose and the
  // pre-existing idx_forms_visibility/idx_forms_is_active back those).
  async listForms(
    page = 1,
    limit = 20,
    search?: string,
    purpose?: FormPurpose,
    visibility?: FormVisibility,
    status?: 'ACTIVE' | 'INACTIVE',
  ): Promise<PaginationResponseDto<Form>> {
    const baseWhere: FindOptionsWhere<Form> = {};
    if (purpose) baseWhere.purpose = purpose;
    if (visibility) baseWhere.visibility = visibility;
    if (status) baseWhere.isActive = status === 'ACTIVE';

    const trimmedSearch = search?.trim();
    const where: FindOptionsWhere<Form> | FindOptionsWhere<Form>[] =
      trimmedSearch
        ? [
            { ...baseWhere, title: ILike(`%${trimmedSearch}%`) },
            { ...baseWhere, description: ILike(`%${trimmedSearch}%`) },
          ]
        : baseWhere;

    // fields is eager-loaded (Form.fields) but that alone doesn't order the
    // joined rows — without this, Postgres returns them in whatever order
    // its query planner picks, which isn't guaranteed to match each field's
    // own `order` column and can genuinely change between otherwise-
    // identical requests. The admin builder reads `fields` straight off
    // this response (openEdit never does its own per-form GET), so an
    // unordered join here was surfacing as the field list visibly
    // reshuffling itself on every page load/refresh.
    const [forms, total] = await this.formRepo.findAndCount({
      where,
      order: { createdAt: 'DESC', fields: { order: 'ASC' } },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(forms, page, limit, total);
  }

  // Lightweight, unfiltered, unpaginated — for a "pick a form to embed"
  // dropdown (discuva-admin's Pages Registration-section editor) rather
  // than the admin Forms list. A picker can't paginate a single-select, so
  // this deliberately stays "return everything" (CLAUDE.md's Pagination
  // Policy category for admin-curated reference data), separate from
  // listForms above which is the one that actually grows unboundedly.
  // Mirrors GroupService.getLookup's shape.
  async getFormOptions(): Promise<FormOptionDto[]> {
    const forms = await this.formRepo.find({
      order: { title: 'ASC', fields: { order: 'ASC' } },
    });
    return forms.map((form) => ({
      id: form.id,
      title: form.title,
      fields: form.fields.map((field) => ({
        id: field.id,
        pageIndex: field.pageIndex ?? 0,
      })),
    }));
  }

  async getById(id: string): Promise<Form> {
    const form = await this.formRepo.findOne({
      where: { id },
      order: { fields: { order: 'ASC' } },
    });
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
    if (dto.notifyOnSubmission !== undefined) {
      form.notifyOnSubmission = dto.notifyOnSubmission;
    }
    if (dto.editableAfterSubmit !== undefined) {
      form.editableAfterSubmit = dto.editableAfterSubmit;
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
    if (dto.purpose !== undefined) form.purpose = dto.purpose;
    if (dto.oneResponsePerMember !== undefined) {
      form.oneResponsePerMember = dto.oneResponsePerMember;
    }
    if (dto.opensAt !== undefined) {
      form.opensAt = this.parseChurchInstant(dto.opensAt);
    }
    if (dto.closesAt !== undefined) {
      form.closesAt = this.parseChurchInstant(dto.closesAt);
    }
    if (dto.timeLimitMinutes !== undefined) {
      form.timeLimitMinutes = dto.timeLimitMinutes;
    }
    if (dto.revealScoreImmediately !== undefined) {
      form.revealScoreImmediately = dto.revealScoreImmediately;
    }
    // A quiz answer can never be edited after the fact, regardless of what
    // the request sent — see the identical override in create() for why:
    // letting someone revise an answer after their score was already
    // computed (and very possibly shown to them) turns "test" into "look
    // up the answer key and fix it". oneResponsePerMember + the retake
    // flow (FormAttemptService) is the correct, timer-respecting way to
    // let someone try again — never a silent edit of a past submission.
    if (form.purpose === FormPurpose.QUIZ) {
      form.editableAfterSubmit = false;
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
            description: f.description ?? null,
            fieldType: f.fieldType,
            required: f.required ?? false,
            options: f.options ?? null,
            order: f.order ?? index,
            autoFillKey: f.autoFillKey ?? null,
            optionMetadata: f.optionMetadata ?? null,
            minValue: f.minValue ?? null,
            maxValue: f.maxValue ?? null,
            minLength: f.minLength ?? null,
            maxLength: f.maxLength ?? null,
            minSelections: f.minSelections ?? null,
            maxSelections: f.maxSelections ?? null,
            validationRegex: f.validationRegex ?? null,
            validationMessage: f.validationMessage ?? null,
            visibilityRule: f.visibilityRule ?? null,
            pageIndex: f.pageIndex ?? 0,
            correctOptions:
              form.purpose === FormPurpose.QUIZ
                ? (f.correctOptions ?? null)
                : null,
            points:
              form.purpose === FormPurpose.QUIZ ? (f.points ?? null) : null,
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
    if (dto.fields) this.assertValidFieldConstraints(dto.fields);
    if (dto.fields) this.assertValidVisibilityRules(dto.fields);
    this.assertValidPurposeConfig(form.purpose, {
      visibility: form.visibility,
      timeLimitMinutes: form.timeLimitMinutes,
      fields: dto.fields ?? form.fields,
    });
    this.assertValidWindow(form.opensAt, form.closesAt);
    this.assertValidCrossFieldRefs(
      dto.dedupFieldId,
      dto.nextStepsFieldId,
      form.fields,
    );
    this.assertValidGeneralAction(
      form.generalActionUrl,
      form.generalActionLabel,
    );
    if (dto.postSubmitOutcomes !== undefined) {
      // dto.fields (when present) carries the ids this update actually
      // intends to keep — validating against form.fields instead could
      // wrongly accept a reference to a field this same request is about
      // to delete. Falls back to the form's current fields only when this
      // request doesn't touch fields at all.
      this.assertValidPostSubmitOutcomes(
        dto.fields ?? form.fields,
        dto.postSubmitOutcomes,
      );
      form.postSubmitOutcomes = this.normalizePostSubmitOutcomes(
        dto.postSubmitOutcomes,
      );
    }

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
    // QUIZ leaderboard — highest score first, most recent first among ties.
    // Meaningless for a non-QUIZ form (score is always null there), but
    // harmless to accept regardless rather than 400ing on it.
    sortBy?: 'createdAt' | 'score',
  ): Promise<PaginationResponseDto<FormSubmission>> {
    await this.getById(formId);
    let data: FormSubmission[];
    let total: number;
    if (sortBy === 'score') {
      // NULLS LAST, not TypeORM's plain `order` option (Postgres defaults
      // DESC to NULLS FIRST) — otherwise a submission from before an admin
      // added correctOptions to a question (still null score) would
      // outrank every real scored submission on the leaderboard.
      const qb = this.submissionRepo
        .createQueryBuilder('submission')
        .leftJoinAndSelect('submission.member', 'member')
        .where('submission.form_id = :formId', { formId })
        .orderBy('submission.score', 'DESC', 'NULLS LAST')
        .addOrderBy('submission.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);
      [data, total] = await qb.getManyAndCount();
    } else {
      [data, total] = await this.submissionRepo.findAndCount({
        where: { form: { id: formId } },
        relations: ['member'],
        order: { createdAt: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      });
    }
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
      const answerCells = fields.map((f) =>
        this.formatCsvCell(f, s.answers[f.id]),
      );
      return [s.createdAt.toISOString(), submittedBy, ...answerCells];
    });

    const escape = (cell: string) => `"${cell.replaceAll('"', '""')}"`;
    return [header, ...rows].map((row) => row.map(escape).join(',')).join('\n');
  }

  // A FILE answer is a { url, publicId } object, not something String()
  // can meaningfully render — emit the URL instead so the CSV stays a
  // clickable link to the uploaded file.
  private formatCsvCell(field: FormField, value: unknown): string {
    if (field.fieldType === FormFieldType.FILE) {
      const url = (value as { url?: unknown } | null)?.url;
      return typeof url === 'string' ? url : '';
    }
    if (Array.isArray(value)) return value.join('; ');
    return value === null || value === undefined ? '' : String(value);
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
      // Sorted highest-count first (stable — ties keep their original
      // options-declaration order) so the leading choice is always
      // index 0, not just discoverable by scanning every percentage.
      // Matters most for VOTE ("who's leading the poll"), but a
      // STANDARD form's own choice field (e.g. "Which ministry
      // interests you?") reads better most-popular-first too.
      const choices = [...counts.entries()]
        .map(([option, count]) => ({
          option,
          count,
          percentage:
            totalSelections === 0
              ? 0
              : Math.round((count / totalSelections) * 1000) / 10,
        }))
        .sort((a, b) => b.count - a.count);
      return { ...base, choices };
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

    if (field.fieldType === FormFieldType.FILE) {
      return { ...base, uploadCount: answers.length };
    }

    return {
      ...base,
      sampleAnswers: answers
        .slice(0, SAMPLE_ANSWER_LIMIT)
        .map((a) => (Array.isArray(a) ? a.join(', ') : String(a))),
    };
  }
}
