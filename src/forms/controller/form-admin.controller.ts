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
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { FormService } from '../service/form.service';
import { CreateFormDto, UpdateFormDto } from '../dto/form.dto';

@RequiresModule('forms')
@UseGuards(AdminGuard, ModuleEnabledGuard)
@Controller('forms')
export class FormAdminController {
  constructor(private readonly formService: FormService) {}

  @RequiresPermission(AdminPermission.FORMS_WRITE)
  @Post()
  create(@Body() dto: CreateFormDto) {
    return this.formService.create(dto);
  }

  @RequiresPermission(AdminPermission.FORMS_READ)
  @Get()
  getAll() {
    return this.formService.getAll();
  }

  @RequiresPermission(AdminPermission.FORMS_READ)
  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.formService.getById(id);
  }

  @RequiresPermission(AdminPermission.FORMS_WRITE)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFormDto) {
    return this.formService.update(id, dto);
  }

  @RequiresPermission(AdminPermission.FORMS_WRITE)
  @Delete(':id')
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.formService.delete(id);
  }

  @RequiresPermission(AdminPermission.FORMS_READ)
  @Get(':id/submissions')
  getSubmissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.formService.getSubmissions(
      id,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  @RequiresPermission(AdminPermission.FORMS_READ)
  @Get(':id/analytics')
  getAnalytics(@Param('id', ParseUUIDPipe) id: string) {
    return this.formService.getAnalytics(id);
  }

  @RequiresPermission(AdminPermission.FORMS_READ)
  @Get(':id/submissions/export')
  async exportSubmissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const csv = await this.formService.getSubmissionsCsv(id);
    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="form-submissions-${id}.csv"`,
    });
    res.end(csv);
  }
}
