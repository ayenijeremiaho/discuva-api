import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  addDays,
  addHours,
  addMinutes,
  addSeconds,
  endOfDay,
  format,
  isAfter,
  isBefore,
  parseISO,
  startOfDay,
  subDays,
  subHours,
  subMinutes,
  subSeconds,
} from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

/**
 * Date utility service that provides a clean interface for date operations.
 * Uses date-fns (v4) which is the modern replacement for moment.js.
 *
 * This service provides:
 * - Consistent date handling across the application
 * - Better performance than moment.js
 * - Tree-shaking support (only used functions are bundled)
 * - Immutable operations (returns new Date objects)
 */
@Injectable()
export class DateService {
  private readonly timezone: string;

  constructor(private readonly configService: ConfigService) {
    this.timezone =
      this.configService.get<string>('TIMEZONE') ?? 'Africa/Lagos';
  }
  /**
   * Get current date and time
   */
  now(): Date {
    return new Date();
  }

  /**
   * Subtract days from a date
   * @param date - The base date
   * @param days - Number of days to subtract
   */
  subtractDays(date: Date, days: number): Date {
    return subDays(date, days);
  }

  /**
   * Add days to a date
   * @param date - The base date
   * @param days - Number of days to add
   */
  addDays(date: Date, days: number): Date {
    return addDays(date, days);
  }

  /**
   * Subtract hours from a date
   * @param date - The base date
   * @param hours - Number of hours to subtract
   */
  subtractHours(date: Date, hours: number): Date {
    return subHours(date, hours);
  }

  /**
   * Add hours to a date
   * @param date - The base date
   * @param hours - Number of hours to add
   */
  addHours(date: Date, hours: number): Date {
    return addHours(date, hours);
  }

  /**
   * Subtract minutes from a date
   * @param date - The base date
   * @param minutes - Number of minutes to subtract
   */
  subtractMinutes(date: Date, minutes: number): Date {
    return subMinutes(date, minutes);
  }

  /**
   * Add minutes to a date
   * @param date - The base date
   * @param minutes - Number of minutes to add
   */
  addMinutes(date: Date, minutes: number): Date {
    return addMinutes(date, minutes);
  }

  /**
   * Subtract seconds from a date
   * @param date - The base date
   * @param seconds - Number of seconds to subtract
   */
  subtractSeconds(date: Date, seconds: number): Date {
    return subSeconds(date, seconds);
  }

  /**
   * Add seconds to a date
   * @param date - The base date
   * @param seconds - Number of seconds to add
   */
  addSeconds(date: Date, seconds: number): Date {
    return addSeconds(date, seconds);
  }

  /**
   * Get start of day (midnight) in the church's configured timezone,
   * regardless of the server process's own timezone.
   * @param date - The date to get start of day for (defaults to now)
   */
  startOfDay(date?: Date): Date {
    const zoned = toZonedTime(date || new Date(), this.timezone);
    return fromZonedTime(startOfDay(zoned), this.timezone);
  }

  /**
   * Get end of day (last millisecond of the day) in the church's configured
   * timezone, regardless of the server process's own timezone.
   * @param date - The date to get end of day for (defaults to now)
   */
  endOfDay(date?: Date): Date {
    const zoned = toZonedTime(date || new Date(), this.timezone);
    return fromZonedTime(endOfDay(zoned), this.timezone);
  }

  /**
   * Format a date using a pattern
   * @param date - The date to format
   * @param pattern - The format pattern (e.g., 'yyyy-MM-dd', 'EEE, MMMM do, yyyy')
   */
  format(date: Date, pattern: string): string {
    return format(date, pattern);
  }

  // Today's date, as a plain 'yyyy-MM-dd' string, in the church's configured
  // timezone — for comparing against a `date`-typed column (e.g.
  // `endDate >= today`). Plain `format(new Date(), ...)` would render using
  // the server process's own timezone, which can land on the wrong
  // calendar day near midnight when the server runs in UTC and the church
  // doesn't (toZonedTime shifts the underlying instant so format()'s local
  // getters read back the church's own wall-clock date, the same trick
  // startOfDay()/endOfDay() above already rely on).
  today(): string {
    return format(toZonedTime(new Date(), this.timezone), 'yyyy-MM-dd');
  }

  /**
   * Check if date1 is before date2
   * @param date1 - First date
   * @param date2 - Second date
   */
  isBefore(date1: Date, date2: Date): boolean {
    return isBefore(date1, date2);
  }

  /**
   * Check if date1 is after date2
   * @param date1 - First date
   * @param date2 - Second date
   */
  isAfter(date1: Date, date2: Date): boolean {
    return isAfter(date1, date2);
  }

  /**
   * Check if date1 is same as or after date2
   * @param date1 - First date
   * @param date2 - Second date
   */
  isSameOrAfter(date1: Date, date2: Date): boolean {
    return !this.isBefore(date1, date2);
  }

  /**
   * Parse an ISO date string
   * @param dateString - ISO date string
   */
  parseISO(dateString: string): Date {
    return parseISO(dateString);
  }

  /**
   * Get the date N days ago from now
   * @param days - Number of days ago
   */
  daysAgo(days: number): Date {
    return this.subtractDays(new Date(), days);
  }

  /**
   * Get the date N hours ago from now
   * @param hours - Number of hours ago
   */
  hoursAgo(hours: number): Date {
    return this.subtractHours(new Date(), hours);
  }

  /**
   * Get the date N minutes ago from now
   * @param minutes - Number of minutes ago
   */
  minutesAgo(minutes: number): Date {
    return this.subtractMinutes(new Date(), minutes);
  }

  /**
   * Get the date N seconds ago from now
   * @param seconds - Number of seconds ago
   */
  secondsAgo(seconds: number): Date {
    return this.subtractSeconds(new Date(), seconds);
  }

  /**
   * Get the date N days from now
   * @param days - Number of days from now
   */
  daysFromNow(days: number): Date {
    return this.addDays(new Date(), days);
  }

  /**
   * Get the date N hours from now
   * @param hours - Number of hours from now
   */
  hoursFromNow(hours: number): Date {
    return this.addHours(new Date(), hours);
  }

  /**
   * Get the date N minutes from now
   * @param minutes - Number of minutes from now
   */
  minutesFromNow(minutes: number): Date {
    return this.addMinutes(new Date(), minutes);
  }

  /**
   * Get the date N seconds from now
   * @param seconds - Number of seconds from now
   */
  secondsFromNow(seconds: number): Date {
    return this.addSeconds(new Date(), seconds);
  }

  /**
   * Format patterns for common use cases
   */
  static readonly PATTERNS = {
    DATE: 'yyyy-MM-dd',
    DATE_LONG: 'EEEE, MMMM do, yyyy',
    DATE_MEDIUM: 'MMM d, yyyy',
    DATE_SHORT: 'MM/dd/yyyy',

    TIME: 'HH:mm:ss',
    TIME_12H: 'h:mm:ss a',
    TIME_SHORT: 'h:mm a',

    DATETIME: 'yyyy-MM-dd HH:mm:ss',
    DATETIME_LONG: 'EEEE, MMMM do, yyyy h:mm:ss a',
    DATETIME_MEDIUM: 'MMM d, yyyy h:mm a',

    EMAIL_DATE: 'EEEE, MMMM d, yyyy',
    EMAIL_TIME: 'h:mm a',
  };
}
