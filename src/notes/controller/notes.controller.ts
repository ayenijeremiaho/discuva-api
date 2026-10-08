import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { NotesService } from '../service/notes.service';
import {
  CreateNoteDto,
  NotePreferencesDto,
  NoteQueryDto,
  ScriptureTapsDto,
  TopScripturesQueryDto,
  UpdateNoteDto,
} from '../dto/note.dto';

@RequiresModule('notes')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('notes')
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @Get()
  list(@Query() query: NoteQueryDto, @Request() req: any) {
    return this.notesService.list(req.user.id, query);
  }

  @Get('context')
  context(@Request() req: any) {
    return this.notesService.context(req.user.id);
  }

  @Get('streak')
  streak(@Request() req: any) {
    return this.notesService.streak(req.user.id);
  }

  @Get('top-scriptures')
  topScriptures(@Query() query: TopScripturesQueryDto) {
    return this.notesService.topScriptures(query.eventId);
  }

  @Post('scripture-taps')
  @HttpCode(HttpStatus.NO_CONTENT)
  recordScriptureTaps(@Body() dto: ScriptureTapsDto) {
    return this.notesService.recordScriptureTaps(dto);
  }

  @Get('services')
  linkableServices(@Request() req: any) {
    return this.notesService.linkableServices(req.user.id);
  }

  @Get('preferences')
  preferences(@Request() req: any) {
    return this.notesService.preferences(req.user.id);
  }

  @Put('preferences')
  setPreferences(@Body() dto: NotePreferencesDto, @Request() req: any) {
    return this.notesService.setPreferences(req.user.id, dto.nudges);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.notesService.get(req.user.id, id);
  }

  @Post()
  create(@Body() dto: CreateNoteDto, @Request() req: any) {
    return this.notesService.create(req.user.id, dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoteDto,
    @Request() req: any,
  ) {
    return this.notesService.update(req.user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.notesService.remove(req.user.id, id);
  }
}
