import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';

// `id` is client-generated (uuid), not a DB row id — entries live in a plain
// jsonb array (no relation), same reasoning PageSection/Form.postSubmitOutcomes
// already use in this codebase: no per-entry DB row to diff against, and the
// builder always sends the complete current array on save.
export interface ChurchCalendarEntry {
  id: string;
  date: string; // must fall within [startDate, endDate] — see ChurchCalendarService.assertValidEntries
  time?: string; // 24-hour 'HH:mm', optional — an all-day/time-TBD entry omits it
  title: string;
  description?: string;
  imageUrl?: string;
}

@Entity({ name: 'church_calendars' })
export class ChurchCalendar extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // "September Programme", "2026 Church Calendar"
  @Column()
  title: string;

  // Optional monthly/yearly theme, e.g. "REMEMBERED" — shown on both the
  // member-facing list and the exported flyer when set.
  @Column({ nullable: true })
  theme: string | null;

  // A date range rather than a single month/year field — supports a normal
  // one-month calendar as well as a full-year one, or any custom range in
  // between. Every entry's own date must fall inside [startDate, endDate].
  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  // Hex color driving the exported flyer's accent/gradient bands — there's
  // no tenant-wide brand-color setting to fall back to (checked: Mobile App
  // Appearance only configures logo/PWA icons), so the flyer template falls
  // back to a built-in default color when this is unset.
  @Column({ name: 'accent_color', nullable: true })
  accentColor: string | null;

  // Only a published calendar is ever returned by the member-facing
  // endpoint — lets an admin build/save a draft before it's visible.
  @Column({ name: 'is_published', default: false })
  isPublished: boolean;

  @Column({ type: 'jsonb', default: [] })
  entries: ChurchCalendarEntry[];
}
