import {
  EMAIL_CATALOGUE,
  EmailTemplateKey,
  defaultWording,
  renderCatalogueEmail,
} from './email-catalogue';

const TOKEN = /{{\s*(\w+)\s*}}/g;
const branding = {
  church_name: 'Test Church',
  church_address: '1 Main St',
  logo_url: 'https://example.com/logo.png',
  login_url: 'https://test.example.com',
};
const visibleText = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

describe('email catalogue', () => {
  it.each(Object.entries(EMAIL_CATALOGUE))(
    '%s declares every placeholder its wording uses and renders cleanly',
    (key, template) => {
      const wording = defaultWording(key as EmailTemplateKey);
      const used = Object.values(wording)
        .concat(template.preheader)
        .flatMap((text) => [...text.matchAll(TOKEN)].map((m) => m[1]));
      for (const name of used) {
        expect({ church_name: '', ...template.placeholders }).toHaveProperty(
          name,
        );
      }

      const { subject, html } = renderCatalogueEmail(
        key as EmailTemplateKey,
        wording,
        template.sampleData,
        branding,
      );
      expect(subject).not.toMatch(TOKEN);
      expect(visibleText(html)).not.toMatch(/{{|}}/);
      expect(html).toContain('Test Church');
      expect(html.startsWith('<!DOCTYPE')).toBe(true);
    },
  );

  it('keeps the locked account details in the welcome email', () => {
    const { html } = renderCatalogueEmail(
      EmailTemplateKey.WELCOME_MEMBER,
      {
        ...defaultWording(EmailTemplateKey.WELCOME_MEMBER),
        message: '<p>Hi</p>',
      },
      { name: 'Ada', email: 'ada@example.com', password: 'Temp-123' },
      branding,
    );
    expect(html).toContain('Temp-123');
    expect(html).toContain('ada@example.com');
    expect(html).toContain('https://test.example.com');
  });

  it('never runs church wording through the template engine', () => {
    const { html } = renderCatalogueEmail(
      EmailTemplateKey.HAPPY_BIRTHDAY,
      {
        ...defaultWording(EmailTemplateKey.HAPPY_BIRTHDAY),
        message: '<p>{{#each x}}{{first_name}}{{/each}} {{login_url}}</p>',
      },
      { name: 'Ada', full_name: 'Ada Obi' },
      branding,
    );
    expect(html).toContain('<p>{{#each x}}Ada{{/each}} </p>');
    expect(html).not.toContain('https://test.example.com</p>');
  });

  it('drops the heading when a church clears it', () => {
    const { html } = renderCatalogueEmail(
      EmailTemplateKey.SERVICE_REMINDER,
      { ...defaultWording(EmailTemplateKey.SERVICE_REMINDER), heading: '' },
      EMAIL_CATALOGUE[EmailTemplateKey.SERVICE_REMINDER].sampleData,
      branding,
    );
    expect(html).not.toContain('<h1>');
  });

  it("uses the sender's subject through {{default_subject}}", () => {
    const key = 'password-changed';
    const data = EMAIL_CATALOGUE[key].sampleData;
    const custom = { ...defaultWording(key), subject: '{{default_subject}} ✓' };

    expect(
      renderCatalogueEmail(key, defaultWording(key), data, branding, 'Sent')
        .subject,
    ).toBe('Sent');
    expect(
      renderCatalogueEmail(key, custom, data, branding, 'Sent').subject,
    ).toBe('Sent ✓');
    expect(
      renderCatalogueEmail(key, defaultWording(key), data, branding).subject,
    ).toBe(EMAIL_CATALOGUE[key].label);
  });

  it('hides the sign-off when both lines are cleared', () => {
    const key = 'password-changed';
    const { html } = renderCatalogueEmail(
      key,
      { ...defaultWording(key), signoff: '', signature: '' },
      EMAIL_CATALOGUE[key].sampleData,
      branding,
    );
    expect(html).not.toContain('margin-top: 35px');
  });

  it("adds an email's own styles to the layout", () => {
    const key = 'device-reset-otp';
    const { html } = renderCatalogueEmail(
      key,
      defaultWording(key),
      EMAIL_CATALOGUE[key].sampleData,
      branding,
    );
    expect(html).toMatch(/<style[^>]*>[\s\S]*\.otp-code[\s\S]*<\/style>/);
  });
});
