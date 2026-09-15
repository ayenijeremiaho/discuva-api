import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import 'multer';
import { DynamicLimitedFileInterceptor } from '../../utility/interceptors/dynamic-limited-file.interceptor';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';
import { UPLOAD_HARD_CEILING_BYTES } from '../../platform-admin/constant/known-platform-settings.constant';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { FinanceRequestService } from '../service/finance-request.service';
import { CreateFinanceRequestDto } from '../dto/finance-request.dto';
import { DepartmentService } from '../../department/service/department.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(MemberRoleEnum.WORKER)
@Controller('finance')
export class FinanceWorkerController {
  constructor(
    private readonly financeRequestService: FinanceRequestService,
    private readonly departmentService: DepartmentService,
  ) {}

  @Get('categories')
  getCategories() {
    return this.financeRequestService.getCategories();
  }

  @Post('requests')
  @UseInterceptors(
    DynamicLimitedFileInterceptor(
      'attachment',
      PlatformSettingKey.MAX_FINANCE_PROOF_UPLOAD_MB,
      UPLOAD_HARD_CEILING_BYTES[PlatformSettingKey.MAX_FINANCE_PROOF_UPLOAD_MB],
      {
        fileFilter: (_req, file, cb) => {
          const allowed = [
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/webp',
          ];
          if (allowed.includes(file.mimetype)) {
            cb(null, true);
          } else {
            cb(
              new BadRequestException(
                'Only PDF and image files (JPEG, PNG, WebP) are allowed.',
              ),
              false,
            );
          }
        },
      },
    ),
  )
  async createRequest(
    @Body() dto: CreateFinanceRequestDto,
    @CurrentUser() user: MemberAuth,
    @UploadedFile() attachment?: Express.Multer.File,
  ) {
    // The target department is already explicit in the request body — just
    // confirm this worker actually leads it, rather than resolving "my
    // department" separately and comparing (which breaks once a worker can
    // legitimately lead more than one department).
    await this.departmentService.assertIsDepartmentLead(
      user.id,
      dto.departmentId,
    );

    return this.financeRequestService.createRequest(dto, user, attachment);
  }

  @Get('requests')
  async getMyDepartmentRequests(
    @CurrentUser() user: MemberAuth,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('departmentId') departmentId?: string,
  ) {
    const resolvedDepartmentId =
      await this.departmentService.resolveLeadDepartmentId(
        user.id,
        departmentId,
      );

    return this.financeRequestService.getMyDepartmentRequests(
      resolvedDepartmentId,
      Number(page),
      Number(limit),
    );
  }

  @Get('requests/:id')
  async getMyRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ) {
    // The request itself names its department — check the caller leads
    // THAT one, rather than resolving an ambiguous "my department" first.
    const request = await this.financeRequestService.getRequest(id);
    if (!request.department) {
      throw new NotFoundException('Finance request not found');
    }
    await this.departmentService.assertIsDepartmentLead(
      user.id,
      request.department.id,
    );
    return request;
  }
}
