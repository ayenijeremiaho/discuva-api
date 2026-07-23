import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { SermonService } from '../service/sermon.service';
import { SermonQueryDto } from '../dto/sermon.dto';
import { UpsertSermonNoteDto } from '../dto/sermon-note.dto';

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

  @Get(':id/note')
  getMyNote(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.sermonService.getMyNote(id, req.user.id);
  }

  @Put(':id/note')
  upsertMyNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertSermonNoteDto,
    @Request() req: any,
  ) {
    return this.sermonService.upsertMyNote(id, req.user.id, dto);
  }

  @Delete(':id/note')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteMyNote(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.sermonService.deleteMyNote(id, req.user.id);
  }
}
