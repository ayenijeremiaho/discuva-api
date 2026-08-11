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
  UseGuards,
} from '@nestjs/common';
import { ClergyTitleService } from '../service/clergy-title.service';
import { CreateClergyTitleDto } from '../dto/create-clergy-title.dto';
import { UpdateClergyTitleDto } from '../dto/update-clergy-title.dto';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';

// Reuses MEMBERS_WRITE rather than a new CLERGY_TITLES_* pair — same
// precedent already established for /members/:id/clergy itself.
@Controller('clergy-titles')
export class ClergyTitleController {
  constructor(private readonly clergyTitleService: ClergyTitleService) {}

  @Get()
  async getAll() {
    return this.clergyTitleService.getAll();
  }

  @Get(':id')
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.clergyTitleService.getOne(id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @Post()
  async create(
    @Body() dto: CreateClergyTitleDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.clergyTitleService.create(dto, user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClergyTitleDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.clergyTitleService.update(id, dto, user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.clergyTitleService.delete(id, user.id);
  }
}
