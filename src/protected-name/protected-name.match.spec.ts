import { acronym, addressMatches, nameMatches } from './protected-name.match';

const protectedChurch = {
  name: 'Covenant Grace Church of Nations',
  shortForms: ['CGCN'],
  addresses: ['cgcn'],
};

describe('protected name matching', () => {
  it('takes initials without filler words', () => {
    expect(acronym('Covenant Grace Church of Nations')).toBe('cgcn');
  });

  it.each([
    'Covenant Grace Church of Nations',
    'covenant grace church of nations!',
    'Covenant Graces of Nations',
    'Covenant Grace Church of Nation',
    'CGCN Youth Fellowship',
    'C.G.C.N',
  ])('catches %s', (name) => {
    expect(nameMatches(name, protectedChurch)).toBe(true);
  });

  it.each([
    'Grace Fellowship',
    'Covenant Prayer Circle',
    'Nations First Group',
  ])('lets %s through', (name) => {
    expect(nameMatches(name, protectedChurch)).toBe(false);
  });

  it('catches a protected name without its short forms', () => {
    const entry = { name: 'Grace Chapel Lekki', shortForms: [], addresses: [] };
    expect(nameMatches('Grace Chapel, Lekki', entry)).toBe(true);
    expect(nameMatches('Grace Chapel Ikeja', entry)).toBe(false);
  });

  it.each([
    'cgcn',
    'cgcn-lekki',
    'lekki-cgcn',
    'cgcnlekki',
    'covenantgracenations',
  ])('reserves the address %s', (address) => {
    expect(addressMatches(address, protectedChurch)).toBe(true);
  });

  it.each(['rocky', 'grace-lekki', 'rcc'])(
    'leaves the address %s free',
    (address) => {
      expect(addressMatches(address, protectedChurch)).toBe(false);
    },
  );
});
