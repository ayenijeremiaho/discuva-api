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
import { EventService } from '../service/event.service';
import { CreateEventDto } from '../dto/create-event.dto';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { OrderBy } from '../types/order-by.type';
import { Order } from '../types/order.type';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';

interface GetEventsQuery {
  page?: string;
  limit?: string;
  orderBy?: OrderBy;
  order?: Order;
  from?: string;
  to?: string;
  upcoming?: string;
  search?: string;
}

@Controller('events')
export class EventController {
  constructor(private readonly eventService: EventService) {}

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.EVENTS_WRITE)
  @Post()
  async create(@Body() dto: CreateEventDto, @CurrentUser() user: MemberAuth) {
    return this.eventService.create(dto, user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.EVENTS_WRITE)
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<CreateEventDto>,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.eventService.update(id, dto, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.eventService.getById(id, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async getAll(
    @CurrentUser() user: MemberAuth,
    @Query() query: GetEventsQuery,
  ) {
    return this.eventService.getAll(
      +(query.page ?? 1),
      +(query.limit ?? 10),
      query.orderBy,
      query.order,
      {
        memberId: user.id,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        upcoming: query.upcoming === 'true',
        search: query.search,
      },
    );
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.EVENTS_WRITE)
  @Delete('recurring/:recurringEventId')
  async deleteFutureRecurring(
    @Param('recurringEventId', ParseUUIDPipe) recurringEventId: string,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.eventService.deleteFutureRecurring(recurringEventId, user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.EVENTS_WRITE)
  @Delete(':id')
  async deleteEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.eventService.deleteEvent(id, user.id);
  }
}
