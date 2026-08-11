import { PlatformSettingKey } from '../enum/platform-setting-key.enum';

export interface KnownPlatformSetting {
  label: string;
  unit: string;
  defaultValue: number;
}

export const KNOWN_PLATFORM_SETTINGS: Record<
  PlatformSettingKey,
  KnownPlatformSetting
> = {
  [PlatformSettingKey.SUBSCRIPTION_GRACE_PERIOD_DAYS]: {
    label: 'Subscription Grace Period',
    unit: 'days after payment lapse before downgrade to Free',
    defaultValue: 7,
  },
};
