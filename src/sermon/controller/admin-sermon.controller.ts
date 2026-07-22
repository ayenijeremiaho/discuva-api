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
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { SermonService } from '../service/sermon.service';
import {
  CreateSermonDto,
  SermonQueryDto,
  UpdateSermonDto,
} from '../dto/sermon.dto';
import { AnnounceLiveDto } from '../dto/announce-live.dto';

@UseGuards(AdminGuard)
@Controller('admin/sermons')
export class AdminSermonController {
  constructor(private readonly sermonService: SermonService) {}

  @RequiresPermission(AdminPermission.SERMON_WRITE)
  @Post()
  create(@Body() dto: CreateSermonDto, @CurrentAdmin() admin: Admin) {
    return this.sermonService.create(dto, admin);
  }

  @RequiresPermission(AdminPermission.SERMON_READ)
  @Get()
  findAll(@Query() query: SermonQueryDto) {
    const { page = 1, limit = 20, series } = query;
    return this.sermonService.findAll(page, limit, series);
  }

  @RequiresPermission(AdminPermission.SERMON_READ)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.sermonService.findOne(id);
  }

  @RequiresPermission(AdminPermission.SERMON_WRITE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSermonDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.sermonService.update(id, dto, admin);
  }

  @RequiresPermission(AdminPermission.SERMON_WRITE)
  @Delete(':id')
  delete(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() admin: Admin) {
    return this.sermonService.delete(id, admin);
  }

  @RequiresPermission(AdminPermission.SERMON_WRITE)
  @Post('announce-live')
  announceLive(@Body() dto: AnnounceLiveDto, @CurrentAdmin() admin: Admin) {
    return this.sermonService.announceLive(dto, admin);
  }
}
