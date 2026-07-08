import { Injectable } from '@nestjs/common';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

/**
 * Sanitization service for XSS prevention.
 * Uses DOMPurify to sanitize HTML content and user input.
 *
 * This service provides:
 * - XSS attack prevention
 * - HTML sanitization
 * - Safe text escaping
 * - Configurable sanitization rules
 */
@Injectable()
export class SanitizationService {
  private readonly purify: typeof DOMPurify;

  constructor() {
    // Create a window object for DOMPurify to use
    const window = new JSDOM('').window;
    this.purify = DOMPurify(window);
  }

  /**
   * Sanitize HTML content to prevent XSS attacks.
   * Removes potentially dangerous elements and attributes.
   *
   * @param dirty - The potentially unsafe HTML string
   * @param options - Optional sanitization options
   * @returns Clean, safe HTML string
   */
  sanitizeHtml(dirty: string, options?: DOMPurify.Config): string {
    return this.purify.sanitize(dirty, options);
  }

  /**
   * Sanitize plain text (escapes HTML tags).
   * Converts <, >, &, ", ' to their HTML entities.
   *
   * @param dirty - The potentially unsafe text string
   * @returns Escaped text string
   */
  sanitizeText(dirty: string): string {
    if (!dirty) return dirty;
    return this.sanitizeHtml(dirty, { ALLOWED_TAGS: [] });
  }

  /**
   * Sanitize an object by sanitizing all string values.
   * Useful for sanitizing request bodies or DTOs.
   *
   * @param obj - The object to sanitize
   * @param depth - Maximum recursion depth (default: 5)
   * @returns A new object with all string values sanitized
   */
  sanitizeObject(obj: any, depth: number = 5): any {
    if (depth <= 0) return obj;

    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      return this.sanitizeText(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeObject(item, depth - 1));
    }

    if (typeof obj === 'object') {
      const sanitized: Record<string, any> = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          sanitized[key] = this.sanitizeObject(obj[key], depth - 1);
        }
      }
      return sanitized;
    }

    return obj;
  }

  /**
   * Sanitize email content (allows basic formatting but removes scripts).
   *
   * @param dirty - The potentially unsafe HTML for email
   * @returns Clean HTML safe for email
   */
  sanitizeForEmail(dirty: string): string {
    return this.sanitizeHtml(dirty, {
      ALLOWED_TAGS: [
        'b',
        'i',
        'em',
        'strong',
        'u',
        's',
        'del',
        'p',
        'br',
        'div',
        'span',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'ul',
        'ol',
        'li',
        'a',
      ],
      ALLOWED_ATTR: ['href', 'title', 'class'],
    });
  }

  /**
   * Sanitize a URL to prevent XSS via malicious URLs.
   *
   * @param url - The URL to sanitize
   * @returns Sanitized URL or null if invalid
   */
  sanitizeUrl(url: string): string | null {
    if (!url) return null;

    try {
      // Basic URL validation
      const parsed = new URL(url);

      // Block potentially dangerous protocols
      const dangerousProtocols = ['javascript:', 'data:', 'vbscript:', 'file:'];
      if (
        dangerousProtocols.some((proto) => parsed.protocol.startsWith(proto))
      ) {
        return null;
      }

      return parsed.toString();
    } catch {
      return null;
    }
  }

  /**
   * Sanitize a filename to prevent directory traversal attacks.
   *
   * @param filename - The filename to sanitize
   * @returns Sanitized filename
   */
  sanitizeFilename(filename: string): string {
    if (!filename) return filename;

    // Remove path information
    return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  /**
   * Sanitize CSS to prevent CSS-based XSS.
   *
   * @param css - The CSS string to sanitize
   * @returns Sanitized CSS string
   */
  sanitizeCss(css: string): string {
    if (!css) return css;

    // Remove potentially dangerous CSS
    return css
      .replace(/expression\s*\(/gi, '')
      .replace(/url\s*\(/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/\b(on\w+)\s*=/gi, '');
  }

  /**
   * Check if a string contains potentially malicious content.
   *
   * @param str - The string to check
   * @returns true if potentially malicious, false otherwise
   */
  isPotentiallyMalicious(str: string): boolean {
    if (!str) return false;

    const maliciousPatterns = [
      /<script\b/i,
      /javascript:/i,
      /on\w+\s*=/i,
      /expression\s*\(/i,
      /<iframe\b/i,
      /<object\b/i,
      /<embed\b/i,
      /eval\s*\(/i,
      /document\.cookie/i,
      /window\.location/i,
    ];

    return maliciousPatterns.some((pattern) => pattern.test(str));
  }
}
