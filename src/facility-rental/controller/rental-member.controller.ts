import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RentalBookingService } from '../service/rental-booking.service';
import { RentalConfigService } from '../service/rental-config.service';
import { CreateRentalBookingDto } from '../dto/rental-booking.dto';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';

@RequiresModule('facility_rental')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('facility-rental')
export class RentalMemberController {
  constructor(
    private readonly bookingService: RentalBookingService,
    private readonly configService: RentalConfigService,
  ) {}

  @Get('facilities')
  getFacilities() {
    return this.configService.getFacilities();
  }

  @Get('addons')
  getAddons() {
    return this.configService.getAddons();
  }

  @Get('facilities/:id/availability')
  getAvailability(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.bookingService.getAvailability(id, from, to);
  }

  @Post('bookings')
  createBooking(@Req() req: any, @Body() dto: CreateRentalBookingDto) {
    const user = req.user;
    return this.bookingService.createBooking(user.id, dto);
  }

  @Get('bookings')
  getMyBookings(@Req() req: any) {
    const user = req.user;
    return this.bookingService.getMyBookings(user.id);
  }

  @Get('bookings/:id')
  getBooking(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const user = req.user;
    return this.bookingService.getMyBookingById(user.id, id);
  }

  @Patch('bookings/:id/cancel')
  cancelBooking(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const user = req.user;
    return this.bookingService.cancelBooking(id, user.id);
  }
}
