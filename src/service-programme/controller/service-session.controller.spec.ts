import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { ServiceSessionController } from './service-session.controller';
import { ServiceSessionService } from '../service/service-session.service';
import { ServiceSessionGateway } from '../gateway/service-session.gateway';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { ShareTokenGuard } from '../guard/share-token.guard';
import { NamedAccessGuard } from '../guard/named-access.guard';
import { AdminGuard } from '../../admin/guard/admin.guard';

const allowGuard = { canActivate: () => true };

const mockSessionSvc = {
  start: jest.fn(),
  startEvent: jest.fn(),
  end: jest.fn(),
  advance: jest.fn(),
  getState: jest.fn(),
  getActiveSessions: jest.fn(),
};

const mockGateway = {
  broadcastState: jest.fn(),
  broadcastActiveSessionsChanged: jest.fn(),
};

const mockCls = { get: jest.fn() };

const user = { id: 'member-1' } as any;
const state = { anchor: {}, session: {}, effectiveSlots: [] } as any;
const activeSessions = [
  { sessionCode: 'SVC-1', serviceSlotName: 'Sunday', startedAt: new Date() },
];

describe('ServiceSessionController', () => {
  let controller: ServiceSessionController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCls.get.mockReturnValue('tenant-1');
    mockSessionSvc.getState.mockResolvedValue(state);
    mockSessionSvc.getActiveSessions.mockResolvedValue(activeSessions);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ServiceSessionController],
      providers: [
        { provide: ServiceSessionService, useValue: mockSessionSvc },
        { provide: ServiceSessionGateway, useValue: mockGateway },
        { provide: ClsService, useValue: mockCls },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allowGuard)
      .overrideGuard(RolesGuard)
      .useValue(allowGuard)
      .overrideGuard(PlanGuard)
      .useValue(allowGuard)
      .overrideGuard(ModuleEnabledGuard)
      .useValue(allowGuard)
      .overrideGuard(ShareTokenGuard)
      .useValue(allowGuard)
      .overrideGuard(NamedAccessGuard)
      .useValue(allowGuard)
      .overrideGuard(AdminGuard)
      .useValue(allowGuard)
      .compile();

    controller = module.get<ServiceSessionController>(ServiceSessionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('start', () => {
    it('broadcasts state and the tenant-scoped active-sessions list', async () => {
      mockSessionSvc.start.mockResolvedValue({ sessionCode: 'SVC-1' });

      await controller.start('programme-1', user);

      expect(mockGateway.broadcastState).toHaveBeenCalledWith('SVC-1', state);
      expect(mockGateway.broadcastActiveSessionsChanged).toHaveBeenCalledWith(
        'tenant-1',
        activeSessions,
      );
    });
  });

  describe('startEvent', () => {
    it('broadcasts state and the tenant-scoped active-sessions list', async () => {
      mockSessionSvc.startEvent.mockResolvedValue({ sessionCode: 'SVC-2' });

      await controller.startEvent('event-1', user);

      expect(mockGateway.broadcastState).toHaveBeenCalledWith('SVC-2', state);
      expect(mockGateway.broadcastActiveSessionsChanged).toHaveBeenCalledWith(
        'tenant-1',
        activeSessions,
      );
    });
  });

  describe('end', () => {
    it('broadcasts state and the tenant-scoped active-sessions list', async () => {
      mockSessionSvc.end.mockResolvedValue({ sessionCode: 'SVC-1' });

      await controller.end('SVC-1', user);

      expect(mockGateway.broadcastActiveSessionsChanged).toHaveBeenCalledWith(
        'tenant-1',
        activeSessions,
      );
    });
  });

  describe('pmEnd', () => {
    it('broadcasts state and the tenant-scoped active-sessions list', async () => {
      mockSessionSvc.end.mockResolvedValue({ sessionCode: 'SVC-1' });

      await controller.pmEnd('SVC-1', 'Some Coordinator');

      expect(mockGateway.broadcastActiveSessionsChanged).toHaveBeenCalledWith(
        'tenant-1',
        activeSessions,
      );
    });
  });

  describe('when no tenant is on the CLS store', () => {
    it('skips the active-sessions broadcast without throwing', async () => {
      mockCls.get.mockReturnValue(undefined);
      mockSessionSvc.end.mockResolvedValue({ sessionCode: 'SVC-1' });

      await controller.end('SVC-1', user);

      expect(mockGateway.broadcastActiveSessionsChanged).not.toHaveBeenCalled();
    });
  });

  describe('routes that do not change session liveness', () => {
    it('advance does not broadcast the active-sessions list', async () => {
      mockSessionSvc.advance.mockResolvedValue({});
      await controller.advance('SVC-1', user);

      expect(mockGateway.broadcastActiveSessionsChanged).not.toHaveBeenCalled();
    });
  });
});
