import { imageSize } from 'image-size';

// The email header's logo tile holds a logo up to this size; the logo keeps its own proportions inside it.
export const LOGO_BOX = { width: 200, height: 64 } as const;

export interface LogoSize {
  width: number;
  height: number;
}

// Largest size that fits the box without changing the logo's shape (never enlarges past the box).
export function fitLogo(natural: LogoSize): LogoSize {
  const scale = Math.min(
    LOGO_BOX.width / natural.width,
    LOGO_BOX.height / natural.height,
  );
  return {
    width: Math.max(1, Math.round(natural.width * scale)),
    height: Math.max(1, Math.round(natural.height * scale)),
  };
}

// Reads the logo's real dimensions from its bytes (PNG, JPEG, GIF, WebP, SVG and more); null if unreadable.
export function measureLogo(bytes: Uint8Array): LogoSize | null {
  try {
    const { width, height } = imageSize(bytes);
    return width && height ? { width, height } : null;
  } catch {
    return null;
  }
}

export async function fetchLogoBytes(url: string): Promise<Uint8Array | null> {
  try {
    if (url.startsWith('data:')) {
      const comma = url.indexOf(',');
      const meta = url.slice(5, comma);
      const body = url.slice(comma + 1);
      return meta.endsWith(';base64')
        ? Buffer.from(body, 'base64')
        : Buffer.from(decodeURIComponent(body));
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}
