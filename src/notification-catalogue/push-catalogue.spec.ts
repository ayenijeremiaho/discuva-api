import {
  PUSH_BODY_MAX,
  PUSH_CATALOGUE,
  PUSH_TITLE_MAX,
  fillPlaceholders,
  renderPush,
} from './push-catalogue';
import { KNOWN_EMAIL_CATEGORIES } from '../email-category-settings/constant/known-email-categories.constant';

const PLACEHOLDER = /{{\s*(\w+)\s*}}/g;

describe('push catalogue', () => {
  it.each(Object.entries(PUSH_CATALOGUE))(
    '%s declares every placeholder it uses and fits a phone notification',
    (_key, template) => {
      const used = [
        ...`${template.title} ${template.body}`.matchAll(PLACEHOLDER),
      ].map((m) => m[1]);
      for (const name of used) {
        expect(template.placeholders).toHaveProperty(name);
      }

      const rendered = renderPush(template, template.placeholders);
      expect(rendered.title.length).toBeLessThanOrEqual(PUSH_TITLE_MAX);
      expect(rendered.body.length).toBeLessThanOrEqual(PUSH_BODY_MAX);
      expect(rendered.title).not.toMatch(PLACEHOLDER);
      expect(template.url).toMatch(/^\//);
      expect(KNOWN_EMAIL_CATEGORIES[template.category]).toBeDefined();
    },
  );

  it('fills known placeholders and blanks unknown ones', () => {
    expect(
      fillPlaceholders('Hi {{ name }}, see {{missing}} now', { name: 'Ada' }),
    ).toBe('Hi Ada, see now');
  });

  it('never evaluates template syntax in the values or wording', () => {
    expect(
      fillPlaceholders('{{#each x}}{{name}}{{/each}}', {
        name: '{{constructor}}',
      }),
    ).toBe('{{#each x}}{{constructor}}{{/each}}');
  });

  it('clips long text to phone-notification length', () => {
    const { body } = renderPush(
      { title: 'T', body: '{{comment}}' },
      { comment: 'x'.repeat(400) },
    );
    expect(body).toHaveLength(PUSH_BODY_MAX);
    expect(body.endsWith('...')).toBe(true);
  });
});
