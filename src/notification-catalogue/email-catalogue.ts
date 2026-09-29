import * as fs from 'node:fs';
import * as path from 'node:path';
import * as Handlebars from 'handlebars';
import { EmailCategory } from '../utility/email-provider/email-category.enum';

export enum EmailTemplateKey {
  WELCOME_MEMBER = 'welcome-member',
  HAPPY_BIRTHDAY = 'happy-birthday',
  SERVICE_REMINDER = 'service-reminder',
  FIRST_TIMER_INVITE = 'first-timer-membership-invite',
  TITHE_CONFIRMED = 'tithe-proof-confirmed',
  PLEDGE_CONFIRMED = 'pledge-contribution-confirmed',
  CLASS_SESSION_REMINDER = 'class-session-reminder',
  ASSIGNMENT_DUE_REMINDER = 'assignment-due-reminder',
}

// The parts of an email a church may edit; everything else in the content file stays locked.
export interface EmailWording {
  subject: string;
  heading: string;
  message: string;
  closing: string;
  signoff: string;
  signature: string;
}

export const EMAIL_FIELD_LIMITS: Record<keyof EmailWording, number> = {
  subject: 150,
  heading: 120,
  message: 5000,
  closing: 3000,
  signoff: 60,
  signature: 80,
};

export const RICH_EMAIL_FIELDS: (keyof EmailWording)[] = ['message', 'closing'];

type TemplateData = Record<string, unknown>;

export interface EmailTemplate extends EmailWording {
  // null for emails that always send (no on/off switch), e.g. account emails.
  category: EmailCategory | null;
  label: string;
  description: string;
  preheader: string;
  // What stays fixed, shown to admins so they know what they can't change.
  lockedNote: string;
  // Placeholder name -> sample value; church_name is always available.
  placeholders: Record<string, string>;
  toVars: (data: TemplateData) => Record<string, string>;
  // Stand-in data for the locked parts in previews and test emails.
  sampleData: TemplateData;
}

const s = (v: unknown): string => (v == null ? '' : String(v));

// Defaults reproduce the pre-catalogue emails word for word.
export const EMAIL_CATALOGUE: Record<EmailTemplateKey, EmailTemplate> = {
  [EmailTemplateKey.WELCOME_MEMBER]: {
    category: null,
    label: 'Welcome to a new member',
    description:
      'Sent when a member signs up or is added by an admin, with their sign-in details.',
    lockedNote:
      'Their email, temporary password and sign-in link are always included.',
    subject: '{{first_name}}, Welcome to {{church_name}}',
    heading: 'Welcome, {{first_name}}!',
    message:
      "<p>Your account has been created and you're now a registered member of {{church_name}}. We're so glad to have you with us!</p>",
    closing: '',
    signoff: 'God bless you,',
    signature: '{{church_name}}',
    preheader: 'Welcome to {{church_name}}! Your membership account is ready.',
    placeholders: { first_name: 'Ada' },
    toVars: (d) => ({ first_name: s(d.name) }),
    sampleData: {
      name: 'Ada',
      email: 'ada@example.com',
      password: '••••••••',
    },
  },
  [EmailTemplateKey.HAPPY_BIRTHDAY]: {
    category: EmailCategory.BIRTHDAY,
    label: 'Birthday greeting',
    description: 'Sent to members on their birthday.',
    lockedNote: 'Nothing is locked — the whole message is yours.',
    subject: 'Happy Birthday, {{first_name}}!',
    heading: 'Happy Birthday, {{first_name}}!',
    message:
      '<p>On behalf of the entire {{church_name}} family, we want to celebrate you today, {{full_name}}. You are a blessing to this congregation and we are grateful for you.</p>' +
      '<div class="highlight"><p>"For I know the plans I have for you," declares the Lord, "plans to prosper you and not to harm you, plans to give you hope and a future." — Jeremiah 29:11</p></div>' +
      "<p>May this new year of your life be filled with God's overflowing grace, renewed strength, and the fulfilment of every promise He has spoken over your life.</p>" +
      '<p>Open the church app to see the birthday wishes your church family has sent you — a little birthday book just for you.</p>',
    closing: '',
    signoff: 'With love and prayers,',
    signature: '{{church_name}} Family',
    preheader:
      "Wishing you a beautiful birthday filled with God's blessings, {{first_name}}!",
    placeholders: { first_name: 'Ada', full_name: 'Ada Obi' },
    toVars: (d) => ({ first_name: s(d.name), full_name: s(d.full_name) }),
    sampleData: { name: 'Ada', full_name: 'Ada Obi' },
  },
  [EmailTemplateKey.SERVICE_REMINDER]: {
    category: EmailCategory.EVENT_REMINDER,
    label: 'Service reminder',
    description:
      'Sent ahead of a service, at the times set in Event Reminders.',
    lockedNote: 'The service name and start time box is always included.',
    subject: 'Service Reminder: {{service_name}}',
    heading: 'Service Reminder',
    message:
      '<p>This is a friendly reminder that <strong>{{service_name}}</strong> begins in <strong>{{time_until}}</strong>. Please begin making your way so you can check in on time.</p>' +
      '<p>Open the app to check in when you arrive. We look forward to worshipping with you!</p>',
    closing: '',
    signoff: 'God bless you,',
    signature: '{{church_name}} Team',
    preheader: '{{service_name}} starts in {{time_until}} — see you there!',
    placeholders: {
      service_name: 'Sunday Service',
      time_until: '1 hour',
      start_time: '09:00',
    },
    toVars: (d) => ({
      service_name: s(d.slot_name),
      time_until: s(d.time_label),
      start_time: s(d.start_time),
    }),
    sampleData: {
      slot_name: 'Sunday Service',
      time_label: '1 hour',
      start_time: '09:00',
    },
  },
  [EmailTemplateKey.FIRST_TIMER_INVITE]: {
    category: EmailCategory.FOLLOW_UP,
    label: 'Membership invite to a first-timer',
    description:
      'Sent when the Follow-Up team invites a first-time visitor to become a member.',
    lockedNote: 'Nothing is locked — the whole message is yours.',
    subject: "You're Invited to Join {{church_name}}",
    heading: 'Dear {{first_name}},',
    message:
      "<p>It was a joy having you with us, and we've been thinking about you! We'd love to welcome you as an official member of {{church_name}}.</p>" +
      "<p>Becoming a member means joining a community that will walk with you, pray with you, and celebrate life's moments alongside you. There are no forms to fill out right now — just reach out to us and we'll guide you through the next steps.</p>" +
      '<p>Simply reply to this email, call us, or visit us this Sunday. We look forward to seeing you again, {{first_name}}!</p>',
    closing: '',
    signoff: 'With warm regards,',
    signature: '{{church_name}}',
    preheader:
      "You're invited to become a member of {{church_name}}. We'd love to welcome you officially!",
    placeholders: { first_name: 'Ada', last_name: 'Obi' },
    toVars: (d) => ({ first_name: s(d.firstname), last_name: s(d.lastname) }),
    sampleData: { firstname: 'Ada', lastname: 'Obi' },
  },
  [EmailTemplateKey.TITHE_CONFIRMED]: {
    category: EmailCategory.GIVING_RECEIPT,
    label: 'Tithe payment confirmed',
    description:
      "Sent when the finance team confirms a member's tithe payment proof.",
    lockedNote: 'The amount and date are always included.',
    subject: 'Your Tithe Payment Has Been Confirmed',
    heading: 'Tithe Payment Confirmed',
    message:
      '<p>Dear {{first_name}},</p><p>Great news! Your tithe payment proof has been reviewed and <strong>confirmed</strong> by the finance team.</p>',
    closing:
      '<p>Thank you for your faithfulness in tithing. God bless you!</p>',
    signoff: 'Sincerely,',
    signature: '{{church_name}} Finance Team',
    preheader: 'Your tithe payment proof has been successfully confirmed.',
    placeholders: {
      first_name: 'Ada',
      amount: 'NGN 50,000',
      payment_date: '2026-09-27',
    },
    toVars: (d) => ({
      first_name: s(d.name),
      amount: s(d.amount),
      payment_date: s(d.paymentDate),
    }),
    sampleData: {
      name: 'Ada',
      amount: 'NGN 50,000',
      paymentDate: '2026-09-27',
    },
  },
  [EmailTemplateKey.PLEDGE_CONFIRMED]: {
    category: EmailCategory.GIVING_RECEIPT,
    label: 'Pledge payment confirmed',
    description:
      "Sent when the finance team confirms a payment toward a member's pledge.",
    lockedNote: 'The campaign, amount and date are always included.',
    subject: 'Your Pledge Payment Has Been Confirmed',
    heading: 'Pledge Payment Confirmed',
    message:
      '<p>Dear {{first_name}},</p><p>Great news! The payment you logged against your pledge to <strong>{{campaign_name}}</strong> has been reviewed and <strong>confirmed</strong> by the finance team.</p>',
    closing: '<p>Thank you for your faithfulness in giving. God bless you!</p>',
    signoff: 'Sincerely,',
    signature: '{{church_name}} Finance Team',
    preheader: 'Your pledge payment has been confirmed.',
    placeholders: {
      first_name: 'Ada',
      campaign_name: 'Building Fund',
      amount: '20,000',
      payment_date: '2026-09-27',
    },
    toVars: (d) => ({
      first_name: s(d.name),
      campaign_name: s(d.campaignName),
      amount: s(d.amount),
      payment_date: s(d.paymentDate),
    }),
    sampleData: {
      name: 'Ada',
      campaignName: 'Building Fund',
      amount: '20,000',
      paymentDate: '2026-09-27',
    },
  },
  [EmailTemplateKey.CLASS_SESSION_REMINDER]: {
    category: EmailCategory.CLASS_SESSION_REMINDER,
    label: 'Class session reminder',
    description: 'Sent to enrolled members before a class session.',
    lockedNote:
      'The session time and, for online classes, the Join button are always included.',
    subject: '{{class_name}} {{status_title}}',
    heading: 'Class Session Reminder',
    message:
      '<p>Hi {{first_name}}, <strong>{{class_name}}</strong> {{status}}.</p>',
    closing: '',
    signoff: 'Sincerely,',
    signature: '{{church_name}}',
    preheader: "{{class_name}} {{status}} — here's how to join.",
    placeholders: {
      first_name: 'Ada',
      class_name: 'Foundation Class',
      status: 'starts in 1 hour',
      status_title: 'Starts in 1 Hour',
    },
    toVars: (d) => ({
      first_name: s(d.name),
      class_name: s(d.className),
      status: s(d.status),
      status_title: s(d.statusTitle),
    }),
    sampleData: {
      name: 'Ada',
      className: 'Foundation Class',
      status: 'starts in 1 hour',
      statusTitle: 'Starts in 1 Hour',
      sessionTime: '2026-10-04T09:00:00.000Z',
      meetingLink: 'https://meet.example.com/foundation',
    },
  },
  [EmailTemplateKey.ASSIGNMENT_DUE_REMINDER]: {
    category: EmailCategory.ASSIGNMENT_REMINDER,
    label: 'Assignment due reminder',
    description: "Sent before a class assignment's due date.",
    lockedNote:
      'The assignment title, due date and Submit button are always included.',
    subject:
      '{{first_name}}, Your Assignment for {{class_name}} Is {{status_title}}',
    heading: 'Assignment Reminder',
    message:
      '<p>Hi {{first_name}}, this is a reminder that your assignment for <strong>{{class_name}}</strong> is {{status}}.</p>',
    closing: '',
    signoff: 'Sincerely,',
    signature: '{{church_name}}',
    preheader: 'Your assignment for {{class_name}} is {{status}}.',
    placeholders: {
      first_name: 'Ada',
      class_name: 'Foundation Class',
      status: 'due tomorrow',
      status_title: 'Due Tomorrow',
    },
    toVars: (d) => ({
      first_name: s(d.name),
      class_name: s(d.className),
      status: s(d.status),
      status_title: s(d.statusTitle),
    }),
    sampleData: {
      name: 'Ada',
      className: 'Foundation Class',
      assignmentTitle: 'Week 3 reflection',
      dueDate: '2026-10-05',
      status: 'due tomorrow',
      statusTitle: 'Due Tomorrow',
      portalUrl: 'https://example.com/classes',
    },
  },
};

export function isCatalogueEmail(name: string): name is EmailTemplateKey {
  return name in EMAIL_CATALOGUE;
}

export function defaultWording(key: EmailTemplateKey): EmailWording {
  const { subject, heading, message, closing, signoff, signature } =
    EMAIL_CATALOGUE[key];
  return { subject, heading, message, closing, signoff, signature };
}

const TOKEN = /{{\s*(\w+)\s*}}/g;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Plain token replacement — church wording is never compiled as a template.
function fillText(text: string, vars: Record<string, string>): string {
  return text.replace(TOKEN, (_, name: string) => vars[name] ?? '').trim();
}

function fillHtml(html: string, vars: Record<string, string>): string {
  return html.replace(TOKEN, (_, name: string) => escapeHtml(vars[name] ?? ''));
}

const TEMPLATE_DIR = path.resolve(__dirname, '..', 'utility', 'templates');
const compiled = new Map<string, Handlebars.TemplateDelegate>();

function compileFile(relative: string): Handlebars.TemplateDelegate {
  let template = compiled.get(relative);
  if (!template) {
    template = Handlebars.compile(
      fs.readFileSync(path.join(TEMPLATE_DIR, relative), 'utf-8'),
    );
    compiled.set(relative, template);
  }
  return template;
}

export function renderCatalogueEmail(
  key: EmailTemplateKey,
  wording: EmailWording,
  data: TemplateData,
  branding: Record<string, string>,
): { subject: string; html: string } {
  const template = EMAIL_CATALOGUE[key];
  const vars = {
    church_name: branding.church_name ?? '',
    ...template.toVars(data),
  };
  const subject = fillText(wording.subject, vars);
  const base = { ...branding, ...data };
  const content = compileFile(`content/${key}.html`)({
    ...base,
    heading: fillText(wording.heading, vars),
    message_html: fillHtml(wording.message, vars),
    closing_html: fillHtml(wording.closing, vars),
  });
  const html = compileFile('layouts/base.html')({
    ...base,
    subject,
    preheader: fillText(template.preheader, vars),
    signoff: fillText(wording.signoff, vars),
    signature: fillText(wording.signature, vars),
    content,
  });
  return { subject, html };
}
