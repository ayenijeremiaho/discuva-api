import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SmsService } from './service/sms.service';
import { SmsController } from './controller/sms.controller';
import { TermiiSmsProvider } from './provider/termii-sms.provider';
import { TwilioSmsProvider } from './provider/twilio-sms.provider';
import { SmsProviderRegistryService } from './service/sms-provider-registry.service';
import { CommunicationProviderModule } from '../communication-provider/communication-provider.module';

@Module({
  imports: [ConfigModule, CommunicationProviderModule],
  controllers: [SmsController],
  providers: [
    SmsService,
    TermiiSmsProvider,
    TwilioSmsProvider,
    SmsProviderRegistryService,
  ],
  exports: [SmsService],
})
export class SmsModule {}
