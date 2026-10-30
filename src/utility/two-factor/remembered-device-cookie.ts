import { Response } from 'express';
import { RememberedDeviceCookie } from './two-factor.base';

export function setRememberedDeviceCookie(
  res: Response,
  cookie: RememberedDeviceCookie,
  secure: boolean,
  path: string,
): void {
  res.cookie(cookie.name, cookie.value, {
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' : 'lax',
    path,
    maxAge: cookie.maxAge,
  });
}
