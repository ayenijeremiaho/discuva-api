import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from '../service/auth.service';
import { WebauthnService } from '../service/webauthn.service';

// Scoped to the 6 WebAuthn routes added this pass — the rest of this
// controller predates unit-test coverage in this codebase and isn't this
// change's concern.
const mockAuthService = {
  loginWithWebauthn: jest.fn(),
};
const mockWebauthnService = {
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
  listCredentials: jest.fn(),
  removeCredential: jest.fn(),
};
const mockConfigService = { get: jest.fn() };

function mockRequest(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 'member-1' },
    headers: { origin: 'https://church-a.discuva.org' },
    ...overrides,
  } as any;
}

describe('AuthController (WebAuthn routes)', () => {
  let controller: AuthController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: WebauthnService, useValue: mockWebauthnService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    controller = module.get(AuthController);
  });

  it('webauthnLoginOptions delegates to WebauthnService with no arguments (usernameless)', async () => {
    mockWebauthnService.generateAuthenticationOptions.mockResolvedValue({
      challengeId: 'chal-id',
      options: { challenge: 'chal' },
    });

    const result = await controller.webauthnLoginOptions();

    expect(
      mockWebauthnService.generateAuthenticationOptions,
    ).toHaveBeenCalledWith();
    expect(result).toEqual({
      challengeId: 'chal-id',
      options: { challenge: 'chal' },
    });
  });

  it('webauthnLoginVerify resolves the memberId then issues tokens via AuthService', async () => {
    mockWebauthnService.verifyAuthenticationResponse.mockResolvedValue(
      'member-1',
    );
    mockAuthService.loginWithWebauthn.mockResolvedValue({
      access_token: 'tok',
      token_type: 'Bearer',
    });

    const result = await controller.webauthnLoginVerify(
      mockRequest(),
      'chal-id',
      { id: 'cred-1' } as any,
    );

    expect(
      mockWebauthnService.verifyAuthenticationResponse,
    ).toHaveBeenCalledWith(
      'chal-id',
      { id: 'cred-1' },
      'https://church-a.discuva.org',
    );
    expect(mockAuthService.loginWithWebauthn).toHaveBeenCalledWith('member-1');
    expect(result).toEqual({ access_token: 'tok', token_type: 'Bearer' });
  });

  it('webauthnRegisterOptions scopes to the caller from the JWT, not a client-supplied id', async () => {
    mockWebauthnService.generateRegistrationOptions.mockResolvedValue({
      challenge: 'chal',
    });

    await controller.webauthnRegisterOptions(mockRequest());

    expect(
      mockWebauthnService.generateRegistrationOptions,
    ).toHaveBeenCalledWith('member-1');
  });

  it('webauthnRegisterVerify forwards the request origin and User-Agent', async () => {
    await controller.webauthnRegisterVerify(
      mockRequest({
        headers: {
          origin: 'https://church-a.discuva.org',
          'user-agent': 'iPhone UA',
        },
      }),
      { id: 'new-cred' } as any,
    );

    expect(mockWebauthnService.verifyRegistrationResponse).toHaveBeenCalledWith(
      'member-1',
      { id: 'new-cred' },
      'https://church-a.discuva.org',
      'iPhone UA',
    );
  });

  it("webauthnCredentials lists only the calling member's own devices", async () => {
    mockWebauthnService.listCredentials.mockResolvedValue([
      { id: 'row-1', deviceName: 'iPhone' },
    ]);

    const result = await controller.webauthnCredentials(mockRequest());

    expect(mockWebauthnService.listCredentials).toHaveBeenCalledWith(
      'member-1',
    );
    expect(result).toEqual([{ id: 'row-1', deviceName: 'iPhone' }]);
  });

  it('removeWebauthnCredential scopes the delete to the caller from the JWT', async () => {
    await controller.removeWebauthnCredential(mockRequest(), 'row-1');

    expect(mockWebauthnService.removeCredential).toHaveBeenCalledWith(
      'member-1',
      'row-1',
    );
  });
});
