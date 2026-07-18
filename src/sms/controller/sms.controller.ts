import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { SmsService } from '../service/sms.service';
import { SegmentCountDto } from '../dto/segment-count.dto';

@UseGuards(AdminGuard)
@Controller('admin/sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  @RequiresPermission(AdminPermission.SMS_READ)
  @Get('balance')
  getBalance() {
    return this.smsService.getBalance();
  }

  @RequiresPermission(AdminPermission.SMS_READ)
  @HttpCode(HttpStatus.OK)
  @Post('segment-count')
  getSegmentCount(@Body() dto: SegmentCountDto) {
    return this.smsService.calculateSegments(dto.message);
  }

  @RequiresPermission(AdminPermission.SMS_READ)
  @Get('logs')
  getLogs() {
    return this.smsService.getLogs();
  }
}
