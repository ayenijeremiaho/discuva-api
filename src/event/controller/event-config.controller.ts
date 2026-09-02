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
import { EventConfigService } from '../service/event-config.service';
import { CreateEventConfigDto } from '../dto/create-event-config.dto';
import { UpdateEventConfigDto } from '../dto/update-event-config.dto';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';

@UseGuards(AdminGuard)
@RequiresPermission(AdminPermission.EVENTS_WRITE)
@Controller('event-config')
export class EventConfigController {
  constructor(private readonly eventConfigService: EventConfigService) {}

  @Post()
  async create(@Body() dto: CreateEventConfigDto) {
    return this.eventConfigService.create(dto);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventConfigDto,
  ) {
    return this.eventConfigService.update(id, dto);
  }

  @Get(':id')
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventConfigService.get(id);
  }

  @Get()
  async getAll(@Query('page') page = 1, @Query('limit') limit = 10) {
    return this.eventConfigService.getAll(+page, +limit);
  }

  @Delete(':id')
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    await this.eventConfigService.delete(id);
  }
}
