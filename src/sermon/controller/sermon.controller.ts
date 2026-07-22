import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { SermonService } from '../service/sermon.service';
import { SermonQueryDto } from '../dto/sermon.dto';

@RequiresModule('sermons')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('sermons')
export class SermonController {
  constructor(private readonly sermonService: SermonService) {}

  @Get()
  findAll(@Query() query: SermonQueryDto) {
    const { page = 1, limit = 20, series } = query;
    return this.sermonService.findAll(page, limit, series);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.sermonService.findOne(id);
  }
}
