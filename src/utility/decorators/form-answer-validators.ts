import { isEmail, isNumberString, isDateString } from 'class-validator';

// Format-only checks for a Form's EMAIL/NUMBER/DATE field types (see
// FormSubmissionService.validateAnswers). Unlike normalizePhoneNumber, these
// never rewrite the submitted value — a NUMBER answer is validated as a
// numeric string but stored exactly as typed, so getAnalytics/CSV export's
// existing string-tolerant handling of answers is untouched.
export function isValidEmail(raw: string): boolean {
  return isEmail(raw.trim());
}

export function isValidNumber(raw: string): boolean {
  return isNumberString(raw.trim());
}

export function isValidDateString(raw: string): boolean {
  return isDateString(raw.trim());
}
