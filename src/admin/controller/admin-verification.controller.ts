import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ClsService } from 'nestjs-cls';
import { RequiresOwner } from '../decorator/requires-owner.decorator';
import { AdminGuard } from '../guard/admin.guard';
import { VerificationRequestDto } from '../../tenant/dto/signup.dto';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { ChurchRequestService } from '../../tenant/service/church-request.service';

@UseGuards(AdminGuard)
@Controller('admin/verification')
export class AdminVerificationController {
  constructor(
    private readonly churchRequests: ChurchRequestService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @Get()
  status() {
    return this.churchRequests.getVerification(this.cls.get('tenantId'));
  }

  @RequiresOwner()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  request(@Body() dto: VerificationRequestDto) {
    return this.churchRequests.requestVerification(
      this.cls.get('tenantId'),
      dto,
    );
  }
}
