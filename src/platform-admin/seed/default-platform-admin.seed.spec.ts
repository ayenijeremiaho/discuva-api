import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DefaultPlatformAdminSeed } from './default-platform-admin.seed';
import { PlatformAdminRoleService } from '../service/platform-admin-role.service';
import { PlatformAdmin } from '../entity/platform-admin.entity';

const mockPlatformAdminRepo = {
  existsBy: jest.fn(),
  create: jest.fn((v) => v),
  save: jest.fn(),
};
const mockRoleService = { findOrCreateSuperAdmin: jest.fn() };

function buildSeed(env: Record<string, string | undefined>) {
  return Test.createTestingModule({
    providers: [
      DefaultPlatformAdminSeed,
      {
        provide: getRepositoryToken(PlatformAdmin),
        useValue: mockPlatformAdminRepo,
      },
      { provide: PlatformAdminRoleService, useValue: mockRoleService },
      { provide: ConfigService, useValue: { get: (key: string) => env[key] } },
    ],
  })
    .compile()
    .then((module: TestingModule) => module.get(DefaultPlatformAdminSeed));
}

describe('DefaultPlatformAdminSeed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips when the env vars are not set', async () => {
    const seed = await buildSeed({});
    await seed.run();
    expect(mockPlatformAdminRepo.existsBy).not.toHaveBeenCalled();
  });

  it('aborts when the password hash does not look like argon2', async () => {
    const seed = await buildSeed({
      DEFAULT_PLATFORM_ADMIN_EMAIL: 'admin@example.com',
      DEFAULT_PLATFORM_ADMIN_PASSWORD_HASH: 'plaintext-not-a-hash',
    });
    await seed.run();
    expect(mockPlatformAdminRepo.existsBy).not.toHaveBeenCalled();
  });

  it('skips when a platform admin already exists (idempotent)', async () => {
    mockPlatformAdminRepo.existsBy.mockResolvedValue(true);
    const seed = await buildSeed({
      DEFAULT_PLATFORM_ADMIN_EMAIL: 'admin@example.com',
      DEFAULT_PLATFORM_ADMIN_PASSWORD_HASH: '$argon2id$v=19$...',
    });
    await seed.run();
    expect(mockRoleService.findOrCreateSuperAdmin).not.toHaveBeenCalled();
    expect(mockPlatformAdminRepo.save).not.toHaveBeenCalled();
  });

  it('seeds the first platform admin with the SuperAdmin role', async () => {
    mockPlatformAdminRepo.existsBy.mockResolvedValue(false);
    mockRoleService.findOrCreateSuperAdmin.mockResolvedValue({
      id: 'role-1',
      name: 'SuperAdmin',
    });
    const seed = await buildSeed({
      DEFAULT_PLATFORM_ADMIN_EMAIL: 'Admin@Example.com',
      DEFAULT_PLATFORM_ADMIN_PASSWORD_HASH: '$argon2id$v=19$...',
    });

    await seed.run();

    expect(mockPlatformAdminRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'admin@example.com',
        passwordHash: '$argon2id$v=19$...',
        isActive: true,
        platformAdminRole: { id: 'role-1', name: 'SuperAdmin' },
      }),
    );
  });
});
