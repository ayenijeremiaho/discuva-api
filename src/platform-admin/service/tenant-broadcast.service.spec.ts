import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TenantBroadcastService } from './tenant-broadcast.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { EmailQueueService } from '../../utility/service/email-queue.service';

const mockTenantRepo = { find: jest.fn() };
const mockCls = { runWith: jest.fn((_store, fn) => fn()) };
const mockTx = { query: jest.fn(), findOne: jest.fn() };
const mockTxHost = {
  tx: mockTx,
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};
const mockEmailQueueService = { queueEmail: jest.fn() };

function tenant(id: string, subdomain: string) {
  // schemaName must satisfy runInTenantContext's VALID_SCHEMA_NAME
  // (^[a-z_][a-z0-9_]*$, no hyphens) — subdomain can look like a real
  // subdomain, the schema always has to be underscore-only.
  return {
    id,
    subdomain,
    schemaName: `church_${subdomain.replace(/-/g, '_')}`,
    isActive: true,
  };
}

describe('TenantBroadcastService', () => {
  let service: TenantBroadcastService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantBroadcastService,
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
        { provide: EmailQueueService, useValue: mockEmailQueueService },
      ],
    }).compile();
    service = module.get(TenantBroadcastService);
  });

  it('sends one individual email per tenant with an active admin, never a batched call', async () => {
    mockTenantRepo.find.mockResolvedValue([
      tenant('t1', 'church-a'),
      tenant('t2', 'church-b'),
    ]);
    mockTx.findOne.mockResolvedValue({
      member: { email: 'admin@example.com' },
    });

    const result = await service.broadcastToAllTenantAdmins(
      'Subject',
      '<p>Body</p>',
    );

    expect(mockEmailQueueService.queueEmail).toHaveBeenCalledTimes(2);
    expect(mockEmailQueueService.queueEmail).toHaveBeenCalledWith(
      'admin@example.com',
      'Subject',
      '<p>Body</p>',
    );
    expect(result).toEqual({ sent: 2, skipped: 0, failed: 0 });
  });

  it('skips (does not fail) a tenant with no active admin to notify', async () => {
    mockTenantRepo.find.mockResolvedValue([tenant('t1', 'church-a')]);
    mockTx.findOne.mockResolvedValue(null);

    const result = await service.broadcastToAllTenantAdmins('Subject', 'x');

    expect(mockEmailQueueService.queueEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, skipped: 1, failed: 0 });
  });

  it('one tenant failing does not stop the rest, and is reported separately from skipped', async () => {
    mockTenantRepo.find.mockResolvedValue([
      tenant('t1', 'church-a'),
      tenant('t2', 'church-b'),
    ]);
    mockTx.findOne
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ member: { email: 'admin@example.com' } });

    const result = await service.broadcastToAllTenantAdmins('Subject', 'x');

    expect(result).toEqual({ sent: 1, skipped: 0, failed: 1 });
  });

  describe('broadcastPlainTextToAllTenantAdmins', () => {
    it('escapes HTML-significant characters and wraps each line in its own <p>', async () => {
      mockTenantRepo.find.mockResolvedValue([tenant('t1', 'church-a')]);
      mockTx.findOne.mockResolvedValue({
        member: { email: 'admin@example.com' },
      });

      await service.broadcastPlainTextToAllTenantAdmins(
        'Subject',
        'Line one <script>alert(1)</script>\nLine two',
      );

      const [, , html] = mockEmailQueueService.queueEmail.mock.calls[0];
      expect(html).toBe(
        '<p>Line one &lt;script&gt;alert(1)&lt;/script&gt;</p>\n<p>Line two</p>',
      );
    });

    it('drops blank lines rather than emitting empty paragraphs', async () => {
      mockTenantRepo.find.mockResolvedValue([tenant('t1', 'church-a')]);
      mockTx.findOne.mockResolvedValue({
        member: { email: 'admin@example.com' },
      });

      await service.broadcastPlainTextToAllTenantAdmins(
        'Subject',
        'Line one\n\n\nLine two',
      );

      const [, , html] = mockEmailQueueService.queueEmail.mock.calls[0];
      expect(html).toBe('<p>Line one</p>\n<p>Line two</p>');
    });
  });
});
