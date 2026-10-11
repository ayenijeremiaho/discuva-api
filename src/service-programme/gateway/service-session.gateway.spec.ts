import { ServiceSessionGateway } from './service-session.gateway';
import { ServiceSessionService } from '../service/service-session.service';
import { JwtService } from '@nestjs/jwt';

jest.mock('../../tenant/utility/run-in-tenant-context', () => ({
  runInTenantContext: jest.fn((_cls, _tx, _env, fn: () => unknown) => fn()),
}));

describe('ServiceSessionGateway', () => {
  let gateway: ServiceSessionGateway;
  const mockSessionSvc = { getState: jest.fn() };
  const mockJwtService = { verifyAsync: jest.fn() };
  const mockJwtRefreshConfig = { secret: 'refresh-secret' };
  const mockCls = { get: jest.fn() };
  const mockTxHost = {};
  const mockTenantRepo = { findOneBy: jest.fn() };
  const mockClient = {
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    handshake: { auth: {} as Record<string, unknown> },
    data: {} as Record<string, unknown>,
  };
  const mockServer = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.handshake = { auth: {} };
    mockClient.data = {};
    gateway = new ServiceSessionGateway(
      mockSessionSvc as unknown as ServiceSessionService,
      mockJwtService as unknown as JwtService,
      mockJwtRefreshConfig as any,
      mockCls as any,
      mockTxHost as any,
      mockTenantRepo as any,
    );
    gateway.server = mockServer as any;
  });

  describe('handleConnection', () => {
    it('joins the tenant room when the token verifies against the access secret', async () => {
      mockClient.handshake.auth = { token: 'valid-access-token' };
      mockJwtService.verifyAsync.mockResolvedValueOnce({
        tenantId: 'tenant-1',
        schemaName: 'tenant_one',
      });

      await gateway.handleConnection(mockClient as any);

      expect(mockClient.join).toHaveBeenCalledWith('tenant:tenant-1');
      expect(mockClient.data).toEqual({
        tenantId: 'tenant-1',
        schemaName: 'tenant_one',
      });
    });

    it('resolves the tenant from the handshake subdomain for anonymous viewers', async () => {
      mockClient.handshake.auth = { tenantSubdomain: 'church-a' };
      mockTenantRepo.findOneBy.mockResolvedValueOnce({
        id: 'tenant-3',
        schemaName: 'tenant_three',
      });

      await gateway.handleConnection(mockClient as any);

      expect(mockTenantRepo.findOneBy).toHaveBeenCalledWith({
        subdomain: 'church-a',
      });
      expect(mockClient.data).toEqual({
        tenantId: 'tenant-3',
        schemaName: 'tenant_three',
      });
      expect(mockClient.join).not.toHaveBeenCalled();
    });

    it('falls back to the refresh secret when the access secret fails', async () => {
      mockClient.handshake.auth = { token: 'valid-refresh-token' };
      mockJwtService.verifyAsync
        .mockRejectedValueOnce(new Error('invalid'))
        .mockResolvedValueOnce({
          tenantId: 'tenant-2',
          schemaName: 'tenant_two',
        });

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
    const withTenant = () => {
      mockClient.data = { tenantId: 'tenant-1', schemaName: 'tenant_one' };
    };

    it('joins the tenant-scoped room and acks with the current state', async () => {
      withTenant();
      const state = { anchor: {}, session: {}, effectiveSlots: [] };
      mockSessionSvc.getState.mockResolvedValue(state);

      const ack = await gateway.handleJoin(
        { sessionCode: 'SVC-ABC123' },
        mockClient as any,
      );

      expect(mockClient.join).toHaveBeenCalledWith(
        'session:tenant-1:SVC-ABC123',
      );
      expect(ack).toEqual({ ok: true, state });
    });

    it('rejects without touching the DB when no tenant was resolved', async () => {
      const ack = await gateway.handleJoin(
        { sessionCode: 'SVC-ABC123' },
        mockClient as any,
      );

      expect(mockSessionSvc.getState).not.toHaveBeenCalled();
      expect(mockClient.join).not.toHaveBeenCalled();
      expect(ack).toEqual({ ok: false, message: expect.any(String) });
    });

    it('rejects and does not join when the session is unknown', async () => {
      withTenant();
      mockSessionSvc.getState.mockRejectedValue(new Error('not found'));

      const ack = await gateway.handleJoin(
        { sessionCode: 'SVC-NOPE99' },
        mockClient as any,
      );

      expect(mockClient.join).not.toHaveBeenCalled();
      expect(ack).toEqual({ ok: false, message: expect.any(String) });
    });

    it('rejects when sessionCode is missing from the payload', async () => {
      withTenant();
      const ack = await gateway.handleJoin({} as any, mockClient as any);

      expect(mockSessionSvc.getState).not.toHaveBeenCalled();
      expect(mockClient.join).not.toHaveBeenCalled();
      expect(ack.ok).toBe(false);
    });
  });

  describe('handleLeave', () => {
    it('leaves the tenant-scoped room for the given sessionCode', () => {
      mockClient.data = { tenantId: 'tenant-1', schemaName: 'tenant_one' };
      gateway.handleLeave({ sessionCode: 'SVC-ABC123' }, mockClient as any);
      expect(mockClient.leave).toHaveBeenCalledWith(
        'session:tenant-1:SVC-ABC123',
      );
    });
  });

  describe('broadcastState', () => {
    const state = {
      anchor: { currentSlotPosition: 0 },
      session: { id: 'sess-1' },
      effectiveSlots: [],
      cautionThresholdRatio: 0.25,
    };

    it("emits session:state to the request tenant's session room", () => {
      mockCls.get.mockReturnValue('tenant-1');
      gateway.broadcastState('SVC-ABC123', state as any);

      expect(mockServer.to).toHaveBeenCalledWith('session:tenant-1:SVC-ABC123');
      expect(mockServer.emit).toHaveBeenCalledWith('session:state', state);
    });

    it('does nothing outside a tenant context', () => {
      mockCls.get.mockReturnValue(undefined);
      gateway.broadcastState('SVC-ABC123', state as any);

      expect(mockServer.emit).not.toHaveBeenCalled();
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
