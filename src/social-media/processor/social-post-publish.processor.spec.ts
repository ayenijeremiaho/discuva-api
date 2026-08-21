import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { SocialPostPublishProcessor } from './social-post-publish.processor';
import { SocialPostService } from '../service/social-post.service';

jest.mock('../../tenant/utility/run-in-tenant-context', () => ({
  runInTenantContext: jest.fn((cls, txHost, envelope, fn) => fn()),
}));

const mockPostService = { publish: jest.fn() };
const mockCls = {};
const mockTxHost = {};

describe('SocialPostPublishProcessor', () => {
  let processor: SocialPostPublishProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialPostPublishProcessor,
        { provide: SocialPostService, useValue: mockPostService },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
      ],
    }).compile();
    processor = module.get(SocialPostPublishProcessor);
  });

  it('calls SocialPostService.publish with the job data postId, inside tenant context', async () => {
    const job: any = {
      data: { postId: 'post-1', tenantId: 't1', schemaName: 's1' },
    };

    await processor.handlePublish(job);

    expect(mockPostService.publish).toHaveBeenCalledWith('post-1');
  });

  it('onFailed logs the failure without throwing', () => {
    const job: any = { data: { postId: 'post-1' } };
    expect(() => processor.onFailed(job, new Error('boom'))).not.toThrow();
  });
});
