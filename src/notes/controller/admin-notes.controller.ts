import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { NotesService } from '../service/notes.service';

@RequiresModule('notes')
@UseGuards(AdminGuard, ModuleEnabledGuard)
@Controller('admin/notes')
export class AdminNotesController {
  constructor(private readonly notesService: NotesService) {}

  @Get('insights')
  @RequiresPermission(AdminPermission.SERMON_READ)
  insights() {
    return this.notesService.insights();
  }
}
