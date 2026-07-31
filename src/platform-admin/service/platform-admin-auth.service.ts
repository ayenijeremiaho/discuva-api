import { Injectable, NotImplementedException } from '@nestjs/common';
import { PlatformAdminAuth } from '../interface/platform-admin-auth.interface';

/**
 * Scaffolding only — see MULTI_TENANT_MIGRATION.md §4.10/§9 Phase 5. Real
 * implementation needs the `public.platform_admins` table (§4.1, created
 * once Phase 1's tenant infrastructure lands) and a repository here instead
 * of these stubs.
 */
@Injectable()
export class PlatformAdminAuthService {
  async validateById(_id: string): Promise<PlatformAdminAuth> {
    throw new NotImplementedException(
      'PlatformAdminAuthService is scaffolding — see MULTI_TENANT_MIGRATION.md §4.10',
    );
  }

  async login(
    _email: string,
    _password: string,
  ): Promise<{ accessToken: string }> {
    throw new NotImplementedException(
      'PlatformAdminAuthService is scaffolding — see MULTI_TENANT_MIGRATION.md §4.10',
    );
  }
}
