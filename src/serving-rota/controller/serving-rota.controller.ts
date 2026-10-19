import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { ServingRotaService } from '../service/serving-rota.service';
import { RequestCoverDto, SaveRotaDto } from '../dto/serving-rota.dto';

const Uuid = (name: string) => Param(name, ParseUUIDPipe);

@RequiresModule('serving_rota')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('rota')
export class ServingRotaController {
  constructor(private readonly rota: ServingRotaService) {}

  @Get('mine')
  mine(@CurrentUser() user: MemberAuth) {
    return this.rota.mine(user.id);
  }

  @Get('departments')
  departments(@CurrentUser() user: MemberAuth) {
    return this.rota.departments(user.id);
  }

  @Get('departments/:departmentId/services')
  services(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
  ) {
    return this.rota.services(user.id, departmentId);
  }

  @Get('departments/:departmentId/services/:slotId')
  slot(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
    @Uuid('slotId') slotId: string,
  ) {
    return this.rota.slotRota(user.id, departmentId, slotId);
  }

  @Put('departments/:departmentId/services/:slotId')
  save(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
    @Uuid('slotId') slotId: string,
    @Body() dto: SaveRotaDto,
  ) {
    return this.rota.saveSlotRota(user.id, departmentId, slotId, dto.entries);
  }

  @Post('assignments/:assignmentId/cover')
  requestCover(
    @CurrentUser() user: MemberAuth,
    @Uuid('assignmentId') assignmentId: string,
    @Body() dto: RequestCoverDto,
  ) {
    return this.rota.requestCover(user.id, assignmentId, dto);
  }

  @Post('cover/:requestId/accept')
  accept(
    @CurrentUser() user: MemberAuth,
    @Uuid('requestId') requestId: string,
  ) {
    return this.rota.acceptCover(user.id, requestId);
  }

  @Delete('cover/:requestId')
  cancel(
    @CurrentUser() user: MemberAuth,
    @Uuid('requestId') requestId: string,
  ) {
    return this.rota.cancelCover(user.id, requestId);
  }
}
