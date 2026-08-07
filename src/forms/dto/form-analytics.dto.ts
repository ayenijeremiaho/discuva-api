import { FormFieldType } from '../enum/form.enum';

export interface FormFieldChoiceBreakdown {
  option: string;
  count: number;
  percentage: number;
}

export interface FormFieldAnalyticsDto {
  fieldId: string;
  label: string;
  fieldType: FormFieldType;
  responseCount: number;
  // Populated for DROPDOWN/CHECKBOX only.
  choices?: FormFieldChoiceBreakdown[];
  // Populated for NUMBER only.
  average?: number | null;
  min?: number | null;
  max?: number | null;
  // Populated for every other field type (TEXT, EMAIL, PHONE, TEXTAREA,
  // DATE) — most recent answers first, capped so a heavily-used form
  // doesn't return an unbounded payload.
  sampleAnswers?: string[];
}

export interface FormAnalyticsDto {
  formId: string;
  title: string;
  totalSubmissions: number;
  fields: FormFieldAnalyticsDto[];
}
