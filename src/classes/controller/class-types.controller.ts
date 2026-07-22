import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ClassTypesService } from '../service/class-types.service';
import { CreateClassTypeDto, UpdateClassTypeDto } from '../dto/class-type.dto';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('classes/types')
export class ClassTypesController {
  constructor(private readonly classTypesService: ClassTypesService) {}

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Post()
  create(@Body() dto: CreateClassTypeDto) {
    return this.classTypesService.createClassType(dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassTypeDto,
  ) {
    return this.classTypesService.updateClassType(id, dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.classTypesService.deleteClassType(id);
  }

  @Get()
  findAll() {
    return this.classTypesService.getAllClassTypes();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.classTypesService.getClassType(id);
  }
}
