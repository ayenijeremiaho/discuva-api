import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentAdmin } from '../decorator/current-admin.decorator';
import { RequiresOwner } from '../decorator/requires-owner.decorator';
import { Admin } from '../entity/admin.entity';
import { AdminGuard } from '../guard/admin.guard';
import { AdminOwnerService } from '../service/admin-owner.service';

@UseGuards(AdminGuard)
@Controller('admin/owners')
export class AdminOwnerController {
  constructor(private readonly owners: AdminOwnerService) {}

  @Get()
  list() {
    return this.owners.list();
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('accept')
  accept(@CurrentAdmin() admin: Admin) {
    return this.owners.accept(admin);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('decline')
  decline(@CurrentAdmin() admin: Admin) {
    return this.owners.decline(admin);
  }

  @RequiresOwner()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('step-down')
  stepDown(@CurrentAdmin() admin: Admin) {
    return this.owners.stepDown(admin);
  }

  @RequiresOwner()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(':id/invite')
  invite(@CurrentAdmin() admin: Admin, @Param('id', ParseUUIDPipe) id: string) {
    return this.owners.invite(admin, id);
  }

  @RequiresOwner()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id/invite')
  cancelInvite(
    @CurrentAdmin() admin: Admin,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.owners.cancelInvite(admin, id);
  }
}
