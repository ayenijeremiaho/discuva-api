import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { Admin } from '../entity/admin.entity';
import { AdminPermission } from '../enum/admin-permission.enum';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';

@Injectable()
export class AdminAccessService {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly config: ConfigService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  isOn(): Promise<boolean> {
    if (!this.cls.isActive()) return this.readMode();
    let pending = this.cls.get('adminAccessMode');
    if (!pending) {
      pending = this.readMode();
      this.cls.set('adminAccessMode', pending);
    }
    return pending;
  }

  private async readMode(): Promise<boolean> {
    const mode = await this.settings.getNumber(
      PlatformSettingKey.ADMIN_ACCESS_MODE,
    );
    if (mode === 2) return true;
    if (mode !== 1) return false;
    const tenantId = this.cls.get('tenantId');
    const allowed = (this.config.get<string>('ADMIN_ACCESS_TEST_TENANTS') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    return !!tenantId && allowed.includes(tenantId);
  }

  async permissions(
    admin: Admin | null | undefined,
  ): Promise<AdminPermission[]> {
    if (!admin || admin.isActive === false) return [];
    return [
      ...new Set([
        ...(admin.adminRole?.permissions ?? []),
        ...((await this.isOn()) ? (admin.additionalPermissions ?? []) : []),
      ]),
    ];
  }

  async has(
    admin: Admin | null | undefined,
    permission: AdminPermission,
  ): Promise<boolean> {
    if (!admin || admin.isActive === false) return false;
    if (admin.adminRole?.permissions?.includes(permission)) return true;
    if (!admin.additionalPermissions?.includes(permission)) return false;
    return this.isOn();
  }

  async filter(admins: Admin[], permission: AdminPermission): Promise<Admin[]> {
    const enabled = await this.isOn();
    return admins.filter(
      (admin) =>
        admin.isActive !== false &&
        (admin.adminRole?.permissions?.includes(permission) ||
          (enabled && admin.additionalPermissions?.includes(permission))),
    );
  }

  async assertEnabled(): Promise<void> {
    if (!(await this.isOn()))
      throw new ForbiddenException('Individual access is not enabled.');
  }

  async assertCanDelegate(
    actor: Admin,
    permissions: AdminPermission[],
  ): Promise<void> {
    if (
      !actor?.isActive ||
      !(await this.has(actor, AdminPermission.ADMIN_WRITE))
    ) {
      throw new ForbiddenException('Access management permission required.');
    }
    if (actor.isOwner) return;
    const mine = new Set(await this.permissions(actor));
    if (permissions.some((p) => !mine.has(p))) {
      throw new ForbiddenException(
        'You can only assign permissions you already have.',
      );
    }
  }

  async describe(admin: Admin): Promise<Admin> {
    admin.effectivePermissions = await this.permissions(admin);
    admin.accessGrantsEnabled = await this.isOn();
    return admin;
  }
}
