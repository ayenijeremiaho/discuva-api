import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OAuthStateService } from './oauth-state.service';
import { EncryptionService } from '../../utility/service/encryption.service';

describe('OAuthStateService', () => {
  let service: OAuthStateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthStateService,
        EncryptionService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('a'.repeat(32)),
          },
        },
      ],
    }).compile();
    service = module.get(OAuthStateService);
  });

  it('round-trips accountId/tenantId through encode then decode', () => {
    const state = service.encode('account-1', 'tenant-1');
    const decoded = service.decode(state);
    expect(decoded.accountId).toBe('account-1');
    expect(decoded.tenantId).toBe('tenant-1');
  });

  it('produces a different nonce (and therefore a different encoded state) on each call', () => {
    const state1 = service.encode('account-1', 'tenant-1');
    const state2 = service.encode('account-1', 'tenant-1');
    expect(state1).not.toBe(state2);
  });

  it('throws on a tampered state string rather than returning garbage', () => {
    const state = service.encode('account-1', 'tenant-1');
    const tampered = state.slice(0, -4) + 'abcd';
    expect(() => service.decode(tampered)).toThrow();
  });

  it('rejects a state older than the max age window', () => {
    const state = service.encode('account-1', 'tenant-1');
    const realNow = Date.now;
    Date.now = () => realNow() + 11 * 60 * 1000;
    try {
      expect(() => service.decode(state)).toThrow(/expired/i);
    } finally {
      Date.now = realNow;
    }
  });
});
