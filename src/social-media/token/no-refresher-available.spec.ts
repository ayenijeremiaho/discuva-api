import { NoRefresherAvailable } from './no-refresher-available';

describe('NoRefresherAvailable', () => {
  it('throws rather than returning a token, so callers never silently keep using an expired one', async () => {
    const refresher = new NoRefresherAvailable();
    await expect(refresher.refresh()).rejects.toThrow(/not yet implemented/i);
  });
});
