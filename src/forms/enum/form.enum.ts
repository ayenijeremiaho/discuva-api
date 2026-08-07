export enum FormVisibility {
  MEMBERS = 'MEMBERS',
  PUBLIC = 'PUBLIC',
}

export enum FormFieldType {
  TEXT = 'TEXT',
  NUMBER = 'NUMBER',
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
  TEXTAREA = 'TEXTAREA',
  DATE = 'DATE',
  DROPDOWN = 'DROPDOWN',
  CHECKBOX = 'CHECKBOX',
}

// Fields flagged with one of these pre-fill from the logged-in member's own
// profile in the member-facing fill UI (still editable) — never applies to
// public/anonymous submissions, since there's no member to infer from.
export enum FormFieldAutoFill {
  FIRST_NAME = 'FIRST_NAME',
  LAST_NAME = 'LAST_NAME',
  EMAIL = 'EMAIL',
  PHONE_NUMBER = 'PHONE_NUMBER',
}

// DROPDOWN/CHECKBOX are the only types that need an options list.
export const FIELD_TYPES_REQUIRING_OPTIONS = new Set([
  FormFieldType.DROPDOWN,
  FormFieldType.CHECKBOX,
]);
