import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TenantProvisioningService } from './tenant/service/tenant-provisioning.service';
import { UtilityService } from './utility/service/utility.service';

// Thin wrapper over the same TenantProvisioningService POST /signup uses —
// for platform-admin/support use (re-provisioning, the existing-client
// migration in docs/MULTI_TENANT_MIGRATION.md §8), not a second
// implementation to keep in sync.
//
// Usage:
//   npm run provision:tenant -- --subdomain=church-beta --name="Beta Church" \
//     --admin-email=admin@betachurch.org --admin-password=Sup3rSecret! \
//     [--admin-firstname=Admin] [--admin-lastname=User] [--plan=free]
function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function bootstrap() {
  const args = parseArgs();
  const required = ['subdomain', 'name', 'admin-email', 'admin-password'];
  const missing = required.filter((key) => !args[key]);
  if (missing.length) {
    console.error(`Missing required arg(s): ${missing.join(', ')}`);
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const provisioningService = app.get(TenantProvisioningService);
    const adminPasswordHash = await UtilityService.hashValue(
      args['admin-password'],
    );

    const tenant = await provisioningService.provision({
      subdomain: args.subdomain,
      churchName: args.name,
      adminFirstname: args['admin-firstname'] ?? 'Admin',
      adminLastname: args['admin-lastname'] ?? 'User',
      adminEmail: args['admin-email'],
      adminPasswordHash,
      planId: args.plan ?? 'free',
    });

    console.log(
      `Provisioned tenant "${tenant.subdomain}" (schema ${tenant.schemaName}, id ${tenant.id})`,
    );
  } finally {
    await app.close();
  }
}

bootstrap().catch((err) => {
  console.error('Provisioning failed:', err);
  process.exit(1);
});
