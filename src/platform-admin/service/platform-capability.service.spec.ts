import { PlatformCapabilityService } from './platform-capability.service';
import { ALL_CAPABILITY_KEYS } from '../../billing/constant/capability-keys.constant';

describe('PlatformCapabilityService', () => {
  it('lists every capability a plan can hold, so each can be managed from the Plans page', () => {
    const listed = new PlatformCapabilityService().list().map((c) => c.key);
    expect([...listed].sort()).toEqual([...ALL_CAPABILITY_KEYS].sort());
  });

  it('includes notification customization', () => {
    expect(new PlatformCapabilityService().list()).toContainEqual({
      key: 'notification_customization',
      label: 'Notification Customization',
    });
  });
});
