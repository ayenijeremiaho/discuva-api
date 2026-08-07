import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { GivingCheckoutService } from '../service/giving-checkout.service';
import { InitiateGivingCheckoutDto } from '../dto/initiate-giving-checkout.dto';

@RequiresModule('tithe')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('finance/giving/checkout')
export class GivingCheckoutController {
  constructor(private readonly checkoutService: GivingCheckoutService) {}

  // Whether to show a "Give via Checkout" option at all — null means the
  // tenant hasn't configured (or activated) a giving provider yet.
  @Get('provider')
  getActiveProvider() {
    return this.checkoutService.getActiveProvider();
  }

  @Post()
  initiate(
    @CurrentUser() user: MemberAuth,
    @Body() dto: InitiateGivingCheckoutDto,
  ) {
    return this.checkoutService.initiateCheckout(user.id, dto);
  }
}
