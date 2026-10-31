import {
  emailDomain,
  emailMatchesWebsite,
  isPersonalEmail,
  isSocialPage,
  websiteHost,
} from './church-request-checks';

describe('church request checks', () => {
  it('reads an email domain', () => {
    expect(emailDomain('Office@Hope.Example')).toBe('hope.example');
    expect(emailDomain(null)).toBeNull();
    expect(emailDomain('not-an-email')).toBeNull();
  });

  it('spots personal email providers', () => {
    expect(isPersonalEmail('ada@gmail.com')).toBe(true);
    expect(isPersonalEmail('office@hope.example')).toBe(false);
  });

  it('reads a website host with or without a scheme', () => {
    expect(websiteHost('www.hope.example/about')).toBe('hope.example');
    expect(websiteHost('https://Hope.Example')).toBe('hope.example');
    expect(websiteHost('not a url')).toBeNull();
    expect(websiteHost('')).toBeNull();
  });

  it('spots social pages but not look-alikes', () => {
    expect(isSocialPage('facebook.com/hope')).toBe(true);
    expect(isSocialPage('https://m.facebook.com/hope')).toBe(true);
    expect(isSocialPage('notfacebook.com')).toBe(false);
  });

  it('matches a church email to its website', () => {
    expect(emailMatchesWebsite('a@hope.example', 'hope.example')).toBe(true);
    expect(emailMatchesWebsite('a@hope.example', 'www.hope.example')).toBe(
      true,
    );
    expect(emailMatchesWebsite('a@mail.hope.example', 'hope.example')).toBe(
      true,
    );
  });

  it("doesn't count look-alikes, personal email or social pages as a match", () => {
    expect(emailMatchesWebsite('a@nothope.example', 'hope.example')).toBe(
      false,
    );
    expect(emailMatchesWebsite('a@gmail.com', 'gmail.com')).toBe(false);
    expect(emailMatchesWebsite('a@facebook.com', 'facebook.com/hope')).toBe(
      false,
    );
    expect(emailMatchesWebsite('a@hope.example', null)).toBe(false);
  });
});
