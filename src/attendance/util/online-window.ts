import { Repository } from 'typeorm';
import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';

// How long after the "did you attend online?" email members can confirm — per church, else the server default.
export const ONLINE_WINDOW_KEY = 'attendance:online_confirm_window_minutes';
export const ONLINE_WINDOW_MIN_MINUTES = 15;
export const ONLINE_WINDOW_MAX_MINUTES = 7 * 24 * 60;

export async function readOnlineWindowMinutes(
  settingRepo: Repository<ChurchSetting>,
  fallbackHours: number,
): Promise<{ minutes: number; isDefault: boolean }> {
  const row = await settingRepo.findOne({ where: { key: ONLINE_WINDOW_KEY } });
  const minutes = Number(
    (row?.value as { minutes?: number } | undefined)?.minutes,
  );
  return Number.isFinite(minutes) && minutes > 0
    ? { minutes, isDefault: false }
    : { minutes: Math.round(fallbackHours * 60), isDefault: true };
}

// "2 hours 30 minutes", "45 minutes", "1 hour" — for the email.
export function formatWindow(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (!h) return part(m, 'minute');
  return m ? `${part(h, 'hour')} ${part(m, 'minute')}` : part(h, 'hour');
}
