import { GameSessionGateway } from './game-session.gateway';
import { GameService } from '../service/game.service';
import { JwtService } from '@nestjs/jwt';

describe('GameSessionGateway', () => {
  let gateway: GameSessionGateway;
  const mockGameService = { getSessionState: jest.fn() };
  const mockJwtService = { verifyAsync: jest.fn() };
  const mockJwtRefreshConfig = { secret: 'refresh-secret' };
  const mockTenantRepo = { findOneBy: jest.fn() };
  const mockCls = {
    runWith: jest.fn((_store: unknown, fn: () => unknown) => fn()),
    set: jest.fn(),
    get: jest.fn(),
  };
  const mockTxHost = {
    withTransaction: jest.fn((fn: () => unknown) => fn()),
    tx: { query: jest.fn().mockResolvedValue(undefined) },
  };
  const mockClient = {
    data: {} as Record<string, unknown>,
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    handshake: { auth: {} as Record<string, unknown> },
  };
  const mockServer = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.data = {};
    mockClient.handshake = { auth: {} };
    gateway = new GameSessionGateway(
      mockGameService as unknown as GameService,
      mockCls as any,
      mockTxHost as any,
      mockJwtService as unknown as JwtService,
      mockJwtRefreshConfig as any,
      mockTenantRepo as any,
    );
    gateway.server = mockServer as any;
  });

  describe('handleConnection', () => {
    it('resolves tenant from a JWT verified against the access secret', async () => {
      mockClient.handshake.auth = { token: 'valid-access-token' };
      mockJwtService.verifyAsync.mockResolvedValueOnce({
        tenantId: 'tenant-1',
        schemaName: 'schema_1',
      });

      await gateway.handleConnection(mockClient as any);

      expect(mockClient.data.tenantId).toBe('tenant-1');
      expect(mockClient.data.schemaName).toBe('schema_1');
      expect(mockTenantRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('falls back to the refresh secret when the access secret fails', async () => {
      mockClient.handshake.auth = { token: 'valid-refresh-token' };
      mockJwtService.verifyAsync
        .mockRejectedValueOnce(new Error('invalid'))
        .mockResolvedValueOnce({
          tenantId: 'tenant-2',
          schemaName: 'schema_2',
        });

      await gateway.handleConnection(mockClient as any);

      expect(mockJwtService.verifyAsync).toHaveBeenNthCalledWith(
        2,
        'valid-refresh-token',
        { secret: 'refresh-secret' },
      );
      expect(mockClient.data.tenantId).toBe('tenant-2');
    });

    it('resolves tenant from tenantSubdomain via the Tenant repo when there is no token', async () => {
      mockClient.handshake.auth = { tenantSubdomain: 'frontend-test' };
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'tenant-3',
        schemaName: 'schema_3',
      });

      await gateway.handleConnection(mockClient as any);

      expect(mockTenantRepo.findOneBy).toHaveBeenCalledWith({
        subdomain: 'frontend-test',
      });
      expect(mockClient.data.tenantId).toBe('tenant-3');
      expect(mockClient.data.schemaName).toBe('schema_3');
    });

    it('leaves client.data empty when an unknown subdomain is presented', async () => {
      mockClient.handshake.auth = { tenantSubdomain: 'no-such-church' };
      mockTenantRepo.findOneBy.mockResolvedValue(null);

      await gateway.handleConnection(mockClient as any);

      expect(mockClient.data.tenantId).toBeUndefined();
    });

    it('does not throw when there is neither a token nor a subdomain', async () => {
      mockClient.handshake.auth = {};

      await expect(
        gateway.handleConnection(mockClient as any),
      ).resolves.toBeUndefined();
      expect(mockClient.data.tenantId).toBeUndefined();
    });
  });

  describe('handleJoin', () => {
    it('joins the tenant-scoped room and resolves the ack with the already-fetched state', async () => {
      mockClient.data = { tenantId: 'tenant-1', schemaName: 'schema_1' };
      const state = { sessionCode: 'GAME-ABC123', status: 'LIVE' };
      mockGameService.getSessionState.mockResolvedValue(state);

      // The handler's return value IS the ack — Nest's WsAdapter sends it
      // back as the callback argument of whichever emit call triggered it.
      // This replaced a fire-and-forget session:state emit specifically
      // because a client joining a genuinely idle session (nothing's
      // happened since — the common case for a fresh lobby) previously got
      // neither session:error nor session:state, with no way to tell a
      // successful quiet join apart from one still hanging. An ack can't
      // have that failure mode — it's tied to this one request/response.
      await expect(
        gateway.handleJoin({ sessionCode: 'GAME-ABC123' }, mockClient as any),
      ).resolves.toEqual({ ok: true, state });

      expect(mockClient.join).toHaveBeenCalledWith(
        'game-session:tenant-1:GAME-ABC123',
      );
      // The whole point of this gateway existing: the lookup must run
      // inside the resolved tenant's context, not the default connection.
      expect(mockCls.runWith).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          schemaName: 'schema_1',
        }),
        expect.any(Function),
      );
    });

    it('resolves a failed ack and does not join when no tenant could be resolved for this connection', async () => {
      mockClient.data = {};

      await expect(
        gateway.handleJoin({ sessionCode: 'GAME-ABC123' }, mockClient as any),
      ).resolves.toEqual({ ok: false, message: expect.any(String) });

      expect(mockGameService.getSessionState).not.toHaveBeenCalled();
      expect(mockClient.join).not.toHaveBeenCalled();
    });

    it('resolves a failed ack and does not join when the session is unknown', async () => {
      mockClient.data = { tenantId: 'tenant-1', schemaName: 'schema_1' };
      mockGameService.getSessionState.mockRejectedValue(new Error('not found'));

      await expect(
        gateway.handleJoin({ sessionCode: 'GAME-NOPE99' }, mockClient as any),
      ).resolves.toEqual({ ok: false, message: expect.any(String) });

      expect(mockClient.join).not.toHaveBeenCalled();
    });

    it('resolves a failed ack when sessionCode is missing from the payload', async () => {
      mockClient.data = { tenantId: 'tenant-1', schemaName: 'schema_1' };

      await expect(
        gateway.handleJoin({} as any, mockClient as any),
      ).resolves.toEqual({ ok: false, message: expect.any(String) });

      expect(mockGameService.getSessionState).not.toHaveBeenCalled();
      expect(mockClient.join).not.toHaveBeenCalled();
    });
  });

  describe('handleLeave', () => {
    it('leaves the tenant-scoped room for the given sessionCode', () => {
      mockClient.data = { tenantId: 'tenant-1' };
      gateway.handleLeave({ sessionCode: 'GAME-ABC123' }, mockClient as any);
      expect(mockClient.leave).toHaveBeenCalledWith(
        'game-session:tenant-1:GAME-ABC123',
      );
    });

    it('no-ops when no tenant was ever resolved for this connection', () => {
      mockClient.data = {};
      gateway.handleLeave({ sessionCode: 'GAME-ABC123' }, mockClient as any);
      expect(mockClient.leave).not.toHaveBeenCalled();
    });
  });

  describe('broadcastState', () => {
    it('emits session:state to the current CLS tenant room', () => {
      mockCls.get.mockReturnValue('tenant-1');
      const state = { sessionCode: 'GAME-ABC123' };

      gateway.broadcastState('GAME-ABC123', state as any);

      expect(mockServer.to).toHaveBeenCalledWith(
        'game-session:tenant-1:GAME-ABC123',
      );
      expect(mockServer.emit).toHaveBeenCalledWith('session:state', state);
    });

    it('does nothing when there is no active tenant in CLS', () => {
      mockCls.get.mockReturnValue(undefined);

      gateway.broadcastState('GAME-ABC123', {} as any);

      expect(mockServer.to).not.toHaveBeenCalled();
    });
  });
});
