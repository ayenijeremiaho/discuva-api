import { PlatformCapabilityService } from './platform-capability.service';

describe('PlatformCapabilityService', () => {
  it('lists notification customization so platform admins can add it to plans', () => {
    expect(new PlatformCapabilityService().list()).toContainEqual({
      key: 'notification_customization',
      label: 'Notification Customization',
    });
  });
});
