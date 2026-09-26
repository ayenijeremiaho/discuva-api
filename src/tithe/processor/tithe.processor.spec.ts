import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TitheProcessor, TitheProcessJobData } from './tithe.processor';
import { TitheUploadBatch } from '../entity/tithe-upload-batch.entity';
import { TitheRecord } from '../entity/tithe-record.entity';
import { TitheUnmatchedRecord } from '../entity/tithe-unmatched-record.entity';
import { TitheDisputeRecord } from '../entity/tithe-dispute-record.entity';

const mockBatchRepo = { findOne: jest.fn(), update: jest.fn() };

const mockManager = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn((_e: unknown, data: unknown) => data),
  save: jest.fn((_e: unknown, data: unknown) => Promise.resolve(data)),
  update: jest.fn(),
};

const mockCls = {
  runWith: jest.fn((_store: unknown, fn: () => unknown) => fn()),
};
const mockTxHost = {
  tx: mockManager,
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};

function buildJob(rows: any[]): { data: TitheProcessJobData } {
  return { data: { batchId: 'batch-1', rows } as TitheProcessJobData };
}

describe('TitheProcessor', () => {
  let processor: TitheProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockBatchRepo.findOne.mockResolvedValue({ id: 'batch-1' });
    mockManager.find.mockResolvedValue([
      { id: 'go-tithe', name: 'Tithe' },
      { id: 'go-building', name: 'Building Fund' },
    ]);
    mockManager.findOne.mockResolvedValue(null);
    mockManager.create.mockImplementation((_e: unknown, data: unknown) => data);
    mockManager.save.mockImplementation((_e: unknown, data: unknown) =>
      Promise.resolve(data),
    );
    mockTxHost.withTransaction.mockImplementation((fn: () => unknown) => fn());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TitheProcessor,
        {
          provide: getRepositoryToken(TitheUploadBatch),
          useValue: mockBatchRepo,
        },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
      ],
    }).compile();

    processor = module.get(TitheProcessor);
  });

  it('sets givingOption on a matched record when the CSV name matches case-insensitively', async () => {
    mockManager.findOne
      .mockResolvedValueOnce({ id: 'member-1', email: 'a@test.com' }) // member lookup
      .mockResolvedValueOnce(null); // no existing duplicate

    await processor.handleBatch(
      buildJob([
        {
          email: 'a@test.com',
          amount: 5000,
          paymentDate: '2026-05-01',
          givingOption: 'tithe',
        },
      ]) as any,
    );

    expect(mockManager.create).toHaveBeenCalledWith(
      TitheRecord,
      expect.objectContaining({ givingOption: { id: 'go-tithe' } }),
    );
  });

  it('leaves givingOption unset when the CSV name does not match any option', async () => {
    mockManager.findOne
      .mockResolvedValueOnce({ id: 'member-1', email: 'a@test.com' })
      .mockResolvedValueOnce(null);

    await processor.handleBatch(
      buildJob([
        {
          email: 'a@test.com',
          amount: 5000,
          paymentDate: '2026-05-01',
          givingOption: 'Not A Real Option',
        },
      ]) as any,
    );

    expect(mockManager.create).toHaveBeenCalledWith(
      TitheRecord,
      expect.objectContaining({ givingOption: null }),
    );
  });

  it('leaves givingOption unset when the CSV column is blank', async () => {
    mockManager.findOne
      .mockResolvedValueOnce({ id: 'member-1', email: 'a@test.com' })
      .mockResolvedValueOnce(null);

    await processor.handleBatch(
      buildJob([
        { email: 'a@test.com', amount: 5000, paymentDate: '2026-05-01' },
      ]) as any,
    );

    expect(mockManager.create).toHaveBeenCalledWith(
      TitheRecord,
      expect.objectContaining({ givingOption: null }),
    );
  });

  it('routes an unrecognized email to TitheUnmatchedRecord without touching giving options', async () => {
    mockManager.findOne.mockResolvedValueOnce(null); // no member found

    await processor.handleBatch(
      buildJob([
        {
          email: 'nobody@test.com',
          amount: 5000,
          paymentDate: '2026-05-01',
          givingOption: 'Tithe',
        },
      ]) as any,
    );

    expect(mockManager.create).toHaveBeenCalledWith(
      TitheUnmatchedRecord,
      expect.objectContaining({ rawEmail: 'nobody@test.com' }),
    );
    expect(mockManager.create).not.toHaveBeenCalledWith(
      TitheRecord,
      expect.anything(),
    );
  });

  it('routes a duplicate member+date+amount to TitheDisputeRecord', async () => {
    mockManager.findOne
      .mockResolvedValueOnce({ id: 'member-1', email: 'a@test.com' })
      .mockResolvedValueOnce({ id: 'existing-record' });

    await processor.handleBatch(
      buildJob([
        { email: 'a@test.com', amount: 5000, paymentDate: '2026-05-01' },
      ]) as any,
    );

    expect(mockManager.create).toHaveBeenCalledWith(
      TitheDisputeRecord,
      expect.objectContaining({ existingRecord: { id: 'existing-record' } }),
    );
  });
});
