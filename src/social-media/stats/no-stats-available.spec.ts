import { NoStatsAvailable } from './no-stats-available';

describe('NoStatsAvailable', () => {
  it('throws rather than returning empty stats, so callers can tell "unsupported" from "zero"', async () => {
    const fetcher = new NoStatsAvailable();
    await expect(fetcher.getStats()).rejects.toThrow(/aren't available/i);
  });
});
