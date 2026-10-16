import { YoutubeChannelCheckService } from './youtube-channel-check.service';

describe('YoutubeChannelCheckService', () => {
  const service = new YoutubeChannelCheckService();
  const fetchMock = jest.fn();
  const reply = (status: number, body: unknown) =>
    fetchMock.mockResolvedValueOnce({
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
    });
  const ID = 'UCabcdefghijklmnopqrstuv';

  beforeAll(() => {
    global.fetch = fetchMock as never;
  });
  beforeEach(() => fetchMock.mockReset());

  it('finds the channel from its ID, its link, or its @handle', async () => {
    reply(200, { items: [{ id: ID, snippet: { title: 'Grace Chapel' } }] });
    await expect(service.check(ID, 'k')).resolves.toEqual({
      channelId: ID,
      channelTitle: 'Grace Chapel',
    });
    expect(fetchMock.mock.calls[0][0]).toContain(`id=${ID}`);

    reply(200, { items: [{ id: ID, snippet: { title: 'Grace Chapel' } }] });
    await service.check(`https://www.youtube.com/channel/${ID}?si=x`, 'k');
    expect(fetchMock.mock.calls[1][0]).toContain(`id=${ID}`);

    reply(200, { items: [{ id: ID, snippet: { title: 'Grace Chapel' } }] });
    await service.check('https://youtube.com/@gracechapel', 'k');
    expect(fetchMock.mock.calls[2][0]).toContain('forHandle=%40gracechapel');
  });

  it('explains what to do for each problem YouTube reports', async () => {
    reply(400, { error: { details: [{ reason: 'API_KEY_INVALID' }] } });
    await expect(service.check(ID, 'bad')).rejects.toThrow(
      "That API key isn't valid",
    );
    reply(403, { error: { errors: [{ reason: 'accessNotConfigured' }] } });
    await expect(service.check(ID, 'k')).rejects.toThrow(
      "YouTube Data API v3 isn't switched on",
    );
    reply(403, { error: { errors: [{ reason: 'quotaExceeded' }] } });
    await expect(service.check(ID, 'k')).rejects.toThrow('quota');
    reply(403, {
      error: { details: [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }] },
    });
    await expect(service.check(ID, 'k')).rejects.toThrow(
      'Application restrictions to None',
    );
  });

  it('says when no channel matches, and when the input is not a channel at all', async () => {
    reply(200, { items: [] });
    await expect(service.check('@nobody', 'k')).rejects.toThrow(
      'No YouTube channel has the handle @nobody',
    );
    await expect(service.check('my church', 'k')).rejects.toThrow(
      'Paste your channel link',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after a few seconds rather than holding the save open', async () => {
    reply(200, { items: [{ id: ID, snippet: { title: 'Grace Chapel' } }] });
    await service.check(ID, 'k');
    expect(fetchMock.mock.calls[0][1]).toEqual({
      signal: expect.any(AbortSignal),
    });
  });

  it("says so when YouTube can't be reached", async () => {
    fetchMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(service.check(ID, 'k')).rejects.toThrow(
      "Couldn't reach YouTube",
    );
  });
});
