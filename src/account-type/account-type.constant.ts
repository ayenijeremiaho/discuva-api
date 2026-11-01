import { OrganisationTypeEnum } from '../tenant/enum/organisation-type.enum';
import { KNOWN_MODULES } from '../church-settings/constants/known-modules.constant';

export type ModuleAvailability = 'on' | 'off' | 'hidden';
export interface Term {
  one: string;
  many: string;
}
type Words = Record<OrganisationTypeEnum, Term>;

const same = (one: string, many: string, others: [Term, Term]): Words => ({
  [OrganisationTypeEnum.CHURCH]: { one, many },
  [OrganisationTypeEnum.MINISTRY]: others[0],
  [OrganisationTypeEnum.GROUP]: others[1],
});
const term = (one: string, many = `${one}s`): Term => ({ one, many });

// Longer phrases come first where one contains another. Church wording is what the apps' source text is written in.
export const ACCOUNT_TERMS: {
  key: string;
  label: string;
  also?: Term[];
  words: Words;
}[] = [
  {
    key: 'church_calendar',
    label: 'Calendar',
    words: same('Church Calendar', 'Church Calendars', [
      term('Calendar'),
      term('Calendar'),
    ]),
  },
  {
    key: 'church_settings',
    label: 'Settings menu',
    words: same('Church Settings', 'Church Settings', [
      term('Settings', 'Settings'),
      term('Settings', 'Settings'),
    ]),
  },
  {
    key: 'ministry',
    label: 'Area of work',
    words: same('Ministry', 'Ministries', [
      term('Organisation'),
      term('Group'),
    ]),
  },
  {
    key: 'church',
    label: 'The organisation',
    words: same('Church', 'Churches', [term('Organisation'), term('Group')]),
  },
  {
    key: 'congregation',
    label: 'The people',
    words: same('Congregation', 'Congregations', [
      term('Community', 'Communities'),
      term('Group'),
    ]),
  },
  {
    key: 'service_programme',
    label: 'Plan for a gathering',
    also: [term('Order of Service', 'Orders of Service')],
    words: same('Service Programme', 'Service Programmes', [
      term('Meeting Plan'),
      term('Meeting Plan'),
    ]),
  },
  {
    key: 'service',
    label: 'Gathering',
    words: same('Service', 'Services', [term('Meeting'), term('Meeting')]),
  },
  {
    key: 'department',
    label: 'Working team',
    words: same('Department', 'Departments', [term('Team'), term('Team')]),
  },
  {
    key: 'worker',
    label: 'Person who serves',
    words: same('Worker', 'Workers', [term('Team member'), term('Helper')]),
  },
  {
    key: 'pastor',
    label: 'Main leader',
    words: same('Pastor', 'Pastors', [term('Leader'), term('Leader')]),
  },
  {
    key: 'clergy',
    label: 'Senior leaders',
    words: same('Clergy', 'Clergy', [
      term('Leadership', 'Leadership'),
      term('Leadership', 'Leadership'),
    ]),
  },
  {
    key: 'sermon',
    label: 'Recorded message',
    words: same('Sermon', 'Sermons', [term('Talk'), term('Teaching')]),
  },
  {
    key: 'first_timer',
    label: 'Someone new',
    also: [term('First timer'), term('Firsttimer')],
    words: same('First-timer', 'First-timers', [
      term('New contact'),
      term('Visitor'),
    ]),
  },
  {
    key: 'fellowship',
    label: 'Small circle',
    words: same('Fellowship', 'Fellowships', [
      term('Small group'),
      term('Small group'),
    ]),
  },
  {
    key: 'giving',
    label: 'Money given',
    words: same('Giving', 'Giving', [
      term('Donations', 'Donations'),
      term('Contributions', 'Contributions'),
    ]),
  },
  {
    key: 'tithe',
    label: 'Regular gift',
    words: same('Tithe', 'Tithes', [term('Donation'), term('Contribution')]),
  },
  {
    key: 'offering',
    label: 'One-off gift',
    words: same('Offering', 'Offerings', [
      term('Donation'),
      term('Contribution'),
    ]),
  },
];

// Ordinary phrases that happen to contain a dictionary word.
export const PROTECTED_PHRASES = [
  'Terms of Service',
  'Customer Service',
  'Service Worker',
  'Social Worker',
  "Children's Church",
  'Self-service',
  'Service fee',
  'Service fees',
];

const OFF_FOR_NGO = [
  'small_groups',
  'evangelism',
  'pastor_feedback',
  'sermons',
  'service_ratings',
  'sunday_school',
  'children_church',
  'facility_rental',
  'social_media',
  'youtube_integration',
];
const OFF_FOR_GROUP = [
  ...OFF_FOR_NGO,
  'departments',
  'service_programme',
  'serving_rota',
  'volunteering',
  'classes',
  'department_goals',
  'team_pulse',
  'tithe',
  'asset_management',
  'incident_report',
  'follow_up',
  'newcomer_journey',
];

export function defaultAvailability(
  type: OrganisationTypeEnum,
): Record<string, ModuleAvailability> {
  const off =
    type === OrganisationTypeEnum.GROUP
      ? OFF_FOR_GROUP
      : type === OrganisationTypeEnum.MINISTRY
        ? OFF_FOR_NGO
        : [];
  return Object.fromEntries(
    KNOWN_MODULES.map((m) => [m.key, off.includes(m.key) ? 'off' : 'on']),
  );
}
