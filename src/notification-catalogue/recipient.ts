import { GenderEnum } from '../member/enums/gender.enum';
import { MaritalStatusEnum } from '../member/enums/marital-status.enum';

// Details of whoever receives the message, usable in every email and push; blank when not known.
export const RECIPIENT_PLACEHOLDERS: Record<string, string> = {
  first_name: 'Ada',
  last_name: 'Obi',
  full_name: 'Ada Obi',
  email: 'ada@example.com',
  phone: '+2348012345678',
  title: 'Mrs',
  church_title: 'Sister',
  department: 'Media',
};

export interface RecipientDetails {
  firstname?: string | null;
  lastname?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
  gender?: string | null;
  maritalStatus?: string | null;
  department?: string | null;
}

function title(gender?: string | null, marital?: string | null): string {
  if (gender === GenderEnum.MALE) return 'Mr';
  if (gender !== GenderEnum.FEMALE) return '';
  if (
    marital === MaritalStatusEnum.MARRIED ||
    marital === MaritalStatusEnum.WIDOWED
  )
    return 'Mrs';
  return marital === MaritalStatusEnum.SINGLE ? 'Miss' : 'Ms';
}

function churchTitle(gender?: string | null): string {
  if (gender === GenderEnum.MALE) return 'Brother';
  return gender === GenderEnum.FEMALE ? 'Sister' : '';
}

export function recipientVars(
  r?: RecipientDetails | null,
): Record<string, string> {
  if (!r) return {};
  const first = r.firstname?.trim() ?? '';
  const last = r.lastname?.trim() ?? '';
  return {
    first_name: first,
    last_name: last,
    full_name: `${first} ${last}`.trim(),
    email: r.email ?? '',
    phone: r.phoneNumber ?? '',
    title: title(r.gender, r.maritalStatus),
    church_title: churchTitle(r.gender),
    department: r.department ?? '',
  };
}

const TOKEN = /{{\s*(\w+)\s*}}/g;

// True when the wording uses a recipient detail the sender didn't already supply.
export function needsRecipient(
  texts: string[],
  provided: Record<string, unknown>,
): boolean {
  return texts.some((text) =>
    [...text.matchAll(TOKEN)].some(
      ([, name]) => name in RECIPIENT_PLACEHOLDERS && !provided[name],
    ),
  );
}

// Sender-supplied values win; recipient details only fill the gaps.
export function withRecipient(
  vars: Record<string, string>,
  recipient: Record<string, string>,
): Record<string, string> {
  const merged = { ...recipient };
  for (const [key, value] of Object.entries(vars)) {
    if (value || !(key in merged)) merged[key] = value;
  }
  return merged;
}
