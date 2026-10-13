import { hashId, maskIp, maskIpList } from './log-safety';

describe('log safety', () => {
  it('masks addresses enough not to identify anyone, while showing Fly-internal vs visitor', () => {
    expect(maskIp('102.212.253.9')).toBe('102.212.253.x');
    expect(maskIp('::ffff:172.16.1.210')).toBe('::ffff:172.16.1.x');
    expect(maskIp('2001:db8:85a3:0:0:8a2e:370:7334')).toBe('2001:db8:85a3::x');
    expect(maskIp('nonsense')).toBe('[unparsed]');
    expect(maskIpList('102.212.253.9, 66.241.124.132')).toBe(
      '102.212.253.x, 66.241.124.x',
    );
  });

  it('hashes ids stably and briefly', () => {
    expect(hashId('ada@church.org')).toBe(hashId('ada@church.org'));
    expect(hashId('ada@church.org')).toHaveLength(12);
    expect(hashId('ada@church.org')).not.toBe(hashId('ben@church.org'));
  });
});
