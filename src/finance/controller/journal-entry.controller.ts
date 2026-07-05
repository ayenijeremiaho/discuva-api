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
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { JournalEntryService } from '../service/journal-entry.service';
import {
  CreateJournalEntryDto,
  JournalEntryQueryDto,
} from '../dto/journal-entry.dto';

@UseGuards(AdminGuard)
@Controller('admin/finance/journal-entries')
export class JournalEntryController {
  constructor(private readonly journalEntryService: JournalEntryService) {}

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post()
  create(@Body() dto: CreateJournalEntryDto, @CurrentAdmin() admin: Admin) {
    return this.journalEntryService.create(dto, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get()
  findAll(@Query() query: JournalEntryQueryDto) {
    return this.journalEntryService.findAll(query);
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.journalEntryService.findOne(id);
  }

  @RequiresPermission(AdminPermission.FINANCE_APPROVE)
  @Patch(':id/approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.journalEntryService.approve(id, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_APPROVE)
  @Patch(':id/reject')
  reject(@Param('id', ParseUUIDPipe) id: string) {
    return this.journalEntryService.reject(id);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Patch(':id/resubmit')
  resubmit(@Param('id', ParseUUIDPipe) id: string) {
    return this.journalEntryService.resubmit(id);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  deleteDraft(@Param('id', ParseUUIDPipe) id: string) {
    return this.journalEntryService.deleteDraft(id);
  }

  @RequiresPermission(AdminPermission.FINANCE_APPROVE)
  @Patch(':id/void')
  void(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() admin: Admin) {
    return this.journalEntryService.void(id, admin);
  }
}
