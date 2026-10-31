const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'zoho.com',
]);

const SOCIAL_HOSTS = [
  'facebook.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'youtube.com',
  'tiktok.com',
  'linkedin.com',
  'wa.me',
  'whatsapp.com',
];

export function emailDomain(email?: string | null): string | null {
  return email?.split('@')[1]?.trim().toLowerCase() || null;
}

export function isPersonalEmail(email?: string | null): boolean {
  const domain = emailDomain(email);
  return !!domain && PERSONAL_EMAIL_DOMAINS.has(domain);
}

export function websiteHost(website?: string | null): string | null {
  const value = website?.trim();
  if (!value) return null;
  try {
    const url = new URL(
      /^https?:\/\//i.test(value) ? value : `https://${value}`,
    );
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function matchesHost(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function isSocialPage(website?: string | null): boolean {
  const host = websiteHost(website);
  return !!host && SOCIAL_HOSTS.some((social) => matchesHost(host, social));
}

// False for a social page or personal email: those can't show that the church controls a domain.
export function emailMatchesWebsite(
  email?: string | null,
  website?: string | null,
): boolean {
  const domain = emailDomain(email);
  const host = websiteHost(website);
  if (!domain || !host || isPersonalEmail(email) || isSocialPage(website)) {
    return false;
  }
  return matchesHost(host, domain) || matchesHost(domain, host);
}
