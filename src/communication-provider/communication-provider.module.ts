import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommunicationProvider } from '../platform-admin/entity/communication-provider.entity';
import { TenantCommunicationProviderConfig } from '../platform-admin/entity/tenant-communication-provider-config.entity';
import { TenantCommunicationProviderController } from './controller/tenant-communication-provider.controller';
import { TenantCommunicationProviderService } from './service/tenant-communication-provider.service';
import { SmsCredentialResolverService } from './service/sms-credential-resolver.service';
import { EmailCredentialResolverService } from './service/email-credential-resolver.service';

// Both entities here are control-plane (public, never a search_path
// target — same as PlatformAdminModule's own registration of them), so
// plain TypeOrmModule.forFeature is correct, not TenantTypeOrmModule.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      CommunicationProvider,
      TenantCommunicationProviderConfig,
    ]),
  ],
  controllers: [TenantCommunicationProviderController],
  providers: [
    TenantCommunicationProviderService,
    SmsCredentialResolverService,
    EmailCredentialResolverService,
  ],
  exports: [SmsCredentialResolverService, EmailCredentialResolverService],
})
export class CommunicationProviderModule {}
