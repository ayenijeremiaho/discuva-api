import {
  ACCOUNT_FILE_CLEANUP_OPTIONS,
  AccountFileCleanupProcessor,
} from './account-file-cleanup.processor';

describe('AccountFileCleanupProcessor', () => {
  const cloudinary = { deleteTenantFiles: jest.fn() };
  const processor = new AccountFileCleanupProcessor(cloudinary as never);
  const job = { data: { tenantId: 't1', legacyPublicIds: ['a'] } } as never;

  beforeEach(() => jest.clearAllMocks());

  it('deletes the files of the removed account', async () => {
    cloudinary.deleteTenantFiles.mockResolvedValue(undefined);
    await processor.handle(job);
    expect(cloudinary.deleteTenantFiles).toHaveBeenCalledWith('t1', ['a']);
  });

  it('lets a failure reach Bull so the job retries', async () => {
    cloudinary.deleteTenantFiles.mockRejectedValue(new Error('rate limited'));
    await expect(processor.handle(job)).rejects.toThrow('rate limited');
    expect(ACCOUNT_FILE_CLEANUP_OPTIONS.attempts).toBeGreaterThan(1);
  });
});
