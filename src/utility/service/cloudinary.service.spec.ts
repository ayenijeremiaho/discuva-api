import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryService } from './cloudinary.service';

const TENANT = '2e8857e4-35ca-4218-8dcd-623479c64e07';

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: { upload_stream: jest.fn(), destroy: jest.fn() },
    api: { delete_resources_by_prefix: jest.fn(), delete_resources: jest.fn() },
  },
}));

describe('CloudinaryService', () => {
  const cls = { get: jest.fn() };
  const service = new CloudinaryService(
    { get: jest.fn() } as never,
    cls as never,
  );
  const byPrefix = cloudinary.api.delete_resources_by_prefix as jest.Mock;
  const byId = cloudinary.api.delete_resources as jest.Mock;
  const stream = cloudinary.uploader.upload_stream as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    byPrefix.mockResolvedValue({});
    byId.mockResolvedValue({});
    stream.mockImplementation((_options, done) => {
      const { Writable } = jest.requireActual('node:stream');
      return new Writable({
        write: (_c: unknown, _e: unknown, next: () => void) => next(),
        final(next: () => void) {
          done(undefined, {
            secure_url: 'u',
            public_id: 'p',
            resource_type: 'image',
          });
          next();
        },
      });
    });
  });

  const uploadedId = async () => {
    await service.uploadBuffer(
      Buffer.from('x'),
      'church-logos',
      'logo',
      'image/png',
    );
    return stream.mock.calls[0][0].public_id;
  };

  it('stores uploads under the church they belong to', async () => {
    cls.get.mockReturnValue(TENANT);
    expect(await uploadedId()).toBe(`tenants/${TENANT}/church-logos/logo`);
  });

  it('keeps the plain folder when there is no church', async () => {
    cls.get.mockReturnValue(undefined);
    expect(await uploadedId()).toBe('church-logos/logo');
  });

  it('clears the church folder for every file type, following pages', async () => {
    byPrefix.mockResolvedValueOnce({ next_cursor: 'more' });
    await service.deleteTenantFiles(TENANT, []);
    const prefix = `tenants/${TENANT}/`;
    expect(byPrefix.mock.calls.map((c) => [c[0], c[1].resource_type])).toEqual([
      [prefix, 'image'],
      [prefix, 'image'],
      [prefix, 'video'],
      [prefix, 'raw'],
    ]);
    expect(byPrefix.mock.calls[1][1].next_cursor).toBe('more');
  });

  it('refuses anything but a real church id, so a prefix can never widen', async () => {
    await expect(service.deleteTenantFiles('', [])).rejects.toThrow();
    await expect(service.deleteTenantFiles('../x', [])).rejects.toThrow();
    expect(byPrefix).not.toHaveBeenCalled();
  });

  it('deletes older files by id in batches of 100', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `tithes/${i}`);
    await service.deleteTenantFiles(TENANT, ids);
    const imageCalls = byId.mock.calls.filter(
      (c) => c[1].resource_type === 'image',
    );
    expect(imageCalls.map((c) => c[0].length)).toEqual([100, 1]);
  });

  it('never deletes by id inside another church folder', async () => {
    await service.deleteTenantFiles(TENANT, [
      'tenants/other/church-logos/x',
      'tithes/1',
    ]);
    for (const call of byId.mock.calls) expect(call[0]).toEqual(['tithes/1']);
  });

  it('reports failures so the job can retry', async () => {
    byPrefix.mockRejectedValue(new Error('rate limited'));
    await expect(service.deleteTenantFiles(TENANT, [])).rejects.toThrow(
      'rate limited',
    );
  });
});
