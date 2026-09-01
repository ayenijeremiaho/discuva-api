import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { VenueService } from '../service/venue.service';
import { CreateVenueDto, UpdateVenueDto } from '../dto/create-venue.dto';
import { NearbyVenuesQueryDto } from '../dto/nearby-venues-query.dto';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';

@UseGuards(JwtAuthGuard)
@Controller('venues')
export class VenueController {
  constructor(private readonly venueService: VenueService) {}

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.VENUES_WRITE)
  @Post()
  create(@Body() dto: CreateVenueDto) {
    return this.venueService.create(dto);
  }

  @Get()
  getAll() {
    return this.venueService.getAll();
  }

  @Get('nearby')
  getNearby(@Query() query: NearbyVenuesQueryDto) {
    return this.venueService.getNearby(
      query.latitude,
      query.longitude,
      query.radiusMeters,
      query.limit,
    );
  }

  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.venueService.getById(id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.VENUES_WRITE)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVenueDto) {
    return this.venueService.update(id, dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.VENUES_WRITE)
  @Delete(':id')
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.venueService.delete(id);
  }
}
