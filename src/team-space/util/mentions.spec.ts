import { parseMentions, plainText, rewriteMentions } from './mentions';

const ADA = '2e8857e4-35ca-4218-8dcd-623479c64e07';
const OUTSIDER = '11111111-35ca-4218-8dcd-623479c64e07';

describe('mentions', () => {
  it('finds each person once, and the team', () => {
    expect(
      parseMentions(`@[Ada](${ADA}) and @[Ada](${ADA}) @[team](team)`),
    ).toEqual({ memberIds: [ADA], team: true });
  });

  it('reads as plain text in notifications', () => {
    expect(plainText(`Thanks @[Ada Obi](${ADA})`)).toBe('Thanks @Ada Obi');
  });

  it('replaces a faked name with the real one', () => {
    expect(
      rewriteMentions(`@[Pastor](${ADA})`, new Map([[ADA, 'Ada Obi']])),
    ).toBe(`@[Ada Obi](${ADA})`);
  });

  it('turns a tag for someone outside the space into plain text', () => {
    expect(rewriteMentions(`@[Bob](${OUTSIDER})`, new Map())).toBe('@Bob');
  });

  it('keeps @team', () => {
    expect(rewriteMentions('@[team](team)', new Map())).toBe('@[team](team)');
  });

  it('labels the whole-space tag as the space calls it', () => {
    expect(rewriteMentions('@[team](team) hi', new Map(), 'everyone')).toBe(
      '@[everyone](team) hi',
    );
    expect(parseMentions('@[everyone](team) hi').team).toBe(true);
  });
});
