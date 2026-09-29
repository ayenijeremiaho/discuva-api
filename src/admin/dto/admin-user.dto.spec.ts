import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateFavouritePagesDto } from './admin-user.dto';

async function errorsFor(pages: unknown) {
  return validate(plainToInstance(UpdateFavouritePagesDto, { pages }));
}

describe('UpdateFavouritePagesDto', () => {
  it('accepts admin-portal paths', async () => {
    expect(
      await errorsFor(['/members', '/finances/external-payees', '/sms-logs']),
    ).toHaveLength(0);
  });

  it('accepts an empty list to clear favourites', async () => {
    expect(await errorsFor([])).toHaveLength(0);
  });

  it.each([
    ['an external URL', ['https://evil.example']],
    ['a path without a leading slash', ['members']],
    ['a query string', ['/members?x=1']],
    ['too many pages', Array.from({ length: 13 }, (_, i) => `/p${i}`)],
    ['a non-array', '/members'],
  ])('rejects %s', async (_label, pages) => {
    expect(await errorsFor(pages)).not.toHaveLength(0);
  });
});
