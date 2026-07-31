import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../auth/decorator/public.decorator';
import { VirtualAccountService } from '../service/virtual-account.service';

@Controller('webhooks/virtual-account-credit')
export class VirtualAccountWebhookController {
  constructor(private readonly virtualAccountService: VirtualAccountService) {}

  // Paystack/Flutterwave never send a bearer token — the global JwtAuthGuard
  // would 401 them before this handler's own HMAC signature check ever runs.
  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleCredit(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') paystackSig?: string,
    @Headers('verif-hash') flutterwaveSig?: string,
  ): Promise<void> {
    const signature = paystackSig ?? flutterwaveSig ?? '';
    await this.virtualAccountService.handleWebhookCredit(
      req.rawBody!,
      signature,
    );
  }
}
