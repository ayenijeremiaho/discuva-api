import { ServiceSessionGateway } from './service-session.gateway';
import { ServiceSessionService } from '../service/service-session.service';
import { JwtService } from '@nestjs/jwt';

describe('ServiceSessionGateway', () => {
  let gateway: ServiceSessionGateway;
  const mockSessionSvc = { getState: jest.fn() };
  const mockJwtService = { verifyAsync: jest.fn() };
  const mockJwtRefreshConfig = { secret: 'refresh-secret' };
  const mockClient = {
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    handshake: { auth: {} as Record<string, unknown> },
  };
  const mockServer = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.handshake = { auth: {} };
    gateway = new ServiceSessionGateway(
      mockSessionSvc as unknown as ServiceSessionService,
      mockJwtService as unknown as JwtService,
      mockJwtRefreshConfig as any,
    );
    gateway.server = mockServer as any;
  });

  describe('handleConnection', () => {
    it('joins the tenant room when the token verifies against the access secret', async () => {
      mockClient.handshake.auth = { token: 'valid-access-token' };
      mockJwtService.verifyAsync.mockResolvedValueOnce({
        tenantId: 'tenant-1',
      });

      await gateway.handleConnection(mockClient as any);

      expect(mockClient.join).toHaveBeenCalledWith('tenant:tenant-1');
    });

    it('falls back to the refresh secret when the access secret fails', async () => {
      mockClient.handshake.auth = { token: 'valid-refresh-token' };
      mockJwtService.verifyAsync
        .mockRejectedValueOnce(new Error('invalid'))
        .mockResolvedValueOnce({ tenantId: 'tenant-2' });

      await gateway.handleConnection(mockClient as any);

      expect(mockJwtService.verifyAsync).toHaveBeenNthCalledWith(
        2,
        'valid-refresh-token',
        { secret: 'refresh-secret' },
      );
      expect(mockClient.join).toHaveBeenCalledWith('tenant:tenant-2');
    });

    it('does not join or throw when no token is present', async () => {
      mockClient.handshake.auth = {};

      await expect(
        gateway.handleConnection(mockClient as any),
      ).resolves.toBeUndefined();
      expect(mockClient.join).not.toHaveBeenCalled();
    });

    it('does not join or throw when the token is invalid', async () => {
      mockClient.handshake.auth = { token: 'garbage' };
      mockJwtService.verifyAsync.mockRejectedValue(new Error('invalid'));

      await expect(
        gateway.handleConnection(mockClient as any),
      ).resolves.toBeUndefined();
      expect(mockClient.join).not.toHaveBeenCalled();
    });
  });

  describe('handleJoin', () => {
    it('joins the room when the session exists', async () => {
      mockSessionSvc.getState.mockResolvedValue({});
      await gateway.handleJoin(
        { sessionCode: 'SVC-ABC123' },
        mockClient as any,
      );

      expect(mockClient.join).toHaveBeenCalledWith('session:SVC-ABC123');
      expect(mockClient.emit).not.toHaveBeenCalled();
    });

    it('rejects with session:error and does not join when the session is unknown', async () => {
      mockSessionSvc.getState.mockRejectedValue(new Error('not found'));
      await gateway.handleJoin(
        { sessionCode: 'SVC-NOPE99' },
        mockClient as any,
      );

      expect(mockClient.join).not.toHaveBeenCalled();
      expect(mockClient.emit).toHaveBeenCalledWith(
        'session:error',
        expect.objectContaining({ message: expect.any(String) }),
      );
    });

    it('no-ops when sessionCode is missing from the payload', async () => {
      await gateway.handleJoin({} as any, mockClient as any);

      expect(mockSessionSvc.getState).not.toHaveBeenCalled();
      expect(mockClient.join).not.toHaveBeenCalled();
    });
  });

  describe('handleLeave', () => {
    it('leaves the room for the given sessionCode', () => {
      gateway.handleLeave({ sessionCode: 'SVC-ABC123' }, mockClient as any);
      expect(mockClient.leave).toHaveBeenCalledWith('session:SVC-ABC123');
    });
  });

  describe('broadcastState', () => {
    it('emits session:state with the full payload to the session room', () => {
      const state = {
        anchor: { currentSlotPosition: 0 },
        session: { id: 'sess-1' },
        effectiveSlots: [],
        cautionThresholdRatio: 0.25,
      };
      gateway.broadcastState('SVC-ABC123', state as any);

      expect(mockServer.to).toHaveBeenCalledWith('session:SVC-ABC123');
      expect(mockServer.emit).toHaveBeenCalledWith('session:state', state);
    });
  });

  describe('broadcastActiveSessionsChanged', () => {
    it('emits activeSessions:changed to the tenant room', () => {
      const sessions = [
        {
          sessionCode: 'SVC-ABC123',
          serviceSlotName: 'Sunday',
          startedAt: new Date(),
        },
      ];
      gateway.broadcastActiveSessionsChanged('tenant-1', sessions);

      expect(mockServer.to).toHaveBeenCalledWith('tenant:tenant-1');
      expect(mockServer.emit).toHaveBeenCalledWith(
        'activeSessions:changed',
        sessions,
      );
    });
  });
});
