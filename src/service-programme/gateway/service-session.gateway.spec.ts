import { ServiceSessionGateway } from './service-session.gateway';
import { ServiceSessionService } from '../service/service-session.service';

describe('ServiceSessionGateway', () => {
  let gateway: ServiceSessionGateway;
  const mockSessionSvc = { getState: jest.fn() };
  const mockClient = { join: jest.fn(), leave: jest.fn(), emit: jest.fn() };
  const mockServer = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new ServiceSessionGateway(
      mockSessionSvc as unknown as ServiceSessionService,
    );
    gateway.server = mockServer as any;
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
});
