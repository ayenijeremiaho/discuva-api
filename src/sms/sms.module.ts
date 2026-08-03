import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SmsService } from './service/sms.service';
import { SmsController } from './controller/sms.controller';
import { TermiiSmsProvider } from './provider/termii-sms.provider';
import { SMS_PROVIDER } from './interface/sms-provider.interface';
import { CommunicationProviderModule } from '../communication-provider/communication-provider.module';

@Module({
  imports: [ConfigModule, CommunicationProviderModule],
  controllers: [SmsController],
  providers: [
    SmsService,
    // Swapping SMS vendors later means changing only this one line — every
    // consumer injects SMS_PROVIDER through the interface, never this class.
    { provide: SMS_PROVIDER, useClass: TermiiSmsProvider },
  ],
  exports: [SmsService],
})
export class SmsModule {}
